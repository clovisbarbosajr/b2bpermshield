-- ============================================================================
-- SECURITY CRITICAL FIXES (2026-06-18)
-- Corrige: 0-1 (anon lê dados de clientes/pedidos/preços) e
--          7-2 (segredos em `configuracoes` legíveis por qualquer usuário logado)
-- Ver REVIEW_PARTE_0.md / REVIEW_PARTE_7.md / BUGS.md (A1, A2).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1 / 0-1 — Remover leitura ANON de tabelas com PII / pedidos / preços.
-- Essas policies foram criadas para "demo mode", mas expõem o banco inteiro
-- via a chave pública (anon). As leituras legítimas (cliente logado) usam o
-- papel `authenticated`, que continua coberto pelas policies owner-scoped.
-- O catálogo genérico (produtos/categorias/brands/banners/noticias) é mantido.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can read clientes"            ON public.clientes;
DROP POLICY IF EXISTS "Anon can read pedidos"             ON public.pedidos;
DROP POLICY IF EXISTS "Anon can read pedido_itens"        ON public.pedido_itens;
DROP POLICY IF EXISTS "Anon can read tabelas_preco"       ON public.tabelas_preco;
DROP POLICY IF EXISTS "Anon can read tabela_preco_itens"  ON public.tabela_preco_itens;
DROP POLICY IF EXISTS "Anon can read produto_precos_cliente" ON public.produto_precos_cliente;
DROP POLICY IF EXISTS "Anon can read representantes"      ON public.representantes;

-- ----------------------------------------------------------------------------
-- A2 / 7-2 — `configuracoes` guarda segredos (stripe_secret_key, smtp_password,
-- stripe_webhook_secret, api_token, zapier_password, webhook_auth_header).
-- A policy antiga liberava SELECT a QUALQUER usuário autenticado (inclusive
-- clientes externos). Restringimos a leitura a STAFF interno (admin/manager/
-- warehouse). O portal do cliente passa a ler apenas campos não-secretos via
-- a função `get_public_config()` abaixo.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read configuracoes" ON public.configuracoes;

CREATE POLICY "Staff can read configuracoes" ON public.configuracoes
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );
-- (A policy "Admins can manage configuracoes" FOR ALL continua existindo.)

-- RPC com APENAS campos seguros (não-secretos) que o portal do cliente precisa.
-- SECURITY DEFINER: roda como owner e ignora a RLS de `configuracoes`,
-- retornando somente as colunas listadas — nenhum segredo é exposto.
CREATE OR REPLACE FUNCTION public.get_public_config()
RETURNS TABLE (
  stripe_enabled boolean,
  stripe_publishable_key text,
  catalog_pdf_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(stripe_enabled, false)        AS stripe_enabled,
    stripe_publishable_key,
    catalog_pdf_url
  FROM public.configuracoes
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_public_config() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_config() TO authenticated;
