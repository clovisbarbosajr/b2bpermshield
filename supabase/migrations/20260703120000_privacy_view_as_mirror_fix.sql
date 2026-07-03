-- ============================================================================
-- FIX (impersonação "view as"): as funções _visivel_para da migração
-- 20260701130000 NÃO espelhavam 1:1 as funções de RLS reais. Duas divergências
-- causavam SOBRE-RESTRIÇÃO no preview do admin (categorias/produtos que o cliente
-- REAL vê sumiam no "view as"). Sem vazamento — apenas mostrava menos que a realidade.
--
-- 1) categoria_visivel_para ignorava `subcategorias_herdam`: pegava SEMPRE o
--    ancestral privado mais próximo, mesmo quando ele NÃO cascateia (bug já
--    corrigido para a RLS em 20260622200000_fix_subcat_inherit). Alinhado aqui:
--    um nó governa só se for a própria categoria (depth 0) OU ancestral privado
--    que cascateia (subcategorias_herdam = true).
--
-- 2) produto_visivel_para casava produto_acesso só por privacy_group_id. A RLS
--    real (20260622200725) casa pelos DOIS formatos (privacy_group_id OU
--    grupo_nome legado) p/ não esconder produto por divergência. Alinhado aqui.
--
-- Só substitui as 2 funções-alvo (CREATE OR REPLACE). As RPCs staff-gated
-- (categorias_visiveis_cliente / produtos_visiveis_cliente) ficam inalteradas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.categoria_visivel_para(_cat_id uuid, _cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _gov uuid; _cli uuid;
BEGIN
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
  IF _gov IS NULL THEN RETURN true; END IF;                       -- pública
  SELECT COALESCE(parent_customer_id, id) INTO _cli FROM public.clientes WHERE id = _cli_id;
  IF _cli IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.categoria_cliente_acesso x WHERE x.categoria_id=_gov AND x.cliente_id=_cli AND x.tipo='exclude') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.categoria_cliente_acesso x WHERE x.categoria_id=_gov AND x.cliente_id=_cli AND x.tipo='grant') THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.categoria_acesso ca
    JOIN public.cliente_privacy_groups cpg ON cpg.privacy_group_id = ca.privacy_group_id
    WHERE ca.categoria_id = _gov AND cpg.cliente_id = _cli);
END; $$;

CREATE OR REPLACE FUNCTION public.produto_visivel_para(_prod_id uuid, _cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _cli uuid; _cat uuid; _priv boolean;
BEGIN
  SELECT categoria_id, is_private INTO _cat, _priv FROM public.produtos WHERE id = _prod_id;
  IF _cat IS NOT NULL AND NOT public.categoria_visivel_para(_cat, _cli_id) THEN RETURN false; END IF;
  IF NOT COALESCE(_priv, false) THEN RETURN true; END IF;
  SELECT COALESCE(parent_customer_id, id) INTO _cli FROM public.clientes WHERE id = _cli_id;
  IF _cli IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.produto_cliente_acesso x WHERE x.produto_id=_prod_id AND x.cliente_id=_cli AND x.tipo='exclude') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.produto_cliente_acesso x WHERE x.produto_id=_prod_id AND x.cliente_id=_cli AND x.tipo='grant') THEN RETURN true; END IF;
  -- Grupo do produto: casa por privacy_group_id OU por grupo_nome (legado), igual à RLS real.
  RETURN EXISTS (
    SELECT 1 FROM public.produto_acesso pa
    JOIN public.cliente_privacy_groups cpg ON cpg.cliente_id = _cli
    JOIN public.privacy_groups pg ON pg.id = cpg.privacy_group_id
    WHERE pa.produto_id = _prod_id
      AND (pa.privacy_group_id = pg.id
           OR lower(trim(pa.grupo_nome)) = lower(trim(pg.nome)))
  );
END; $$;
