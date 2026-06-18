-- ============================================================================
-- CORREÇÃO DE SEGURANÇA (cross-tenant / PII) — anon esquecido.
-- As migrations de segurança 20260618000000 / 20260618193846 revogaram o acesso
-- `anon` de clientes/pedidos/pedido_itens/tabelas_preco/etc., mas ESQUECERAM:
--   • enderecos              -> endereços de entrega/cobrança (PII) de TODOS os clientes
--   • cliente_privacy_groups -> vínculo cliente↔grupo de privacidade
-- Ambas ficaram com policies `TO anon USING (true)` para SELECT/INSERT/UPDATE/
-- DELETE (criadas em 20260320142326, modo demo). Como a chave anon vai no
-- browser, qualquer um NÃO autenticado podia LER, ALTERAR e APAGAR o endereço de
-- qualquer cliente. Cross-tenant total. Este migration fecha isso.
--
-- Após o drop, o acesso correto permanece intacto:
--   enderecos: "Clients can manage own enderecos" (auth.uid() = clientes.user_id),
--              "Admins can manage enderecos", "Contacts read company enderecos".
--   cliente_privacy_groups: "Admins can manage" + (nova) leitura do PRÓPRIO cliente
--              — necessária para o filtro de visibilidade do catálogo (Catalogo.tsx).
-- Verificado: nenhum fluxo de cadastro/portal grava nessas tabelas como anon
-- (todo INSERT/UPDATE/DELETE vem de admin ou de cliente autenticado).
-- ============================================================================

-- enderecos: remove acesso público (PII)
DROP POLICY IF EXISTS "Anon can insert enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can update enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can delete enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can read enderecos"   ON public.enderecos;

-- cliente_privacy_groups: remove acesso público
DROP POLICY IF EXISTS "Anon can insert cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can update cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can delete cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can read cliente_privacy_groups"   ON public.cliente_privacy_groups;

-- Cliente autenticado lê os PRÓPRIOS vínculos de grupo (filtro do catálogo).
-- Sem isto, o cliente logado não enxergaria seus grupos e veria só produtos
-- sem restrição. Admin continua com FOR ALL via a policy existente.
DROP POLICY IF EXISTS "Clients read own privacy groups" ON public.cliente_privacy_groups;
CREATE POLICY "Clients read own privacy groups" ON public.cliente_privacy_groups
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = cliente_privacy_groups.cliente_id
      AND c.user_id = auth.uid()
  ));
