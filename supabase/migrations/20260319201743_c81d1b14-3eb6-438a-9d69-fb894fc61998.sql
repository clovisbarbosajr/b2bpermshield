
-- Advanced sub-tab fields
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_head text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_body_open text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_body_close text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_css_admin text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_admin_body_open text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS custom_code_admin_body_close text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS conversion_google_reg text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS conversion_google_order text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS conversion_fb_reg text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS conversion_fb_order text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS cookie_policy_content text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS global_notification_type text DEFAULT 'none';
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS global_notification_content text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS meta_title_homepage text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS enable_support_button boolean DEFAULT true;

-- API Configuration
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS zapier_username text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS zapier_password text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS webhook_create_order text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS webhook_update_order text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS webhook_auth_header text;

-- Mobile App
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS mobile_app_enabled boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS mobile_allow_all_customers boolean DEFAULT false;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS mobile_allow_edit_prices boolean DEFAULT false;

-- Integrations
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS quickbooks_enabled boolean DEFAULT false;
