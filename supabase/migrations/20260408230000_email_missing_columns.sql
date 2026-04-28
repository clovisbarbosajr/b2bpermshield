-- Add missing email toggle columns to configuracoes
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_on_new_registration boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_rejection        boolean DEFAULT true;
