ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS subcategorias_herdam boolean NOT NULL DEFAULT true;
ALTER TABLE public.produtos   ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.categoria_acesso (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id     uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  privacy_group_id uuid NOT NULL REFERENCES public.privacy_groups(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(categoria_id, privacy_group_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categoria_acesso TO authenticated;
GRANT ALL ON public.categoria_acesso TO service_role;
ALTER TABLE public.categoria_acesso ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.categoria_cliente_acesso (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('grant','exclude')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(categoria_id, cliente_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categoria_cliente_acesso TO authenticated;
GRANT ALL ON public.categoria_cliente_acesso TO service_role;
ALTER TABLE public.categoria_cliente_acesso ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.produto_cliente_acesso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('grant','exclude')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(produto_id, cliente_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_cliente_acesso TO authenticated;
GRANT ALL ON public.produto_cliente_acesso TO service_role;
ALTER TABLE public.produto_cliente_acesso ENABLE ROW LEVEL SECURITY;

-- produto_acesso usa grupo_nome (text) referindo privacy_groups.nome
UPDATE public.produtos p SET is_private = true
WHERE EXISTS (SELECT 1 FROM public.produto_acesso a
              WHERE a.produto_id = p.id AND a.grupo_nome IS NOT NULL)
  AND p.is_private = false;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categoria_acesso','categoria_cliente_acesso','produto_cliente_acesso'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage %1$s" ON public.%1$I', t);
    EXECUTE format($p$CREATE POLICY "Admins manage %1$s" ON public.%1$I
                      FOR ALL TO authenticated
                      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
                      WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))$p$, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.cliente_pode_ver_categoria(_cat_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cli uuid;
  _gov uuid;
BEGIN
  IF public.has_role(_uid,'admin') OR public.has_role(_uid,'manager') OR public.has_role(_uid,'warehouse') THEN
    RETURN true;
  END IF;

  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_id, c.is_private, 0 AS depth
    FROM public.categorias c WHERE c.id = _cat_id
    UNION ALL
    SELECT p.id, p.parent_id, p.is_private, ch.depth + 1
    FROM public.categorias p JOIN chain ch ON p.id = ch.parent_id
  )
  SELECT id INTO _gov FROM chain WHERE is_private ORDER BY depth LIMIT 1;

  IF _gov IS NULL THEN RETURN true; END IF;

  SELECT COALESCE(me.parent_customer_id, me.id) INTO _cli
  FROM public.clientes me WHERE me.user_id = _uid LIMIT 1;
  IF _cli IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.categoria_cliente_acesso x
             WHERE x.categoria_id = _gov AND x.cliente_id = _cli AND x.tipo = 'exclude') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.categoria_cliente_acesso x
             WHERE x.categoria_id = _gov AND x.cliente_id = _cli AND x.tipo = 'grant') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.categoria_acesso ca
    JOIN public.cliente_privacy_groups cpg ON cpg.privacy_group_id = ca.privacy_group_id
    WHERE ca.categoria_id = _gov AND cpg.cliente_id = _cli
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cliente_pode_ver_produto(_prod_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cli uuid;
  _cat uuid;
  _priv boolean;
BEGIN
  IF public.has_role(_uid,'admin') OR public.has_role(_uid,'manager') OR public.has_role(_uid,'warehouse') THEN
    RETURN true;
  END IF;

  SELECT categoria_id, is_private INTO _cat, _priv FROM public.produtos WHERE id = _prod_id;

  IF _cat IS NOT NULL AND NOT public.cliente_pode_ver_categoria(_cat) THEN
    RETURN false;
  END IF;

  IF NOT COALESCE(_priv, false) THEN
    RETURN true;
  END IF;

  SELECT COALESCE(me.parent_customer_id, me.id) INTO _cli
  FROM public.clientes me WHERE me.user_id = _uid LIMIT 1;
  IF _cli IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.produto_cliente_acesso x
             WHERE x.produto_id = _prod_id AND x.cliente_id = _cli AND x.tipo = 'exclude') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.produto_cliente_acesso x
             WHERE x.produto_id = _prod_id AND x.cliente_id = _cli AND x.tipo = 'grant') THEN
    RETURN true;
  END IF;
  -- produto_acesso.grupo_nome -> privacy_groups.nome
  RETURN EXISTS (
    SELECT 1 FROM public.produto_acesso pa
    JOIN public.privacy_groups pg ON pg.nome = pa.grupo_nome
    JOIN public.cliente_privacy_groups cpg ON cpg.privacy_group_id = pg.id
    WHERE pa.produto_id = _prod_id AND cpg.cliente_id = _cli
  );
END;
$$;

DROP POLICY IF EXISTS "Authenticated can read categorias" ON public.categorias;
DROP POLICY IF EXISTS "Anon can read categorias" ON public.categorias;
DROP POLICY IF EXISTS "Read categorias scoped" ON public.categorias;
CREATE POLICY "Read categorias scoped" ON public.categorias
  FOR SELECT TO authenticated, anon
  USING (public.cliente_pode_ver_categoria(id));

DROP POLICY IF EXISTS "Authenticated can read produtos" ON public.produtos;
DROP POLICY IF EXISTS "Anon can read produtos" ON public.produtos;
DROP POLICY IF EXISTS "Read produtos scoped" ON public.produtos;
CREATE POLICY "Read produtos scoped" ON public.produtos
  FOR SELECT TO authenticated, anon
  USING (public.cliente_pode_ver_produto(id));