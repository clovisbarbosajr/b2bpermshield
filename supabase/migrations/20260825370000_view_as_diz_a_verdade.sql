-- ============================================================================
-- O "VIEW AS" PARA DE MENTIR
--
-- Apontado pelo cetico na revisao de 20260825280000.
--
-- Aquela migration fez conta pendente/inativa nao ver catalogo — mas so no
-- caminho REAL (`cliente_pode_ver_produto` / `cliente_pode_ver_categoria`, que
-- usam `auth.uid()`). As funcoes de PREVISUALIZACAO, que o staff usa para "ver
-- como" um cliente (`produto_visivel_para(_prod_id, _cli_id)` e
-- `categoria_visivel_para(_cat_id, _cli_id)`, de 20260703120000), nao ganharam a
-- checagem.
--
-- Resultado: o dono abre "ver como" um cliente pendente ou suspenso e ve o
-- CATALOGO CHEIO, enquanto o cliente de verdade ve ZERO. Nao e furo de
-- seguranca — e furo de DIAGNOSTICO, que e pior de outro jeito: e a ferramenta
-- que existe para responder "o que ele esta vendo?" dando a resposta errada. O
-- dono conclui que esta tudo certo e o cliente continua sem conseguir comprar.
--
-- ESTRUTURA: a lista de status bloqueados passa a existir UMA vez, em
-- `conta_liberada_de(_cli_id)`. As duas portas — a do proprio usuario
-- (`cliente_conta_liberada()`) e a do cliente-alvo (as de previsualizacao) —
-- chamam a mesma funcao. Antes de reescrever eu ia duplicar a lista; seria a
-- terceira copia dela no projeto.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Clientes para os quais o "ver como" vai passar a mostrar catalogo VAZIO — que
-- e o que eles ja veem hoje. Se algum aqui deveria estar comprando, o problema
-- nao e esta migration: e a situacao da conta dele.
--
--   SELECT c.id, c.nome, c.empresa, c.email, c.status, c.is_active,
--          dono.nome AS conta_da_empresa, dono.status AS status_do_pai
--   FROM public.clientes c
--   LEFT JOIN public.clientes dono ON dono.id = c.parent_customer_id
--   WHERE COALESCE(dono.is_active, c.is_active) IS FALSE
--      OR lower(coalesce(COALESCE(dono.status, c.status)::text,'')) IN
--         ('pendente','inativo','rejeitado','suspenso',
--          'pending','inactive','rejected','suspended','blocked')
--   ORDER BY c.nome;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- A lista, num lugar so ----------
CREATE OR REPLACE FUNCTION public.conta_liberada_de(_cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _st text; _act boolean;
BEGIN
  IF _cli_id IS NULL THEN
    RETURN false;
  END IF;

  -- Sub-usuario herda a situacao da conta da EMPRESA: empresa suspensa suspende
  -- o funcionario. LEFT JOIN de proposito — um `parent_customer_id` apontando
  -- para ficha inexistente nao pode ELIMINAR a linha e trancar um sub-usuario
  -- legitimo.
  SELECT COALESCE(dono.status, me.status)::text,
         COALESCE(dono.is_active, me.is_active)
    INTO _st, _act
  FROM public.clientes me
  LEFT JOIN public.clientes dono ON dono.id = me.parent_customer_id
  WHERE me.id = _cli_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _act IS FALSE THEN
    RETURN false;
  END IF;

  -- Denylist conservadora: status desconhecido NAO bloqueia. Mesma lista de
  -- `fn_block_order_inactive_customer` (20260623020000) e do gatilho de
  -- `disable_ordering` (20260825270000).
  IF lower(coalesce(_st,'')) IN
     ('pendente','inativo','rejeitado','suspenso',
      'pending','inactive','rejected','suspended','blocked') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ---------- A porta do proprio usuario passa a delegar ----------
-- Corpo identico ao de 20260825280000 no que decide, com a lista de status
-- saindo daqui para `conta_liberada_de`. O atalho de staff e a resolucao da
-- ficha pelo `user_id` continuam aqui, porque so fazem sentido para o CHAMADOR.
CREATE OR REPLACE FUNCTION public.cliente_conta_liberada()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(_uid,'admin') OR public.has_role(_uid,'manager') OR public.has_role(_uid,'warehouse') THEN
    RETURN true;
  END IF;

  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;
  IF _cid IS NULL THEN
    -- Sem ficha nao e cliente. `ensure_my_cliente_record` cria no login, entao
    -- este caso e login sem cadastro.
    RETURN false;
  END IF;

  RETURN public.conta_liberada_de(_cid);
END;
$$;

-- ---------- As duas de previsualizacao passam a dizer a verdade ----------
-- Corpos de 20260703120000, com UMA checagem nova no topo em cada.

CREATE OR REPLACE FUNCTION public.categoria_visivel_para(_cat_id uuid, _cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _gov uuid; _cli uuid;
BEGIN
  -- NOVO: conta bloqueada nao ve nada — igual ao caminho real.
  IF NOT public.conta_liberada_de(_cli_id) THEN RETURN false; END IF;

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
  -- NOVO: conta bloqueada nao ve nada — igual ao caminho real.
  IF NOT public.conta_liberada_de(_cli_id) THEN RETURN false; END IF;

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

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO muda o que o cliente ve. Muda o que o STAFF ve quando pergunta "o que ele
-- esta vendo?" — que passa a ser a mesma coisa.
--
-- NAO impede o staff de comprar em nome de um cliente bloqueado pelo "View As":
-- a sessao continua sendo a do admin, e o gatilho de pedido isenta admin/manager
-- de proposito (venda manual). O que muda e que o CATALOGO da previsualizacao
-- fica vazio, entao fica evidente que aquela conta esta bloqueada.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Reinstala as duas de previsualizacao rodando de novo
-- `20260703120000_privacy_view_as_mirror_fix.sql` (ele so contem essas duas funcoes — conferi), e a
-- `cliente_conta_liberada` colando o corpo de
-- `20260825280000_conta_pendente_nao_ve_catalogo.sql`.
--
--   DROP FUNCTION IF EXISTS public.conta_liberada_de(uuid);
--   -- (so depois de as tres acima terem voltado — elas a chamam)
--
-- ATENCAO: reverter faz o "ver como" voltar a mostrar catalogo cheio para conta
-- bloqueada.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) As tres apontam para a mesma lista:
--   SELECT proname, prosrc LIKE '%conta_liberada_de%' AS delega
--   FROM pg_proc
--   WHERE proname IN ('cliente_conta_liberada','categoria_visivel_para','produto_visivel_para')
--   ORDER BY proname;
--   -- esperado: true nas tres
--
-- 2) CONTROLE — o "ver como" um cliente ATIVO tem que continuar mostrando o
--    catalogo dele, com os precos dele. Sem este teste, uma checagem que zera
--    TODO mundo passaria como "consertada".
--
-- 3) O "ver como" um cliente pendente tem que mostrar catalogo VAZIO — que e o
--    que ele ja ve.
-- ---------------------------------------------------------------------------
