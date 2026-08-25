-- ============================================================================
-- TRAVA: `pedidos.b2bwave_order_id` so pode ser gravado pelo SERVIDOR
--
-- ESTE E O ACHADO MAIS GRAVE DA VARREDURA DE 25/ago.
--
-- `b2bwave_order_id` marca "este pedido veio do B2BWave". Meia duzia de triggers
-- usa esse campo para se ISENTAR, porque pedido importado ja chega com os
-- valores calculados na origem:
--
--   fn_pedido_item_preco_autoritativo  (20260622220000)  -> reescreve preco_unitario
--   fn_pedido_recompute_subtotal       (20260730120000)  -> recalcula subtotal
--   fn_pedido_total_appside                              -> desconto/imposto/frete/total
--   fn_reserve_stock_on_order_item     (20260623000000)  -> reserva de estoque
--   fn_item_exige_variante             (20260825220000)  -> exige variante
--
-- So que a policy de INSERT em `pedidos` e apenas "o pedido e meu":
--
--   CREATE POLICY "Clients can insert pedidos" ON public.pedidos
--     FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM clientes
--       WHERE id = pedidos.cliente_id AND user_id = auth.uid()));
--
-- Nenhum trigger zera o campo, nao ha GRANT por coluna, nao ha FORCE RLS.
--
-- EXPLORACAO: o cliente manda UM campo a mais no insert do pedido
-- (`b2bwave_order_id: 999999999`) e fica isento de TODOS os recalculos acima.
-- Preco vira campo livre — ele escolhe quanto paga. E o estoque nao e reservado.
--
-- Nao e regressao: existe desde 20260622220000. Foi encontrado revisando outra
-- coisa.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Pedido com `b2bwave_order_id` que o sync NUNCA criou e sinal de abuso (ou de
-- import manual). O sync sempre grava `numero = b2bwave_order_id`.
--
--   SELECT id, numero, b2bwave_order_id, cliente_id, total, created_at
--   FROM public.pedidos
--   WHERE b2bwave_order_id IS NOT NULL
--     AND numero IS DISTINCT FROM b2bwave_order_id
--   ORDER BY created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_b2bwave_id_so_servidor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- `service_role` = edge function (o sync). `auth.role()` devolve o papel do
  -- JWT; para chamada com service key vem 'service_role'.
  --
  -- `IS NULL` = conexao DIRETA (SQL editor do Lovable, psql), que nao passa por
  -- PostgREST e por isso nao tem claim de role. Toda chamada pela API tem role
  -- (`anon`, `authenticated` ou `service_role`), entao NULL nao e alcancavel
  -- pela web — e quem ja esta com conexao direta ao banco nao precisa desta
  -- trava para nada.
  --
  -- Sem este escape a trava vira uma armadilha: o ramo de UPDATE abaixo
  -- RESTAURA o valor antigo, entao `UPDATE pedidos SET b2bwave_order_id = NULL`
  -- rodado no SQL editor seria silenciosamente revertido — e o SQL editor e o
  -- unico caminho que o dono usa. A propria consulta de diagnostico no topo
  -- deste arquivo manda procurar pedidos forjados; sem o escape, nao haveria
  -- como limpa-los depois.
  IF auth.role() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Qualquer outro chamador (cliente, staff pela tela, SQL do admin) NAO define
  -- este campo. Zera em silencio em vez de recusar: recusar quebraria o insert
  -- legitimo de quem mandar a coluna sem querer, e o efeito desejado — nao ser
  -- isento dos recalculos — se obtem zerando.
  IF TG_OP = 'INSERT' THEN
    NEW.b2bwave_order_id := NULL;
  ELSIF NEW.b2bwave_order_id IS DISTINCT FROM OLD.b2bwave_order_id THEN
    NEW.b2bwave_order_id := OLD.b2bwave_order_id;
  END IF;

  RETURN NEW;
END $$;

-- Nome com `a_` para ordenar ANTES dos demais triggers BEFORE: o Postgres roda
-- os BEFORE em ordem alfabetica de nome, e este precisa zerar o campo antes de
-- qualquer trigger consultar `NEW.b2bwave_order_id` para decidir se se isenta.
DROP TRIGGER IF EXISTS a_trg_pedido_b2bwave_id_so_servidor ON public.pedidos;
CREATE TRIGGER a_trg_pedido_b2bwave_id_so_servidor
  BEFORE INSERT OR UPDATE OF b2bwave_order_id ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_b2bwave_id_so_servidor();

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS a_trg_pedido_b2bwave_id_so_servidor ON public.pedidos;
--
-- ATENCAO: reverter reabre a escolha de preco pelo cliente. So faca isso se o
-- sync parar de importar pedido, e me avise.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O gatilho existe e roda primeiro:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--   ORDER BY tgname;
--   -- `a_trg_pedido_b2bwave_id_so_servidor` tem que ser o PRIMEIRO da lista.
--
-- 2) O sync continua importando: rode um ciclo e confira que os pedidos novos
--    tem `b2bwave_order_id` preenchido. Se vierem NULL, a chamada nao esta indo
--    com service key e o gatilho zerou — ai me avise ANTES de reverter.
-- ---------------------------------------------------------------------------
