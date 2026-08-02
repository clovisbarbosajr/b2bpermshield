-- ============================================================================
-- PARTE 2 do fechamento da leitura anônima (decisão do dono: "Nada pode ser
-- público. Só tem acesso a produto do sistema se tiver login").
--
-- A consulta de conferência da parte 1 (20260802140000) voltou com 4 linhas.
-- Elas escaparam do primeiro passe porque NÃO seguem o nome "Anon can read ...":
-- são as policies "scoped" criadas depois, que concedem a `authenticated, anon`
-- ao mesmo tempo. O `anon` ali dentro passou despercebido.
--
-- E são as PIORES das que sobravam — o catálogo em si:
--
--   produtos / categorias — "Read produtos scoped" e "Read categorias scoped"
--     (20260622191614:147,154) chamam `cliente_pode_ver_produto` /
--     `cliente_pode_ver_categoria`. Essas funções, para item NÃO-privado, fazem
--     `IF NOT COALESCE(_priv, false) THEN RETURN true` (20260622191614:118-120)
--     — devolvem TRUE sem olhar quem chamou. Como `is_private` é false por
--     padrão, o catálogo inteiro (nome, SKU, PREÇO BASE, estoque) era legível
--     SEM LOGIN. A privacidade por grupo funcionava; o resto ficava aberto.
--
--   payment_options / shipping_options — "Read visible ..."
--     (20260623060000:36,43): as opções públicas (`privado IS NOT TRUE`)
--     passavam para anônimo, incluindo o PREÇO do frete e a regra de frete
--     grátis.
--
-- CORREÇÃO: recriar as 4 iguais, só trocando `TO authenticated, anon` por
-- `TO authenticated`. A lógica do USING não muda em NADA — privacidade por
-- grupo, exclude/grant por cliente, `ativo`, `show_to_customers` e as funções
-- continuam exatamente como estão. Some apenas o acesso anônimo.
--
-- Staff continua entrando pelas próprias policies (admin/manager/warehouse já
-- retornam true dentro das funções de visibilidade).
-- ============================================================================

DROP POLICY IF EXISTS "Read produtos scoped" ON public.produtos;
CREATE POLICY "Read produtos scoped" ON public.produtos
  FOR SELECT TO authenticated
  USING (public.cliente_pode_ver_produto(id));

DROP POLICY IF EXISTS "Read categorias scoped" ON public.categorias;
CREATE POLICY "Read categorias scoped" ON public.categorias
  FOR SELECT TO authenticated
  USING (public.cliente_pode_ver_categoria(id));

DROP POLICY IF EXISTS "Read visible payment_options" ON public.payment_options;
CREATE POLICY "Read visible payment_options" ON public.payment_options
  FOR SELECT TO authenticated
  USING (ativo = true AND (privado IS NOT TRUE OR public.cliente_ve_payment_option(id)));

DROP POLICY IF EXISTS "Read visible shipping_options" ON public.shipping_options;
CREATE POLICY "Read visible shipping_options" ON public.shipping_options
  FOR SELECT TO authenticated
  USING (ativo = true AND show_to_customers IS NOT FALSE
         AND (privado IS NOT TRUE OR public.cliente_ve_shipping_option(id)));

-- ────────────────────────────────────────────────────────────────────────────
-- Conferência (a mesma da parte 1). Agora tem que voltar VAZIA de verdade:
--
--   SELECT schemaname, tablename, policyname, roles
--   FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY(roles);
-- ────────────────────────────────────────────────────────────────────────────
