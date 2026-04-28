
ALTER TABLE public.tax_rates ADD COLUMN IF NOT EXISTS ordem integer DEFAULT 0;
ALTER TABLE public.tax_classes ADD COLUMN IF NOT EXISTS ordem integer DEFAULT 0;
ALTER TABLE public.tax_customer_groups ADD COLUMN IF NOT EXISTS ordem integer DEFAULT 0;
