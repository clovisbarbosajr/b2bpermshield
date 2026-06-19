-- ============================================================================
-- ISOLAMENTO DE PRICE LIST (crítico — vazamento de preço entre clientes).
-- Antes: `tabela_preco_itens` tinha "FOR SELECT TO authenticated USING (true)" →
-- QUALQUER cliente logado lia os preços de TODOS os price lists (não só o dele).
-- `variante_precos` estava até com leitura ANÔNIMA. Isso expunha preço de um
-- cliente para outro.
--
-- Agora: cada cliente lê SOMENTE o price list que é o DELE (clientes.tabela_preco_id);
-- contato de empresa lê o da empresa dele (is_company_contact). Staff (admin/manager/
-- warehouse) lê tudo (gestão/admin). Mesma regra para variante_precos e
-- produto_precos_cliente (preço específico do cliente = só o do próprio cliente).
-- ============================================================================

-- ---------- tabela_preco_itens (preços por tabela) ----------
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

-- ---------- tabelas_preco (a "lista" de price lists; nomes/metadados) ----------
-- Cliente só precisa enxergar a própria; staff vê todas.
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

-- ---------- variante_precos (preço por variante × tabela) — fecha leitura anônima ----------
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

-- ---------- produto_precos_cliente (preço específico do cliente) ----------
-- Cliente lê SÓ o próprio (antes era admin-only → cliente não via nem o dele).
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
