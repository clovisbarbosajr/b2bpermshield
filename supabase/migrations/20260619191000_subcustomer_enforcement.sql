-- ============================================================================
-- IMPOSIÇÃO (segura) das permissões de sub-customer. UI não basta — aqui é no banco.
--
-- 1) can_confirm_order = false  → o sub-customer NÃO pode criar pedido (trigger RAISE).
--    Só dispara para um CLIENTE logado que é sub (parent_customer_id) e sem permissão,
--    no PRÓPRIO pedido. Admin/staff (não são clientes) e o sync (service_role, sem
--    auth.uid()) NÃO são afetados.
-- 2) can_view_full_history = true → o sub-customer também LÊ os pedidos do PAI
--    (policy aditiva). Default (false) = só os próprios (policy existente já cobre).
-- Segurança: sub-customer continua com papel 'cliente' (RLS de user_roles só admin
--    gerencia papéis) → não há escalonamento.
-- ============================================================================

-- 1) Bloqueio de pedido sem permissão de confirmar.
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

-- 2) Histórico completo: sub-customer com a flag lê também os pedidos do pai.
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

-- Itens do pedido do pai acompanham (mesma regra), p/ o detalhe do pedido abrir.
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
