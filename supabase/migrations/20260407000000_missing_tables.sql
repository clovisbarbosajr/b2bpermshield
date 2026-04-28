
-- ============================================================
-- Migration: Add missing tables (api_keys, customer options,
--            fix produto_acesso schema)
-- ============================================================

-- 1) API Keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_value text NOT NULL,
  scopes text[] DEFAULT '{}',
  allowed_ips text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage api_keys" ON public.api_keys
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Customer-specific payment options (which payment methods this customer can use)
CREATE TABLE IF NOT EXISTS public.cliente_payment_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  payment_option_id uuid NOT NULL REFERENCES payment_options(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (cliente_id, payment_option_id)
);
ALTER TABLE public.cliente_payment_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cliente_payment_options" ON public.cliente_payment_options
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Customer-specific shipping options
CREATE TABLE IF NOT EXISTS public.cliente_shipping_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  shipping_option_id uuid NOT NULL REFERENCES shipping_options(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (cliente_id, shipping_option_id)
);
ALTER TABLE public.cliente_shipping_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage cliente_shipping_options" ON public.cliente_shipping_options
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) Fix produto_acesso: add privacy_group_id column, make grupo_nome nullable
--    (keep grupo_nome for backward compat but use privacy_group_id going forward)
ALTER TABLE public.produto_acesso
  ADD COLUMN IF NOT EXISTS privacy_group_id uuid REFERENCES privacy_groups(id) ON DELETE CASCADE;

ALTER TABLE public.produto_acesso
  ALTER COLUMN grupo_nome DROP NOT NULL;
