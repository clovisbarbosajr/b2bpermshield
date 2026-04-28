
-- Add integration columns to configuracoes table
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_provider text,
  ADD COLUMN IF NOT EXISTS email_api_key text,
  ADD COLUMN IF NOT EXISTS email_from text,
  ADD COLUMN IF NOT EXISTS email_on_new_registration boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_approval boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_rejection boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_new_order boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_on_order_status boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS stripe_publishable_key text,
  ADD COLUMN IF NOT EXISTS stripe_secret_key text,
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret text,
  ADD COLUMN IF NOT EXISTS stripe_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_order_without_payment boolean DEFAULT true;

-- Add payment_intent_id to pedidos for Stripe tracking
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS payment_intent_id text;
