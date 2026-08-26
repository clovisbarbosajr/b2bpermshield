-- ============================================================================
-- A LISTA DE CUPONS DEIXA DE SER PUBLICA PARA QUEM TEM CONTA
--
-- Achado do cetico de preco (26/ago).
--
--   CREATE POLICY "Authenticated read active coupons"
--     ON public.coupons FOR SELECT TO authenticated USING (ativo = true);
--   (20260623060000_checkout_reference_rls.sql:74)
--
-- A politica existe por um motivo legitimo: o checkout precisa conferir o
-- codigo que o cliente digita. Mas RLS filtra LINHA, nao consulta — e nada
-- obriga o cliente a filtrar por codigo:
--
--   GET /rest/v1/coupons?select=codigo,tipo,valor
--
-- devolve a promocao inteira. E o cadastro deste sistema e ABERTO: qualquer
-- pessoa cria conta e baixa a lista, inclusive cupom criado para UM cliente.
--
-- O CONSERTO: a conferencia passa a ser uma pergunta fechada — "existe cupom
-- com ESTE codigo?" — em vez de acesso a tabela. Sem listagem possivel.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- O que estava exposto ate agora (todo cupom ativo era legivel por qualquer
-- conta). Guarde para decidir se vale trocar codigo de alguma promocao:
--
--   SELECT codigo, tipo, valor, uso_maximo, uso_atual, data_fim
--     FROM public.coupons WHERE ativo IS TRUE ORDER BY codigo;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) A pergunta fechada ----------
CREATE OR REPLACE FUNCTION public.cupom_por_codigo(_codigo text)
RETURNS TABLE (
  id          uuid,
  codigo      text,
  tipo        text,
  valor       numeric,
  data_inicio timestamptz,
  data_fim    timestamptz,
  uso_maximo  integer,
  uso_atual   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.codigo, c.tipo::text, c.valor,
         c.data_inicio, c.data_fim, c.uso_maximo, c.uso_atual
    FROM public.coupons c
   WHERE c.ativo IS TRUE
     -- Casamento EXATO, sem curinga: `upper(trim(...))` e a mesma normalizacao
     -- que a tela ja faz. Nao ha LIKE aqui de proposito — com LIKE, um `%`
     -- devolveria a lista inteira e o furo voltaria pela porta da funcao.
     AND upper(c.codigo) = upper(trim(COALESCE(_codigo, '')))
     AND COALESCE(trim(_codigo), '') <> ''
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.cupom_por_codigo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupom_por_codigo(text) TO authenticated;

-- ---------- 2) A tabela para de ser legivel pelo cliente ----------
-- A tela do admin NAO depende desta politica: ela usa "Admins can manage
-- coupons" (FOR ALL), que continua intacta. Conferido antes de derrubar.
DROP POLICY IF EXISTS "Authenticated read active coupons" ON public.coupons;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO impede tentativa as cegas: quem souber (ou adivinhar) um codigo continua
-- podendo usa-lo. O que acaba e a LISTAGEM — descobrir os codigos sem saber
-- nenhum. Limitar tentativa e outro assunto (teto por conta), e hoje o dano de
-- uma tentativa errada e zero.
--
-- NAO da escopo por cliente ao cupom: `coupons` nao tem esse conceito, o limite
-- e global. Continua como sempre foi.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   CREATE POLICY "Authenticated read active coupons" ON public.coupons
--     FOR SELECT TO authenticated USING (ativo = true);
--   DROP FUNCTION IF EXISTS public.cupom_por_codigo(text);
--
-- ATENCAO: o rollback do SQL sozinho NAO basta — o checkout passou a usar a
-- funcao. Reverter o banco sem reverter o front deixa o cupom sem funcionar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A listagem morreu (rode LOGADO COMO CLIENTE, nao como admin — o admin
--    continua vendo tudo, e por isso um teste feito por voce no editor de SQL
--    NAO prova nada aqui):
--      GET /rest/v1/coupons?select=codigo
--    ESPERADO: lista vazia.
--
-- 2) CONTROLE — o cupom ainda funciona:
--    a) no checkout, digite um codigo VALIDO: tem que aplicar o desconto.
--       Sem este teste, uma funcao que nao devolve nada passaria por
--       "consertada" e voce perderia todas as promocoes de uma vez.
--    b) digite um codigo INEXISTENTE: "Coupon not found or inactive".
--
-- 3) O curinga nao vaza:
--      SELECT * FROM public.cupom_por_codigo('%');
--    ESPERADO: zero linhas.
-- ---------------------------------------------------------------------------
