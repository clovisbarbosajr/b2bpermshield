-- ============================================================================
-- Sub-logins de funcionário: o DONO da conta (clientes.user_id) e um contato
-- 'manager' podem LER a equipe da própria empresa (tela Team no portal). A escrita
-- (criar/atualizar/desativar) é feita pela edge function `company-member`
-- (service_role, que valida dono/manager) — então RLS aqui é só de leitura.
-- Helpers SECURITY DEFINER evitam recursão de RLS (a policy referenciaria a própria
-- tabela company_contacts).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owns_cliente(_cliente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = _cliente_id AND c.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_company_manager(_cliente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_contacts cc
    WHERE cc.user_id = auth.uid() AND cc.cliente_id = _cliente_id
      AND cc.ativo = true AND cc.role = 'manager'
  );
$$;

DROP POLICY IF EXISTS "Company team read" ON public.company_contacts;
CREATE POLICY "Company team read" ON public.company_contacts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()                                  -- o próprio contato
    OR public.owns_cliente(company_contacts.cliente_id)   -- dono da conta
    OR public.is_company_manager(company_contacts.cliente_id) -- manager da mesma empresa
  );
