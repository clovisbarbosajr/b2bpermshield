
ALTER TABLE public.oauth_applications
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS client_id text NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
  ADD COLUMN IF NOT EXISTS client_secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex');
