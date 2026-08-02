-- ============================================================================
-- DECISÃO DO DONO (02/ago/2026): "Nada pode ser público. Só tem acesso a
-- produto do sistema se tiver login."
--
-- Sobravam 19 policies `FOR SELECT TO anon USING (true)` das migrations
-- iniciais (mar/2026), quando o catálogo era aberto. As rodadas de 18-19/jun
-- (20260618233000, 20260619163651) fecharam as mais graves — clientes,
-- pedidos, pedido_itens, enderecos, tabelas_preco, produtos... — mas estas
-- ficaram para trás.
--
-- O que ainda dava pra ler SEM LOGIN, só sabendo o endereço:
--   produto_descontos ....... a régua de desconto por quantidade (política comercial)
--   produto_arquivos ........ fichas técnicas / catálogos anexados
--   produto_imagens ......... galeria dos produtos
--   produto_variantes ....... tamanhos/cores e a QUANTIDADE em estoque de cada
--   produtos_relacionados ... o cruzamento de produtos
--   produto_opcoes .......... opções atribuídas
--   tax_* (4 tabelas) ....... grupos, classes, alíquotas e regras de imposto
--   coupons (ativo) ......... os cupons VÁLIDOS — dava pra pescar código de desconto
--   brands, product_statuses, measurement_units, extra_fields, privacy_groups
--   banners, noticias, quick_links
--
-- CONFERIDO ANTES DE FECHAR — nenhuma tela pública depende disso:
--   `/` (LoginLanding) ........ não consulta o banco
--   `/login`, `/customers-login`, `/admin-login`, `/recuperar-senha`,
--   `/reset-password` ......... só `supabase.auth.*`
--   `/cadastro` ............... `auth.signUp` + edge `register-customer`
--                               (service role, não passa por RLS)
--   `/pending-approval` ....... lê `clientes` JÁ logado
--   `/view-as` ................ exige sessão de admin
-- A config pública do portal continua vindo da RPC `get_public_config`, que
-- não depende destas policies.
--
-- As policies de `authenticated` e de staff seguem intactas: o portal logado
-- e o admin não mudam em nada.
-- ============================================================================

DROP POLICY IF EXISTS "Anon can read produto_descontos"    ON public.produto_descontos;
DROP POLICY IF EXISTS "Anon can read produto_arquivos"     ON public.produto_arquivos;
DROP POLICY IF EXISTS "Anon can read produto_imagens"      ON public.produto_imagens;
DROP POLICY IF EXISTS "Anon can read produto_variantes"    ON public.produto_variantes;
DROP POLICY IF EXISTS "Anon can read produtos_relacionados" ON public.produtos_relacionados;
DROP POLICY IF EXISTS "Anon can read produto_opcoes"       ON public.produto_opcoes;

DROP POLICY IF EXISTS "Anon can read tax_classes"          ON public.tax_classes;
DROP POLICY IF EXISTS "Anon can read tax_rates"            ON public.tax_rates;
DROP POLICY IF EXISTS "Anon can read tax_rules"            ON public.tax_rules;
DROP POLICY IF EXISTS "Anon can read tax_customer_groups"  ON public.tax_customer_groups;

DROP POLICY IF EXISTS "Anon can read active coupons"       ON public.coupons;
DROP POLICY IF EXISTS "Anon can read brands"               ON public.brands;
DROP POLICY IF EXISTS "Anon can read product_statuses"     ON public.product_statuses;
DROP POLICY IF EXISTS "Anon can read measurement_units"    ON public.measurement_units;
DROP POLICY IF EXISTS "Anon can read extra_fields"         ON public.extra_fields;
DROP POLICY IF EXISTS "Anon can read privacy_groups"       ON public.privacy_groups;
DROP POLICY IF EXISTS "Anon can read banners"              ON public.banners;
DROP POLICY IF EXISTS "Anon can read noticias"             ON public.noticias;
DROP POLICY IF EXISTS "Anon can read quick_links"          ON public.quick_links;

-- ────────────────────────────────────────────────────────────────────────────
-- Conferência: depois de rodar, esta consulta tem que voltar VAZIA.
-- Se aparecer alguma linha, é policy anônima que escapou (criada por outro
-- caminho, com nome diferente do padrão "Anon can read ...").
--
--   SELECT schemaname, tablename, policyname, roles
--   FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY(roles);
-- ────────────────────────────────────────────────────────────────────────────
