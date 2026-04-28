ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_provider text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_from text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_api_key text DEFAULT NULL;