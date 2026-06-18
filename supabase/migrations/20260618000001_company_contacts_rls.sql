-- ============================================================================
-- B3 / 7-5 — RLS para sub-logins (company_contacts)
-- O recurso de "Contacts" (buyer/viewer/manager) não funcionava: a RLS de
-- clientes/pedidos/enderecos exige `clientes.user_id = auth.uid()`, e o contato
-- tem uid próprio (≠ dono da empresa). Estas policies dão ao contato ATIVO
-- acesso apenas aos dados da SUA empresa:
--   - SELECT em clientes/enderecos/pedidos/pedido_itens da empresa (todos os papéis)
--   - INSERT de pedidos/pedido_itens só para buyer/manager (viewer não compra)
-- Escopo sempre limitado por `company_contacts.user_id = auth.uid()`.
-- Ver REVIEW_PARTE_7.md (7-5) / BUGS.md (B3).
-- ============================================================================

-- Função helper: o usuário logado é contato ATIVO da empresa _cliente_id?
CREATE OR REPLACE FUNCTION public.is_company_contact(_cliente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_contacts cc
    WHERE cc.user_id = auth.uid()
      AND cc.cliente_id = _cliente_id
      AND cc.ativo = true
  )
$$;

-- Função helper: contato que PODE comprar (buyer/manager) para a empresa?
CREATE OR REPLACE FUNCTION public.is_company_buyer(_cliente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_contacts cc
    WHERE cc.user_id = auth.uid()
      AND cc.cliente_id = _cliente_id
      AND cc.ativo = true
      AND cc.role IN ('buyer', 'manager')
  )
$$;

-- clientes: contato lê a própria empresa
CREATE POLICY "Contacts read company cliente" ON public.clientes
  FOR SELECT USING (public.is_company_contact(id));

-- enderecos: contato lê os endereços da empresa
CREATE POLICY "Contacts read company enderecos" ON public.enderecos
  FOR SELECT USING (public.is_company_contact(cliente_id));

-- pedidos: contato lê os pedidos da empresa; buyer/manager podem inserir
CREATE POLICY "Contacts read company pedidos" ON public.pedidos
  FOR SELECT USING (public.is_company_contact(cliente_id));
CREATE POLICY "Contacts insert company pedidos" ON public.pedidos
  FOR INSERT WITH CHECK (public.is_company_buyer(cliente_id));

-- pedido_itens: leitura/inserção seguindo o pedido da empresa
CREATE POLICY "Contacts read company pedido_itens" ON public.pedido_itens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_itens.pedido_id
        AND public.is_company_contact(p.cliente_id)
    )
  );
CREATE POLICY "Contacts insert company pedido_itens" ON public.pedido_itens
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_itens.pedido_id
        AND public.is_company_buyer(p.cliente_id)
    )
  );
