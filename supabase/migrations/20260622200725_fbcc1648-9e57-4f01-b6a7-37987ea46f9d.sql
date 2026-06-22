-- ============================================================================
-- NORMALIZA produto_acesso para usar privacy_group_id (uuid FK), consistente com
-- categoria_acesso. No ambiente, a migração anterior foi aplicada usando
-- grupo_nome (text → privacy_groups.nome). Aqui garantimos a coluna uuid + backfill
-- a partir do nome, e tornamos cliente_pode_ver_produto ROBUSTA aos dois formatos
-- (grupo_nome OU privacy_group_id) para nunca esconder produto por divergência.
-- ============================================================================

-- 1) Garante a coluna uuid + backfill a partir do nome do grupo.
ALTER TABLE public.produto_acesso
  ADD COLUMN IF NOT EXISTS privacy_group_id uuid REFERENCES public.privacy_groups(id) ON DELETE CASCADE;

UPDATE public.produto_acesso pa
SET privacy_group_id = pg.id
FROM public.privacy_groups pg
WHERE pa.privacy_group_id IS NULL
  AND pa.grupo_nome IS NOT NULL
  AND lower(trim(pa.grupo_nome)) = lower(trim(pg.nome));

-- 2) Função de visibilidade do produto: aceita os DOIS formatos de produto_acesso.
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
    RETURN true;  -- produto público (categoria já liberada)
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

  -- Grupo do produto: casa por privacy_group_id OU por grupo_nome (legado).
  RETURN EXISTS (
    SELECT 1
    FROM public.produto_acesso pa
    JOIN public.cliente_privacy_groups cpg ON cpg.cliente_id = _cli
    JOIN public.privacy_groups pg ON pg.id = cpg.privacy_group_id
    WHERE pa.produto_id = _prod_id
      AND (pa.privacy_group_id = pg.id
           OR lower(trim(pa.grupo_nome)) = lower(trim(pg.nome)))
  );
END;
$$;