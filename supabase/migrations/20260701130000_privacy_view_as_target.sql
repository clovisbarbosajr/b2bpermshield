-- ============================================================================
-- IMPERSONAÇÃO ("view as customer") não escopava privacidade: como a sessão é do
-- ADMIN, cliente_pode_ver_categoria/produto (que checam auth.uid()) retornam TRUE
-- p/ staff -> o preview mostrava TODAS as categorias/produtos, não o que o cliente
-- veria. Cliente REAL (logado) sempre esteve correto (RLS filtra certo).
--
-- Fix: funções de visibilidade para um cliente ALVO (não auth.uid()) + RPCs que
-- devolvem os IDs visíveis daquele cliente. Só STAFF pode chamar (p/ o "view as").
-- Mesma lógica de cliente_pode_ver_categoria/produto (nó governante, grupos, grant/exclude,
-- herança sub-user->pai).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.categoria_visivel_para(_cat_id uuid, _cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _gov uuid; _cli uuid;
BEGIN
  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_id, c.is_private, 0 AS depth FROM public.categorias c WHERE c.id = _cat_id
    UNION ALL
    SELECT p.id, p.parent_id, p.is_private, ch.depth + 1 FROM public.categorias p JOIN chain ch ON p.id = ch.parent_id
  )
  SELECT id INTO _gov FROM chain WHERE is_private ORDER BY depth LIMIT 1;
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
  RETURN EXISTS (SELECT 1 FROM public.produto_acesso pa
    JOIN public.cliente_privacy_groups cpg ON cpg.privacy_group_id = pa.privacy_group_id
    WHERE pa.produto_id = _prod_id AND cpg.cliente_id = _cli);
END; $$;

-- RPCs para o front (impersonação): devolvem os IDs visíveis do cliente. SÓ STAFF.
CREATE OR REPLACE FUNCTION public.categorias_visiveis_cliente(_cli_id uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r uuid[];
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'warehouse'))
     THEN RETURN '{}'; END IF;
  SELECT array_agg(c.id) INTO _r FROM public.categorias c WHERE c.ativo AND public.categoria_visivel_para(c.id, _cli_id);
  RETURN COALESCE(_r, '{}');
END; $$;
GRANT EXECUTE ON FUNCTION public.categorias_visiveis_cliente(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.produtos_visiveis_cliente(_cli_id uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r uuid[];
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'warehouse'))
     THEN RETURN '{}'; END IF;
  SELECT array_agg(p.id) INTO _r FROM public.produtos p WHERE p.ativo AND public.produto_visivel_para(p.id, _cli_id);
  RETURN COALESCE(_r, '{}');
END; $$;
GRANT EXECUTE ON FUNCTION public.produtos_visiveis_cliente(uuid) TO authenticated;
