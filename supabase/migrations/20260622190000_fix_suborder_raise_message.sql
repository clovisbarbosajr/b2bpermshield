-- ============================================================================
-- FIX: fn_block_unapproved_suborder usava
--   RAISE EXCEPTION 'SUBCUSTOMER_NO_CONFIRM' USING ERRCODE=..., MESSAGE='...'
-- => erro do Postgres "RAISE option already specified: MESSAGE" (não pode ter
-- string de formato E a opção MESSAGE juntas). A trava bloqueava o pedido (o
-- insert falhava), mas com mensagem errada em vez da amigável.
-- Correção: a mensagem amigável vira a própria string de formato; só ERRCODE no USING.
-- ============================================================================
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
    RAISE EXCEPTION 'This account is not allowed to place orders. Please ask your account owner.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
