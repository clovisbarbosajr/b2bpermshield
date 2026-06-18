-- ============================================================================
-- Garante as colunas de Stripe que o código espera em `configuracoes`
-- (Checkout, stripe-checkout e get_public_config). Sem elas a função
-- get_public_config falhava na criação e precisou ser ajustada ao aplicar.
-- Adiciona as colunas (idempotente) e restaura a função canônica.
-- Stripe permanece DESLIGADO até preencher a chave + marcar stripe_enabled.
-- ============================================================================

ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS stripe_enabled boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS stripe_publishable_key text;

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
    COALESCE(stripe_enabled, false) AS stripe_enabled,
    stripe_publishable_key,
    catalog_pdf_url
  FROM public.configuracoes
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_public_config() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_config() TO authenticated;
