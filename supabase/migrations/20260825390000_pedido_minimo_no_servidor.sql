-- ============================================================================
-- PEDIDO MINIMO DEIXA DE SER SO DO NAVEGADOR
--
-- Divida registrada em PENDENCIAS-2026-08-25 (secao 4). O motivo de nao ter
-- sido feita antes estava escrito assim:
--
--   "O pedido e criado numa chamada e os itens em outra; no INSERT nao ha item
--    para somar."
--
-- Verdade, e por isso um gatilho BEFORE INSERT em `pedidos` nao resolve. Mas
-- existe o momento certo, e ele ja estava no schema: o `Checkout` insere TODOS
-- os itens em UMA chamada, e um gatilho POR STATEMENT em `pedido_itens` roda
-- uma vez so, depois da linha final. Nesse instante o pedido esta completo.
--
-- Por que nao FOR EACH ROW: reprovaria no primeiro item de todo carrinho
-- (subtotal ainda parcial). Um gatilho que reprova pedido legitimo e pior do
-- que a regra nao existir.
--
-- QUEM NAO E BARRADO, e por que:
--   - staff (admin/manager/warehouse): admin que acrescenta uma linha num
--     pedido ja fechado nao pode esbarrar no minimo do cliente;
--   - sync (`auth.uid()` NULL, service key): pedido do B2BWave e do outro
--     sistema, e a regra de la nao e esta;
--   - pedido importado (`b2bwave_order_id IS NOT NULL`), pelo mesmo motivo;
--   - cliente sem minimo configurado (NULL ou 0).
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Quantos pedidos JA ENTRARAM abaixo do minimo do proprio cliente. E o tamanho
-- do buraco ate aqui; a partir da migration, nenhum novo entra assim.
--
-- NAO apaga nem corrige nada do que ja passou: pedido antigo continua como
-- esta. So mede.
--
--   SELECT c.email, c.minimum_order_value AS minimo,
--          count(*) AS pedidos_abaixo,
--          round(min(p.subtotal), 2) AS menor,
--          round(max(p.subtotal), 2) AS maior
--   FROM public.pedidos p
--   JOIN public.clientes c ON c.id = p.cliente_id
--   WHERE p.b2bwave_order_id IS NULL
--     AND COALESCE(c.minimum_order_value, 0) > 0
--     AND COALESCE(p.subtotal, 0) < c.minimum_order_value
--   GROUP BY c.email, c.minimum_order_value
--   ORDER BY count(*) DESC;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_minimo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r   record;
BEGIN
  -- Sync e qualquer conexao sem sessao (service key nao carrega `sub`).
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Staff nao e barrado. `SECURITY DEFINER` ignora RLS, entao a checagem de
  -- papel precisa estar AQUI dentro — nao ha politica que a faca por mim.
  IF public.has_role(_uid, 'admin')
     OR public.has_role(_uid, 'manager')
     OR public.has_role(_uid, 'warehouse') THEN
    RETURN NULL;
  END IF;

  FOR _r IN
    SELECT p.id,
           c.minimum_order_value AS minimo,
           -- Soma direto dos ITENS, e nao `p.subtotal`. O `trg_pedido_recompute_subtotal`
           -- ja corrige `p.subtotal` a partir dos itens, mas ele e FOR EACH ROW:
           -- depender da ordem entre gatilhos de nivel diferente e apostar numa
           -- garantia que eu nao preciso. Somar aqui e independente disso.
           (SELECT COALESCE(sum(i.subtotal), 0)
              FROM public.pedido_itens i WHERE i.pedido_id = p.id) AS valor
      FROM (SELECT DISTINCT pedido_id FROM novos) n
      JOIN public.pedidos  p ON p.id = n.pedido_id
      JOIN public.clientes c ON c.id = p.cliente_id
     WHERE p.b2bwave_order_id IS NULL
       AND COALESCE(c.minimum_order_value, 0) > 0
  LOOP
    IF _r.valor < _r.minimo THEN
      -- Token reconhecivel; a tela traduz. Sem isto o cliente veria texto cru
      -- do Postgres — regra da casa: erro de programador nao chega na tela.
      RAISE EXCEPTION 'ORDER_BELOW_MINIMUM'
        USING ERRCODE = 'check_violation',
              MESSAGE = format(
                'ORDER_BELOW_MINIMUM: order value %s is below the minimum %s for this account',
                round(_r.valor, 2), round(_r.minimo, 2));
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

-- `REFERENCING NEW TABLE` exige PG 10+. FOR EACH STATEMENT roda UMA vez por
-- comando, depois de todos os gatilhos de linha — que e exatamente quando o
-- pedido esta completo.
DROP TRIGGER IF EXISTS trg_pedido_minimo ON public.pedido_itens;
CREATE TRIGGER trg_pedido_minimo
  AFTER INSERT ON public.pedido_itens
  REFERENCING NEW TABLE AS novos
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_pedido_minimo();

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO barra o cliente que insere os itens UM POR UM em chamadas separadas: cada
-- statement e avaliado sozinho, e o ultimo veria o pedido ja completo — mas o
-- PRIMEIRO reprovaria antes de chegar la. Ou seja: quem insere um por um e
-- barrado LOGO, nao no fim. O caminho da tela (todos numa chamada) e o unico
-- que passa quando o total alcanca o minimo.
--
-- NAO mexe em pedido que ja entrou abaixo do minimo. A consulta de BACKUP
-- mostra quantos sao; corrigir historico e decisao do dono, nao efeito colateral
-- de uma migration.
--
-- NAO barra remocao de item que derrube o pedido abaixo do minimo depois de
-- fechado. Isso e AFTER DELETE, e hoje quem apaga item de pedido fechado e
-- staff — que esta isento de proposito.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_pedido_minimo ON public.pedido_itens;
--   DROP FUNCTION IF EXISTS public.fn_pedido_minimo();
--
-- Reverter devolve a regra ao navegador, onde o cliente pode simplesmente nao
-- executa-la.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O gatilho existe e e de STATEMENT (`tgtype` par no bit de linha):
--   SELECT tgname, tgtype FROM pg_trigger
--   WHERE tgrelid = 'public.pedido_itens'::regclass AND tgname = 'trg_pedido_minimo';
--
-- 2) CONTROLE — o teste que importa e o NEGATIVO, e sao dois:
--    a) cliente COM minimo configurado fecha carrinho ABAIXO dele -> tem que
--       ser recusado, com a mensagem traduzida (nao o texto cru do Postgres);
--    b) o MESMO cliente fecha carrinho ACIMA do minimo -> tem que passar.
--    Sem o (b), um gatilho que recusa TUDO passaria como "funcionando" e a loja
--    pararia de vender para todo cliente com minimo.
--
-- 3) Staff continua conseguindo acrescentar item em pedido fechado.
-- ---------------------------------------------------------------------------
