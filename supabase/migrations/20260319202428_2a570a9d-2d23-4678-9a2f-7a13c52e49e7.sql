ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS desconto numeric DEFAULT 0;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS b2bwave_id integer;