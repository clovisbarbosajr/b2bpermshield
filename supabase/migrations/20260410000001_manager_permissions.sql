-- ============================================================
-- Add manager role and per-user permissions
-- ============================================================

-- 1. Add manager to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 2. Add permissions JSONB column to user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;

-- 3. Index for faster JSON queries
CREATE INDEX IF NOT EXISTS idx_user_roles_permissions ON public.user_roles USING gin(permissions);
