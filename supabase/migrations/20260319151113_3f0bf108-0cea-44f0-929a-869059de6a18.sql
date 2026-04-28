
-- OAuth Applications table
CREATE TABLE public.oauth_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  redirect_uri text DEFAULT '',
  logout_url text DEFAULT '',
  enforce boolean DEFAULT false,
  confidential boolean DEFAULT false,
  skip_authorization boolean DEFAULT false,
  scopes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.oauth_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage oauth_applications" ON public.oauth_applications FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Company Activities / Activity Log table
CREATE TABLE public.company_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  descricao text DEFAULT '',
  customer_name text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.company_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage company_activities" ON public.company_activities FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Add email_signature to configuracoes
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS email_signature text DEFAULT '';
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS enable_invoice boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS enable_scope boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS grid_list_default text DEFAULT 'grid';
