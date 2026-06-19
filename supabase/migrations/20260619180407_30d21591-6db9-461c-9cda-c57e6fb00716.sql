-- 20260619190000_subcustomer_permissions
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS can_confirm_order     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_full_history boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clientes.can_confirm_order IS
  'Sub-customer pode submeter/confirmar pedido sozinho. false => só salva; o pai confirma.';
COMMENT ON COLUMN public.clientes.can_view_full_history IS
  'Sub-customer vê o histórico de pedidos do pai também. false => só os próprios.';

-- 20260619191000_subcustomer_enforcement
CREATE OR REPLACE FUNCTION public.fn_block_unapproved_suborder()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.user_id = auth.uid()
      AND c.parent_customer_id IS NOT NULL
      AND c.can_confirm_order = false
      AND c.id = NEW.cliente_id
  ) THEN
    RAISE EXCEPTION 'SUBCUSTOMER_NO_CONFIRM'
      USING ERRCODE = 'check_violation',
            MESSAGE = 'This account is not allowed to place orders. Please ask your account owner.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_unapproved_suborder ON public.pedidos;
CREATE TRIGGER trg_block_unapproved_suborder
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_unapproved_suborder();

DROP POLICY IF EXISTS "Sub-customer reads parent history" ON public.pedidos;
CREATE POLICY "Sub-customer reads parent history" ON public.pedidos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes sub
      WHERE sub.user_id = auth.uid()
        AND sub.can_view_full_history = true
        AND sub.parent_customer_id = pedidos.cliente_id
    )
  );

DROP POLICY IF EXISTS "Sub-customer reads parent order items" ON public.pedido_itens;
CREATE POLICY "Sub-customer reads parent order items" ON public.pedido_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      JOIN public.clientes sub ON sub.parent_customer_id = p.cliente_id
      WHERE p.id = pedido_itens.pedido_id
        AND sub.user_id = auth.uid()
        AND sub.can_view_full_history = true
    )
  );