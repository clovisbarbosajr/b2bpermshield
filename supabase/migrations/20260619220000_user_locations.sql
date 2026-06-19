-- ============================================================================
-- ACESSO POR LOCALIZAÇÃO para staff (joão só Florida, pedro só NY).
-- Localização = categoria de TOPO (Union NJ, Pompano Beach FL, ...). Um staff é
-- amarrado a uma ou mais dessas categorias. Staff SEM amarração = vê tudo (sem
-- restrição). Admin sempre vê tudo. Imposto no RLS da produção, não só na UI.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  categoria_id uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, categoria_id)
);
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

-- Admin/manager gerenciam as amarrações; o próprio staff lê as dele.
DROP POLICY IF EXISTS "Admins manage user_locations" ON public.user_locations;
CREATE POLICY "Admins manage user_locations" ON public.user_locations
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());
DROP POLICY IF EXISTS "User reads own locations" ON public.user_locations;
CREATE POLICY "User reads own locations" ON public.user_locations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Helper: o usuário logado pode ver o produto _produto_id?
-- (admin OU sem amarração OU a categoria-de-topo do produto está nas amarrações dele.)
CREATE OR REPLACE FUNCTION public.user_can_see_produto(_produto_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_id
    FROM public.categorias c
    JOIN public.produtos p ON p.categoria_id = c.id
    WHERE p.id = _produto_id
    UNION ALL
    SELECT c2.id, c2.parent_id
    FROM public.categorias c2
    JOIN chain ch ON c2.id = ch.parent_id
  )
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR NOT EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid()
        AND ul.categoria_id IN (SELECT id FROM chain WHERE parent_id IS NULL)
    );
$$;

-- RLS da produção passa a respeitar a localização do staff.
DROP POLICY IF EXISTS "Staff manage producao" ON public.producao_pedidos;
CREATE POLICY "Staff manage producao" ON public.producao_pedidos
  FOR ALL TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'warehouse'))
    AND public.user_can_see_produto(producao_pedidos.produto_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'warehouse'))
    AND public.user_can_see_produto(producao_pedidos.produto_id)
  );
