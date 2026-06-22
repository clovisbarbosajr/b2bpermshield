-- ============================================================================
-- CONSOLIDAÇÃO de sub-usuários no ÚNICO modelo do B2BWave (nosso parâmetro do
-- clone). Sub-usuário = um registro em `clientes` com `parent_customer_id` +
-- 2 flags: `can_confirm_order` (confirma pedido sem aprovação) e
-- `can_view_full_history` (vê histórico completo da empresa).
--
-- Removemos o sistema paralelo `company_contacts` ("Team"): migramos o que
-- existir para o modelo único e trocamos toda dependência de RLS (preço,
-- endereço) do helper antigo `is_company_contact` pelo equivalente do modelo B2BWave.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Sub-usuário HERDA a tabela de preço do pai (catálogo/preços corretos).
--    Se um cliente tem parent e não tem tabela própria, copia a do pai.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_subuser_inherit_pricelist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_customer_id IS NOT NULL AND NEW.tabela_preco_id IS NULL THEN
    SELECT tabela_preco_id INTO NEW.tabela_preco_id
    FROM public.clientes WHERE id = NEW.parent_customer_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_subuser_inherit_pricelist ON public.clientes;
CREATE TRIGGER trg_subuser_inherit_pricelist
  BEFORE INSERT OR UPDATE OF parent_customer_id ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_subuser_inherit_pricelist();

-- ----------------------------------------------------------------------------
-- 2) Helper que SUBSTITUI is_company_contact no RLS: "o usuário logado é
--    sub-cliente do cliente _parent_id?" (mesmo papel, modelo B2BWave).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_subcustomer_of(_parent_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clientes me
    WHERE me.user_id = auth.uid() AND me.parent_customer_id = _parent_id
  );
$$;

-- ----------------------------------------------------------------------------
-- 3) MIGRAR company_contacts existentes -> clientes sub-registros (idempotente).
--    Cada contato vira um cliente filho do cliente-pai (cc.cliente_id), herdando
--    nome/email/user_id; flags derivadas do papel antigo:
--      buyer/manager -> pode confirmar pedido;  manager -> vê histórico completo.
--    Só migra contatos com user_id e que ainda não tenham clientes próprio.
-- ----------------------------------------------------------------------------
-- Best-effort: se houver colisão (e-mail/user_id já em clientes, etc.) não aborta a
-- migração inteira — o objetivo crítico é o schema novo. Contatos não-migrados podem
-- ser recriados pela nova UI (clientes filhos).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'company_contacts') THEN
    INSERT INTO public.clientes
      (user_id, parent_customer_id, nome, email, empresa, tabela_preco_id,
       can_confirm_order, can_view_full_history, status, is_active)
    SELECT cc.user_id, cc.cliente_id,
           COALESCE(cc.nome, cc.email), cc.email, COALESCE(p.empresa, p.nome),
           p.tabela_preco_id,
           (cc.role IN ('buyer','manager')),
           (cc.role = 'manager'),
           CASE WHEN cc.ativo THEN 'ativo'::public.cliente_status ELSE 'inativo'::public.cliente_status END,
           cc.ativo
    FROM public.company_contacts cc
    JOIN public.clientes p ON p.id = cc.cliente_id
    WHERE cc.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.clientes x  WHERE x.user_id = cc.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.clientes x2 WHERE lower(x2.email) = lower(cc.email));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'consolidate_subusers: migracao de contatos pulada (%) — schema novo aplicado mesmo assim', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 4) RECRIAR o RLS de price list trocando is_company_contact -> is_subcustomer_of.
--    Lógica idêntica (staff vê tudo; cliente vê só a própria tabela), apenas o
--    ramo do sub-usuário passa a usar o modelo único.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Read tabela_preco_itens scoped" ON public.tabela_preco_itens;
CREATE POLICY "Read tabela_preco_itens scoped" ON public.tabela_preco_itens
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = tabela_preco_itens.tabela_preco_id
        AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id))
    )
  );

DROP POLICY IF EXISTS "Read tabelas_preco scoped" ON public.tabelas_preco;
CREATE POLICY "Read tabelas_preco scoped" ON public.tabelas_preco
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = tabelas_preco.id
        AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id))
    )
  );

DROP POLICY IF EXISTS "Read variante_precos scoped" ON public.variante_precos;
CREATE POLICY "Read variante_precos scoped" ON public.variante_precos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = variante_precos.tabela_preco_id
        AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id))
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
        AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id))
    )
  );

-- ----------------------------------------------------------------------------
-- 5) Sub-usuário lê os ENDEREÇOS do pai (no checkout o endereço puxa da conta
--    da empresa). Substitui o acesso que antes vinha de is_company_contact.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Sub-customer reads parent addresses" ON public.enderecos;
CREATE POLICY "Sub-customer reads parent addresses" ON public.enderecos
  FOR SELECT TO authenticated
  USING (public.is_subcustomer_of(enderecos.cliente_id));

-- ----------------------------------------------------------------------------
-- 6) REMOVER o sistema antigo. Os policies de preço/endereço já não dependem
--    mais de is_company_contact (recriados acima), então o CASCADE só derruba
--    os policies legados de company_contacts (clientes/pedidos lidos via contato),
--    cobertos agora pelo modelo único (sub-cliente tem clientes próprio + RLS B2BWave).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_company_buyer(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_company_contact(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_company_manager(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.owns_cliente(uuid) CASCADE;
DROP TABLE IF EXISTS public.company_contacts CASCADE;
