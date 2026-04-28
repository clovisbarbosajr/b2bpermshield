-- Add sales_tax and shipping_costs to pedidos
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS sales_tax numeric(10,2) DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS shipping_costs numeric(10,2) DEFAULT 0;

-- Add missing shipping_options fields
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS auto_apply boolean DEFAULT false;
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS show_to_customers boolean DEFAULT true;
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS tracking_url text;
