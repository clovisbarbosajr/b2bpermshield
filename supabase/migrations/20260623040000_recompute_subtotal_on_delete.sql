-- ============================================================================
-- O subtotal do pedido era recomputado só no INSERT de item. Ao APAGAR um item
-- (admin), nenhum trigger recomputava -> subtotal/total ficavam errados e o admin
-- compensava com conta no client (que ignora desconto/cupom). Agora o recompute
-- dispara também no DELETE; o trigger de total cuida do resto. Pedido do sync intocado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pedido_recompute_subtotal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pid uuid; _b2b integer; _sub numeric;
BEGIN
  _pid := COALESCE(NEW.pedido_id, OLD.pedido_id);
  SELECT b2bwave_order_id INTO _b2b FROM public.pedidos WHERE id = _pid;
  -- só pedido do app e que ainda existe (cascata de delete do pedido = no-op)
  IF FOUND AND _b2b IS NULL THEN
    SELECT COALESCE(sum(subtotal),0) INTO _sub FROM public.pedido_itens WHERE pedido_id = _pid;
    UPDATE public.pedidos SET subtotal = _sub WHERE id = _pid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_pedido_recompute_subtotal ON public.pedido_itens;
CREATE TRIGGER trg_pedido_recompute_subtotal AFTER INSERT OR DELETE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_recompute_subtotal();
