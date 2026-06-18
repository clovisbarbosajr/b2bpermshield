ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS b2bwave_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS produtos_b2bwave_id_key ON public.produtos(b2bwave_id) WHERE b2bwave_id IS NOT NULL;