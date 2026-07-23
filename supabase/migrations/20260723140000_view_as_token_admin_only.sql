-- ============================================================================
-- REVERTE a migration 20260723120000 (que abriu create_view_as_token pra
-- manager/warehouse). Regra de negócio confirmada pelo dono: "View as" é
-- SÓ PRA ADMIN — manager/warehouse não impersonam cliente.
--
-- Alinhado com o frontend:
-- - Clientes.tsx: botão "View as" só renderiza pra role === "admin".
-- - AuthContext: a guarda do view-as só valida sessão real de ADMIN.
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
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create view-as tokens';
  END IF;

  _token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.view_as_tokens (token, admin_user_id, customer_id)
  VALUES (_token, auth.uid(), _customer_id);

  RETURN _token;
END;
$$;
