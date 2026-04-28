
-- Add missing columns to pedidos
ALTER TABLE public.pedidos 
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS delivery_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS delivery_mode text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS shipping_option_id uuid REFERENCES public.shipping_options(id),
  ADD COLUMN IF NOT EXISTS payment_option_id uuid REFERENCES public.payment_options(id),
  ADD COLUMN IF NOT EXISTS quantidade_total integer DEFAULT 0;

-- Add missing columns to clientes
ALTER TABLE public.clientes 
  ADD COLUMN IF NOT EXISTS parent_customer_id uuid REFERENCES public.clientes(id),
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS endereco2 text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS pais text DEFAULT 'United States',
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS company_number text,
  ADD COLUMN IF NOT EXISTS customer_reference_code text,
  ADD COLUMN IF NOT EXISTS activity text,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'English (US)',
  ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_order_value numeric,
  ADD COLUMN IF NOT EXISTS admin_comments text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS disable_ordering boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_same_as_contact boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_customer_group_id uuid REFERENCES public.tax_customer_groups(id);

-- Junction table for client privacy groups
CREATE TABLE IF NOT EXISTS public.cliente_privacy_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  privacy_group_id uuid NOT NULL REFERENCES public.privacy_groups(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(cliente_id, privacy_group_id)
);

ALTER TABLE public.cliente_privacy_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cliente_privacy_groups" ON public.cliente_privacy_groups
  FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));
