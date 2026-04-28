
-- Add missing columns to product_options
ALTER TABLE public.product_options ADD COLUMN IF NOT EXISTS codigo text DEFAULT '';
ALTER TABLE public.product_options ADD COLUMN IF NOT EXISTS max_items integer DEFAULT 0;

-- Add missing columns to option_values
ALTER TABLE public.option_values ADD COLUMN IF NOT EXISTS codigo text DEFAULT '';
ALTER TABLE public.option_values ADD COLUMN IF NOT EXISTS imagem_url text DEFAULT '';
ALTER TABLE public.option_values ADD COLUMN IF NOT EXISTS cor text DEFAULT '';
ALTER TABLE public.option_values ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE public.option_values ADD COLUMN IF NOT EXISTS padrao boolean DEFAULT false;
