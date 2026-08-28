-- ---------------------------------------------------------------------------
-- DESCONTO SAI DO PRECO. Decisao da Jess, 28/ago/2026.
--
-- Palavras dela: "Todo tipo de desconto. Preco do cliente vai pela tabela de
-- preco." E, sobre o preco combinado individualmente: "Preco combinado continua
-- valendo. Pode retirar o desconto mesmo que o valor fique diferente por agora."
--
-- O recurso de desconto esta sendo desativado no B2BWave, e este sistema e um
-- clone dele.
--
-- ---------------------------------------------------------------------------
-- A CASCATA, ANTES E DEPOIS
--
--   1. preco combinado com o cliente (`produto_precos_cliente`)   FICA
--   2. tabela de preco (`tabela_preco_itens`)                     FICA
--   3. desconto por quantidade (`produto_descontos`)              SAI
--   4. preco base (`produtos.preco`)                              FICA
--
-- Sai tambem o desconto aplicado EM CIMA do preco combinado, que rodava quando
-- `produto_precos_cliente.aplicar_descontos_extras` era true.
--
-- O PRECO VAI MUDAR para quem tinha desconto por quantidade: ele passa a pagar a
-- tabela (ou o base). A Jess autorizou explicitamente essa divergencia temporaria.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NAO FAZ, DE PROPOSITO
--
-- NAO apaga `produto_descontos`, e NAO derruba `_resolve_desconto`. As linhas
-- ficam onde estao, intactas. Se a decisao voltar atras, religar e recolocar duas
-- chamadas — nao e recuperar dado de backup.
--
-- `_resolve_desconto` fica orfa (nenhum chamador). Isso e proposital: ela e o
-- corpo da regra, e apaga-la agora obrigaria a reescreve-la do zero depois.
--
-- ---------------------------------------------------------------------------
-- ORDEM: ESTE SQL E O PUBLISH ANDAM JUNTOS, e o intervalo entre os dois tem custo.
--
-- `src/lib/pricing.ts` faz a MESMA cascata no navegador, para mostrar preco na
-- vitrine, e o checkout compara o total da tela com o total que o banco calcula
-- (`Checkout.tsx`, a guarda de 0.03). Enquanto um dos dois aplicar desconto e o
-- outro nao, produto com desconto vai divergir:
--
--   SQL primeiro, front depois  -> o banco cobra MAIS que a tela mostrou. A guarda
--                                  do checkout PEGA e recusa o pedido com "the
--                                  price changed while you were checking out".
--                                  Chato, mas ninguem e cobrado errado.
--   Front primeiro, SQL depois  -> a tela mostra o preco cheio e o banco cobra o
--                                  com desconto. A guarda NAO pega (ela so barra
--                                  quando o banco cobra MAIS), e voce vende mais
--                                  barato sem saber.
--
-- Entao: **SQL PRIMEIRO, PUBLISH LOGO EM SEGUIDA**.
--
-- DIAGNOSTICO — rode ANTES e guarde. Quantos produtos perdem desconto, e o
-- tamanho da diferenca:
--
--   SELECT count(*) AS regras_de_desconto,
--          count(DISTINCT produto_id) AS produtos_afetados,
--          count(DISTINCT tabela_preco_id) AS tabelas_afetadas
--     FROM public.produto_descontos;
--
--   SELECT count(*) AS clientes_com_desconto_extra
--     FROM public.produto_precos_cliente WHERE aplicar_descontos_extras IS TRUE;
--
-- ROLLBACK: reaplique `20260801140000_preco_subuser_parent_account.sql`, que
-- contem a versao anterior de `preco_autoritativo` — com as duas chamadas a
-- `_resolve_desconto`. Como nada foi apagado, o desconto volta a valer no mesmo
-- instante. Reverta o front junto, pelo motivo da secao ORDEM.
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.preco_autoritativo(_produto_id uuid, _cliente_id uuid, _qtd integer)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _base    numeric;
  _conta   uuid;
  _tp_self uuid;
  _tp_conta uuid;
  _tpid    uuid;
  _cust    numeric;
  _pl      numeric;
