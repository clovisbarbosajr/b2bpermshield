ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_on_new_registration boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_rejection        boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_approval         boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_new_order        boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_order_status     boolean DEFAULT true;