
-- Create company_contacts table
CREATE TABLE public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  user_id uuid,
  nome text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'buyer',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage company_contacts" ON public.company_contacts FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Create cliente_payment_options table
CREATE TABLE public.cliente_payment_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  payment_option_id uuid NOT NULL REFERENCES public.payment_options(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, payment_option_id)
);
ALTER TABLE public.cliente_payment_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cliente_payment_options" ON public.cliente_payment_options FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Create cliente_shipping_options table
CREATE TABLE public.cliente_shipping_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  shipping_option_id uuid NOT NULL REFERENCES public.shipping_options(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, shipping_option_id)
);
ALTER TABLE public.cliente_shipping_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cliente_shipping_options" ON public.cliente_shipping_options FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Create api_keys table
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_value text NOT NULL,
  allowed_ips text,
  ativo boolean NOT NULL DEFAULT true,
  scopes jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage api_keys" ON public.api_keys FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Add missing columns to pedidos
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS shipping_costs numeric DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS is_paid boolean DEFAULT false;
