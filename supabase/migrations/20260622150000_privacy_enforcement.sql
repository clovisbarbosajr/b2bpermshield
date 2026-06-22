-- ============================================================================
-- PRIVACIDADE de categoria/produto (modelo B2BWave) — FASE 1 (schema) + FASE 2 (RLS).
--
-- Modelo: um item (categoria OU produto) pode ser `is_private`. Item privado é
-- visível só a: clientes nos grupos do item, OU clientes concedidos (grant),
-- MENOS clientes excluídos (exclude). Subcategorias herdam o nó privado mais
-- próximo na árvore (flag subcategorias_herdam, default true). Item público = todos.
--
-- Antes: RLS de categorias/produtos era USING(true) -> privado VAZAVA (qualquer
-- logado/anon lia tudo direto). Agora o RLS passa a respeitar a privacidade.
-- IMPORTANTE: defaults mantêm tudo PÚBLICO; comportamento só muda quando algo é
-- marcado privado (UI admin / scrape). Staff (admin/manager/warehouse) vê tudo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FASE 1 — schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS subcategorias_herdam boolean NOT NULL DEFAULT true;
ALTER TABLE public.produtos   ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- Grupos de privacidade COM acesso a uma categoria privada (M:N).
CREATE TABLE IF NOT EXISTS public.categoria_acesso (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id     uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  privacy_group_id uuid NOT NULL REFERENCES public.privacy_groups(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(categoria_id, privacy_group_id)
);
ALTER TABLE public.categoria_acesso ENABLE ROW LEVEL SECURITY;

-- Concessão/exclusão de cliente específico numa categoria.
CREATE TABLE IF NOT EXISTS public.categoria_cliente_acesso (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('grant','exclude')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(categoria_id, cliente_id)
);
ALTER TABLE public.categoria_cliente_acesso ENABLE ROW LEVEL SECURITY;

-- Concessão/exclusão de cliente específico num produto (os GRUPOS do produto já
-- existem em produto_acesso.privacy_group_id).
CREATE TABLE IF NOT EXISTS public.produto_cliente_acesso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('grant','exclude')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(produto_id, cliente_id)
);
ALTER TABLE public.produto_cliente_acesso ENABLE ROW LEVEL SECURITY;

-- Preserva o comportamento atual: produto que já tinha restrição por grupo
-- (produto_acesso) passa a contar como privado de fato.
UPDATE public.produtos p SET is_private = true
WHERE EXISTS (SELECT 1 FROM public.produto_acesso a
              WHERE a.produto_id = p.id AND a.privacy_group_id IS NOT NULL)
  AND p.is_private = false;

-- Admin gerencia as 3 tabelas de acesso; cliente lê as que lhe dizem respeito
-- (necessário para o RLS de catálogo resolver via funções SECURITY DEFINER — que
-- já ignoram RLS — mas mantemos leitura mínima coerente).
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

-- ----------------------------------------------------------------------------
-- FASE 2 — funções de visibilidade + RLS enforced
-- ----------------------------------------------------------------------------

-- O cliente logado pode ver a CATEGORIA _cat_id?
-- Regra: staff vê tudo. Acha o nó governante = ancestral-ou-próprio privado mais
-- próximo. Sem nó privado => público (todos veem). Com nó privado => vê se o
-- cliente (ou seu PAI, se sub-usuário) está concedido OU num grupo do nó, e NÃO
-- está excluído. Anon/sem cadastro só vê público.
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

  IF _gov IS NULL THEN RETURN true; END IF;  -- pública

  -- Cliente efetivo: sub-usuário usa a privacidade do PAI.
  SELECT COALESCE(me.parent_customer_id, me.id) INTO _cli
  FROM public.clientes me WHERE me.user_id = _uid LIMIT 1;
  IF _cli IS NULL THEN RETURN false; END IF;  -- anon/sem cadastro não vê privado

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

-- O cliente logado pode ver o PRODUTO _prod_id?
-- Regra: staff tudo. Precisa ver a categoria do produto E (se o produto for
-- privado) estar concedido/num grupo do produto e não excluído.
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

  -- Precisa enxergar a categoria (herança/grupos da categoria).
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
  RETURN EXISTS (
    SELECT 1 FROM public.produto_acesso pa
    JOIN public.cliente_privacy_groups cpg ON cpg.privacy_group_id = pa.privacy_group_id
    WHERE pa.produto_id = _prod_id AND cpg.cliente_id = _cli
  );
END;
$$;

-- ---------- RLS categorias: troca USING(true) por visibilidade ----------
DROP POLICY IF EXISTS "Authenticated can read categorias" ON public.categorias;
DROP POLICY IF EXISTS "Anon can read categorias" ON public.categorias;
DROP POLICY IF EXISTS "Read categorias scoped" ON public.categorias;
CREATE POLICY "Read categorias scoped" ON public.categorias
  FOR SELECT TO authenticated, anon
  USING (public.cliente_pode_ver_categoria(id));

-- ---------- RLS produtos: idem ----------
DROP POLICY IF EXISTS "Authenticated can read produtos" ON public.produtos;
DROP POLICY IF EXISTS "Anon can read produtos" ON public.produtos;
DROP POLICY IF EXISTS "Read produtos scoped" ON public.produtos;
CREATE POLICY "Read produtos scoped" ON public.produtos
  FOR SELECT TO authenticated, anon
  USING (public.cliente_pode_ver_produto(id));
