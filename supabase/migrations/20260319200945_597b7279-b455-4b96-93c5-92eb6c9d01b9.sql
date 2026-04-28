ALTER TABLE public.privacy_groups ADD COLUMN IF NOT EXISTS default_for_new_customers boolean DEFAULT false;

ALTER TABLE public.extra_fields ADD COLUMN IF NOT EXISTS view_location text DEFAULT 'product';
ALTER TABLE public.extra_fields ADD COLUMN IF NOT EXISTS show_to_customers boolean DEFAULT true;