BEGIN
  SELECT preco INTO _base FROM public.produtos WHERE id = _produto_id;
  IF _base IS NULL THEN RETURN 0; END IF;

  -- Conta da empresa (o próprio cliente, se não for sub-login).
  SELECT COALESCE(parent_customer_id, id), tabela_preco_id
    INTO _conta, _tp_self
  FROM public.clientes WHERE id = _cliente_id;
  IF _conta IS NULL THEN _conta := _cliente_id; END IF;

  IF _conta = _cliente_id THEN
    _tpid := _tp_self;
  ELSE
    SELECT tabela_preco_id INTO _tp_conta FROM public.clientes WHERE id = _conta;
    _tpid := COALESCE(_tp_self, _tp_conta);
  END IF;

  -- 1) preço específico do cliente (maior prioridade) — na conta da EMPRESA.
  --
  -- `aplicar_descontos_extras` deixou de ser lido: era ele que mandava aplicar
  -- desconto POR CIMA do preco combinado. A coluna continua na tabela, e volta a
  -- valer sozinha se o rollback for aplicado.
  SELECT preco INTO _cust
  FROM public.produto_precos_cliente WHERE produto_id = _produto_id AND cliente_id = _conta;
  IF _cust IS NOT NULL THEN RETURN _cust; END IF;

  -- 2) tabela de preço
  IF _tpid IS NOT NULL THEN
    SELECT preco INTO _pl FROM public.tabela_preco_itens
    WHERE tabela_preco_id = _tpid AND produto_id = _produto_id;
    IF _pl IS NOT NULL THEN RETURN _pl; END IF;
  END IF;

  -- 3) O desconto por quantidade ficava AQUI, chamando `_resolve_desconto`.
  --    Removido em 28/ago/2026 (ver cabecalho). A funcao e as linhas de
  --    `produto_descontos` continuam no banco, intactas.

  -- 4) base
  RETURN _base;
END; $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICACAO — as DUAS metades. So a primeira passaria numa funcao que devolve
-- sempre o preco base, e ai o preco combinado e a tabela parariam de valer.
--
-- Fichas e produto NASCEM aqui dentro, e tudo termina em ROLLBACK.
--
--   BEGIN;
--     CREATE TEMP TABLE zzp AS
--     WITH prod AS (
--       INSERT INTO public.produtos (nome, sku, preco, ativo, estoque_total, quantidade_minima)
--       VALUES ('ZZVERIF-preco', 'ZZVERIF-PRECO-1', 100.00, false, 0, 1)
--       RETURNING id
--     ), tab AS (
--       INSERT INTO public.tabelas_preco (nome, ativo, is_default)
--       VALUES ('ZZVERIF-tabela', false, false) RETURNING id
--     ), cli AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, tabela_preco_id)
--       SELECT gen_random_uuid(), 'ZZVERIF-cli', 'zzvp@example.invalid', 'ativo', true, tab.id FROM tab
--       RETURNING id
--     )
--     SELECT (SELECT id FROM prod) AS produto_id,
--            (SELECT id FROM tab)  AS tabela_id,
--            (SELECT id FROM cli)  AS cliente_id;
--
--     -- preco de tabela = 80, e um desconto por quantidade que daria 50
--     INSERT INTO public.tabela_preco_itens (produto_id, tabela_preco_id, preco, origem)
--     SELECT produto_id, tabela_id, 80.00, 'local' FROM zzp;
--     INSERT INTO public.produto_descontos (produto_id, tabela_preco_id, quantidade_minima, preco_final)
--     SELECT produto_id, tabela_id, 10, 50.00 FROM zzp;
--
--     -- (1) COM quantidade que ativaria o desconto: tem que vir 80, nao 50.
--     SELECT public.preco_autoritativo((SELECT produto_id FROM zzp),
--                                      (SELECT cliente_id FROM zzp), 50) AS com_qtd_alta;
--     -- ESPERADO: 80.00. Se vier 50.00, a migration NAO entrou.
--
--     -- (2) A OUTRA METADE: a tabela de preco continua valendo, e o preco
--     --     combinado ainda tem prioridade sobre ela.
--     INSERT INTO public.produto_precos_cliente (produto_id, cliente_id, preco)
--     SELECT produto_id, cliente_id, 70.00 FROM zzp;
--     SELECT public.preco_autoritativo((SELECT produto_id FROM zzp),
--                                      (SELECT cliente_id FROM zzp), 50) AS com_preco_combinado;
--     -- ESPERADO: 70.00. Se vier 80.00, a funcao parou de ler o preco combinado —
--     -- que e justamente o que a Jess mandou PRESERVAR.
--   ROLLBACK;
--
--   SELECT count(*) AS sobrou FROM public.produtos WHERE sku LIKE 'ZZVERIF%';
--   -- ESPERADO: 0.
-- ---------------------------------------------------------------------------
