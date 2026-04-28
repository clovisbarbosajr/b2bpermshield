
-- Social Media
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS twitter_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS pinterest_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS youtube_url text;

-- Email Notifications
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS email_new_customer text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS email_new_orders text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS attach_xls_order boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS attach_pdf_order boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS bcc_outgoing_emails text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS email_order_messages text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS contact_form_email text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS contact_form_cc text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS contact_form_bcc text;

-- Application Configuration (stored as jsonb for many boolean toggles)
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS app_configuration jsonb DEFAULT '{}';

-- Customer Registration Fields (jsonb for field visibility toggles)
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS registration_fields jsonb DEFAULT '{}';

-- Default Values
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS item_ordering text DEFAULT 'Yes';
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS cases_order text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS segments text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS default_product_image text;

-- Advanced
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS enable_secure_login boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS google_analytics_code text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_css text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS conversion_tracking text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_admin text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS cookie_policy_banner text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS global_notification text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS admin_title_homepage text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS api_token text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS app_code text;

-- Appearance extras
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS footer_logo_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS catalog_logo_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS catalog_header_url text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS theme text DEFAULT 'default';
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS featured_categories text;

-- API Configuration
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS api_configuration jsonb DEFAULT '{}';
