-- ============================================================================
-- "View as" isolado POR ABA (fix do bug: todas as abas viravam o cliente).
--
-- O frontend deixou de gravar a impersonação no localStorage (compartilhado
-- entre abas) e passou a usar o fluxo de TOKEN que já existia:
--   botão "View as" → create_view_as_token → abre /view-as?token=... em aba
--   nova → consume_view_as_token → sessionStorage (por aba).
--
-- Esta migration alinha a RPC create_view_as_token com quem PODE usar o botão:
-- a tela /admin/customers é de qualquer STAFF (admin/manager/warehouse) e a
-- guarda do AuthContext valida view-as contra sessão real de staff — mas a RPC
-- só aceitava admin. Agora aceita os três papéis de staff.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_view_as_token(_customer_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _token TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  ) THEN
    RAISE EXCEPTION 'Only staff can create view-as tokens';
  END IF;

  _token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.view_as_tokens (token, admin_user_id, customer_id)
  VALUES (_token, auth.uid(), _customer_id);

  RETURN _token;
END;
$$;
