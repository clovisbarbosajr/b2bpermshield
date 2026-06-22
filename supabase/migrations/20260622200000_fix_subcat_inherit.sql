-- ============================================================================
-- FIX: cliente_pode_ver_categoria ignorava a flag `subcategorias_herdam`.
-- O walk recursivo pegava SEMPRE o ancestral privado mais próximo, mesmo que
-- esse ancestral tivesse "subcategorias herdam = false" (= só ele é restrito,
-- filhos públicos). Resultado: filhos eram escondidos errado (over-restrição).
--
-- Correção: um nó governa a categoria se for a PRÓPRIA (depth 0) OU um ancestral
-- privado que de fato CASCATEIA (subcategorias_herdam = true). Sem nó governante
-- => pública. (Não há vazamento — é só correção da herança.)
-- ============================================================================
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
    SELECT c.id, c.parent_id, c.is_private, c.subcategorias_herdam, 0 AS depth
    FROM public.categorias c WHERE c.id = _cat_id
    UNION ALL
    SELECT p.id, p.parent_id, p.is_private, p.subcategorias_herdam, ch.depth + 1
    FROM public.categorias p JOIN chain ch ON p.id = ch.parent_id
  )
  SELECT id INTO _gov FROM chain
  WHERE is_private AND (depth = 0 OR subcategorias_herdam)   -- ancestral só governa se cascateia
  ORDER BY depth LIMIT 1;

  IF _gov IS NULL THEN RETURN true; END IF;  -- pública

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
