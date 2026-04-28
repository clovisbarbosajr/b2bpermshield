
-- Tax customer groups table
CREATE TABLE public.tax_customer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.tax_customer_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tax_customer_groups" ON public.tax_customer_groups FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anon can read tax_customer_groups" ON public.tax_customer_groups FOR SELECT TO anon USING (true);

-- Tax rules table (combines product class + customer group + rate)
CREATE TABLE public.tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_class_id uuid NOT NULL REFERENCES public.tax_classes(id) ON DELETE CASCADE,
  tax_customer_group_id uuid NOT NULL REFERENCES public.tax_customer_groups(id) ON DELETE CASCADE,
  tax_rate_id uuid NOT NULL REFERENCES public.tax_rates(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tax_rules" ON public.tax_rules FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anon can read tax_rules" ON public.tax_rules FOR SELECT TO anon USING (true);

-- Add is_default to tax_classes
ALTER TABLE public.tax_classes ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

-- Add name to tax_rates
ALTER TABLE public.tax_rates ADD COLUMN IF NOT EXISTS nome text DEFAULT '';
ALTER TABLE public.tax_rates ADD COLUMN IF NOT EXISTS estado text DEFAULT '';

-- Payment options: add privado, taxa_percentual, taxa_valor, cobrar_checkout
ALTER TABLE public.payment_options ADD COLUMN IF NOT EXISTS privado boolean DEFAULT false;
ALTER TABLE public.payment_options ADD COLUMN IF NOT EXISTS taxa_percentual numeric DEFAULT 0;
ALTER TABLE public.payment_options ADD COLUMN IF NOT EXISTS taxa_valor numeric DEFAULT 0;
ALTER TABLE public.payment_options ADD COLUMN IF NOT EXISTS cobrar_checkout boolean DEFAULT false;

-- Shipping options: add tax_class_id, padrao, tipo_regra, privado, condicoes
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS tax_class_id uuid REFERENCES public.tax_classes(id);
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS padrao boolean DEFAULT false;
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS tipo_regra text DEFAULT 'Per Order flat rate';
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS privado boolean DEFAULT false;
ALTER TABLE public.shipping_options ADD COLUMN IF NOT EXISTS condicoes jsonb DEFAULT '[]'::jsonb;

-- Product statuses: add permite_visualizar, permite_comprar
ALTER TABLE public.product_statuses ADD COLUMN IF NOT EXISTS permite_visualizar boolean DEFAULT true;
ALTER TABLE public.product_statuses ADD COLUMN IF NOT EXISTS permite_comprar boolean DEFAULT true;
