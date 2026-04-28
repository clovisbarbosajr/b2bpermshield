
-- ============================================================
-- Company Contacts (sub-logins per company)
-- A company (clientes) can have multiple contact users.
-- Each contact has their own email/password and a role:
--   buyer    => can browse, add to cart, and place orders
--   viewer   => can browse and see prices, cannot place orders
--   manager  => same as buyer + can view all company orders
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'viewer', 'manager')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (email)
);

ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;

-- Admins can manage all contacts
CREATE POLICY "Admins manage company_contacts" ON public.company_contacts
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Contacts can read their own record (to know their own cliente_id)
CREATE POLICY "Contacts read own" ON public.company_contacts
  FOR SELECT USING (user_id = auth.uid());

-- Index for fast lookup by user_id (used at login to identify which company the contact belongs to)
CREATE INDEX IF NOT EXISTS company_contacts_user_id_idx ON public.company_contacts (user_id);
CREATE INDEX IF NOT EXISTS company_contacts_cliente_id_idx ON public.company_contacts (cliente_id);
