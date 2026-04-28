
-- Product statuses table (custom statuses like Available, Limited Stock, etc.)
CREATE TABLE IF NOT EXISTS public.product_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cor text DEFAULT '#6b7280',
  ordem integer DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.product_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage product_statuses" ON public.product_statuses FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read product_statuses" ON public.product_statuses FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can read product_statuses" ON public.product_statuses FOR SELECT TO authenticated USING (true);

-- Insert default statuses
INSERT INTO public.product_statuses (nome, cor, ordem) VALUES
  ('Available', '#22c55e', 1),
  ('Limited Stock', '#f59e0b', 2),
  ('Sold Out', '#ef4444', 3),
  ('Pre-order', '#3b82f6', 4),
  ('Not Available', '#6b7280', 5),
  ('Discontinued', '#991b1b', 6);

-- Measurement units table
CREATE TABLE IF NOT EXISTS public.measurement_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  abreviacao text NOT NULL,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage measurement_units" ON public.measurement_units FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read measurement_units" ON public.measurement_units FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can read measurement_units" ON public.measurement_units FOR SELECT TO authenticated USING (true);

INSERT INTO public.measurement_units (nome, abreviacao) VALUES
  ('Unit', 'un'), ('Kilogram', 'kg'), ('Gram', 'g'), ('Pound', 'lb'),
  ('Meter', 'm'), ('Centimeter', 'cm'), ('Square Meter', 'm²'),
  ('Square Foot', 'sq ft'), ('Liter', 'L'), ('Box', 'box'), ('Pallet', 'plt');

-- Sales tax classes
CREATE TABLE IF NOT EXISTS public.tax_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.tax_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tax_classes" ON public.tax_classes FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read tax_classes" ON public.tax_classes FOR SELECT TO anon USING (true);

INSERT INTO public.tax_classes (nome, descricao) VALUES
  ('Non-Taxable', 'Products exempt from sales tax'),
  ('Standard Rate', 'Standard sales tax rate'),
  ('Reduced Rate', 'Reduced sales tax rate');

-- Tax rates per region
CREATE TABLE IF NOT EXISTS public.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_class_id uuid NOT NULL REFERENCES tax_classes(id) ON DELETE CASCADE,
  regiao text NOT NULL,
  percentual numeric NOT NULL DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tax_rates" ON public.tax_rates FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read tax_rates" ON public.tax_rates FOR SELECT TO anon USING (true);

-- Coupons table
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  tipo text NOT NULL DEFAULT 'percentual',
  valor numeric NOT NULL DEFAULT 0,
  uso_maximo integer,
  uso_atual integer DEFAULT 0,
  data_inicio timestamp with time zone,
  data_fim timestamp with time zone,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read active coupons" ON public.coupons FOR SELECT TO anon USING (ativo = true);

-- Privacy groups table
CREATE TABLE IF NOT EXISTS public.privacy_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.privacy_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage privacy_groups" ON public.privacy_groups FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read privacy_groups" ON public.privacy_groups FOR SELECT TO anon USING (true);

-- Quick links table
CREATE TABLE IF NOT EXISTS public.quick_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  url text NOT NULL,
  icone text,
  ordem integer DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.quick_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage quick_links" ON public.quick_links FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read quick_links" ON public.quick_links FOR SELECT TO anon USING (ativo = true);

-- Payment options table
CREATE TABLE IF NOT EXISTS public.payment_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  instrucoes text,
  ativo boolean DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.payment_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage payment_options" ON public.payment_options FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read payment_options" ON public.payment_options FOR SELECT TO anon USING (ativo = true);

-- Shipping options table
CREATE TABLE IF NOT EXISTS public.shipping_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  preco numeric DEFAULT 0,
  gratis_acima_de numeric,
  ativo boolean DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.shipping_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage shipping_options" ON public.shipping_options FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read shipping_options" ON public.shipping_options FOR SELECT TO anon USING (ativo = true);

-- Email templates table
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  assunto text NOT NULL,
  corpo text NOT NULL,
  tipo text NOT NULL DEFAULT 'order',
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage email_templates" ON public.email_templates FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Extra fields table
CREATE TABLE IF NOT EXISTS public.extra_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'text',
  entidade text NOT NULL DEFAULT 'product',
  obrigatorio boolean DEFAULT false,
  opcoes jsonb DEFAULT '[]',
  ativo boolean DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.extra_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage extra_fields" ON public.extra_fields FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read extra_fields" ON public.extra_fields FOR SELECT TO anon USING (true);

-- Import/export logs
CREATE TABLE IF NOT EXISTS public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  arquivo_nome text,
  registros_total integer DEFAULT 0,
  registros_sucesso integer DEFAULT 0,
  registros_erro integer DEFAULT 0,
  status text DEFAULT 'pendente',
  detalhes jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage import_logs" ON public.import_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  arquivo_url text,
  registros integer DEFAULT 0,
  status text DEFAULT 'pendente',
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage export_logs" ON public.export_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
