CREATE TABLE IF NOT EXISTS public.sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  created_count int  NOT NULL DEFAULT 0,
  updated_count int  NOT NULL DEFAULT 0,
  skipped_count int  NOT NULL DEFAULT 0,
  errors_count  int  NOT NULL DEFAULT 0,
  samples       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read sync_log" ON public.sync_log
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );

CREATE INDEX IF NOT EXISTS sync_log_created_idx ON public.sync_log (created_at DESC);
CREATE INDEX IF NOT EXISTS sync_log_action_created_idx ON public.sync_log (action, created_at DESC);