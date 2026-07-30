-- ============================================================================
-- OVERRIDE MANUAL DE PRECO NA LINHA DO PEDIDO (preco especial do Paulo).
--
-- O admin agora edita `pedido_itens.preco_unitario` direto na tela da ordem.
-- Mas `trg_pedido_recompute_subtotal` era `AFTER INSERT OR DELETE` — nao
-- disparava em UPDATE. Resultado: mudar o preco de um item NAO recomputava
-- `pedidos.subtotal`, e portanto nem desconto/imposto/total (que dependem dele
-- via fn_pedido_total_appside). O pedido ficava com o item novo e o total velho.
--
-- CORRECAO: incluir UPDATE no trigger. A funcao ja usa
-- COALESCE(NEW.pedido_id, OLD.pedido_id) e ja ignora pedido vindo do sync
-- (b2bwave_order_id NOT NULL), entao nao precisa mudar a funcao.
--
-- Nota: `trg_pedido_item_preco` (preco autoritativo server-side) e BEFORE
-- INSERT apenas — logo o override do admin NAO e sobrescrito no UPDATE.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_pedido_recompute_subtotal ON public.pedido_itens;
CREATE TRIGGER trg_pedido_recompute_subtotal
  AFTER INSERT OR UPDATE OR DELETE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_recompute_subtotal();
