-- ============================================================================
-- Lookup de login por email (SECURITY DEFINER) — pra "adotar" um login órfão.
-- Caso real (2026-07-17): email com login em auth.users mas SEM ficha em
-- `clientes` (deletado antes do delete definitivo existir, ou migrado sem
-- perfil) travava o "Add employee" ("already has a login") e não aparecia em
-- lugar nenhum pra gerenciar. Com isto, a company-member adota o login em vez
-- de recusar. Só service_role executa (edge functions).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(_email text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = auth, public AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;

-- Existe um papel STAFF (admin/manager/warehouse) pra este login? Evita adotar
-- um login de staff como sub-cliente (escalonamento). Só service_role.
CREATE OR REPLACE FUNCTION public.is_staff_login(_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','manager','warehouse')
  );
$$;
REVOKE ALL ON FUNCTION public.is_staff_login(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_login(uuid) TO service_role;
