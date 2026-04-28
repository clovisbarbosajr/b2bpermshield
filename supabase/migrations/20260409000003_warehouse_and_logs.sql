-- 1) Add 'warehouse' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'warehouse';

-- 2) Ensure user_roles has a single-column unique constraint on user_id
--    (needed for ON CONFLICT (user_id) upsert pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_unique' AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- 3) Activity logs table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email  text,
  user_name   text,
  action      text        NOT NULL, -- 'created' | 'updated' | 'deleted'
  entity_type text        NOT NULL, -- 'product' | 'customer' | 'order'
  entity_id   text,
  entity_name text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read logs
CREATE POLICY "Admins can view activity_logs"
  ON public.activity_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Authenticated users (admin + warehouse) can insert logs
CREATE POLICY "Authenticated users can insert activity_logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_entity_type_idx ON public.activity_logs (entity_type);
CREATE INDEX IF NOT EXISTS activity_logs_user_id_idx ON public.activity_logs (user_id);
