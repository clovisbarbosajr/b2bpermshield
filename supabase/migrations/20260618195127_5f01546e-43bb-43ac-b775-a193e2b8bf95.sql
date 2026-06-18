
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS stripe_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_publishable_key text;

CREATE OR REPLACE FUNCTION public.get_public_config()
RETURNS TABLE(stripe_enabled boolean, stripe_publishable_key text, catalog_pdf_url text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT stripe_enabled, stripe_publishable_key, catalog_pdf_url
  FROM public.configuracoes LIMIT 1
$$;
