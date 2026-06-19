
CREATE TABLE IF NOT EXISTS public.user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, categoria_id)
);

GRANT SELECT ON public.user_locations TO authenticated;
GRANT ALL ON public.user_locations TO service_role;

ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own locations" ON public.user_locations;
CREATE POLICY "Users read own locations" ON public.user_locations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage user_locations" ON public.user_locations;
CREATE POLICY "Admins manage user_locations" ON public.user_locations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_user_locations_user ON public.user_locations(user_id);

CREATE OR REPLACE FUNCTION public.user_can_see_produto(_produto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE
  has_any AS (SELECT EXISTS(SELECT 1 FROM public.user_locations WHERE user_id = auth.uid()) AS v),
  prod AS (SELECT categoria_id FROM public.produtos WHERE id = _produto_id),
  chain AS (
    SELECT c.id, c.parent_id FROM public.categorias c
    WHERE c.id = (SELECT categoria_id FROM prod)
    UNION ALL
    SELECT c.id, c.parent_id FROM public.categorias c
    JOIN chain ch ON ch.parent_id = c.id
  ),
  root AS (SELECT id FROM chain WHERE parent_id IS NULL LIMIT 1)
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN true
    WHEN NOT (SELECT v FROM has_any) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid()
        AND ul.categoria_id = (SELECT id FROM root)
    )
  END;
$$;

DROP POLICY IF EXISTS "Staff manage producao" ON public.producao_pedidos;
CREATE POLICY "Staff manage producao" ON public.producao_pedidos
  FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin')
     OR public.has_role(auth.uid(), 'manager')
     OR public.has_role(auth.uid(), 'warehouse'))
    AND public.user_can_see_produto(produto_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin')
     OR public.has_role(auth.uid(), 'manager')
     OR public.has_role(auth.uid(), 'warehouse'))
    AND public.user_can_see_produto(produto_id)
  );
