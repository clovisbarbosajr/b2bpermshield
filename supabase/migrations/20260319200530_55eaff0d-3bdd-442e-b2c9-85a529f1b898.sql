ALTER TABLE public.payment_options 
ADD COLUMN IF NOT EXISTS due_in_days integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS gateway_type text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS gateway_config jsonb DEFAULT '{}'::jsonb;