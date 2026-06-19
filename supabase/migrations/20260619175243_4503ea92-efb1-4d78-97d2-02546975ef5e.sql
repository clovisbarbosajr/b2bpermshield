-- 20260619170000_pricelist_isolation
DROP POLICY IF EXISTS "Auth can read tabela_preco_itens" ON public.tabela_preco_itens;
DROP POLICY IF EXISTS "Authenticated can read tabela_preco_itens" ON public.tabela_preco_itens;
CREATE POLICY "Read tabela_preco_itens scoped" ON public.tabela_preco_itens
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = tabela_preco_itens.tabela_preco_id
        AND (c.user_id = auth.uid() OR public.is_company_contact(c.id))
    )
  );

DROP POLICY IF EXISTS "Authenticated can read active tabelas_preco" ON public.tabelas_preco;
DROP POLICY IF EXISTS "Authenticated can read tabelas_preco" ON public.tabelas_preco;
CREATE POLICY "Read tabelas_preco scoped" ON public.tabelas_preco
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = tabelas_preco.id
        AND (c.user_id = auth.uid() OR public.is_company_contact(c.id))
    )
  );

DROP POLICY IF EXISTS "Anon can read variante_precos" ON public.variante_precos;
DROP POLICY IF EXISTS "Authenticated can read variante_precos" ON public.variante_precos;
CREATE POLICY "Read variante_precos scoped" ON public.variante_precos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = variante_precos.tabela_preco_id
        AND (c.user_id = auth.uid() OR public.is_company_contact(c.id))
    )
  );

DROP POLICY IF EXISTS "Clients read own custom prices" ON public.produto_precos_cliente;
CREATE POLICY "Clients read own custom prices" ON public.produto_precos_cliente
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = produto_precos_cliente.cliente_id
        AND (c.user_id = auth.uid() OR public.is_company_contact(c.id))
    )
  );

-- 20260619180000_company_team_rls
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
    user_id = auth.uid()
    OR public.owns_cliente(company_contacts.cliente_id)
    OR public.is_company_manager(company_contacts.cliente_id)
  );