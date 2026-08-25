-- ============================================================================
-- CONTA PENDENTE / INATIVA NAO VE O CATALOGO
--
-- O cadastro deste sistema e ABERTO, e `handle_new_user` da o papel `cliente` a
-- TODO `signUp` (20260331183125). Como as guardas de rota so olham o PAPEL
-- (`ProtectedRoute.tsx`, `LoginLanding.tsx`, `Index.tsx`), o papel nunca e nulo
-- e a tela `/pending-approval` NUNCA dispara — e codigo morto.
--
-- Nenhuma rota de `/portal/*` confere `clientes.status`, e as funcoes de
-- visibilidade tambem nao: `cliente_pode_ver_produto` (20260622200725) e
-- `cliente_pode_ver_categoria` (20260622200000) olham privacidade e grupo, e
-- devolvem `true` para todo produto NAO privado.
--
-- EXPLORACAO: qualquer pessoa cria conta em 30 segundos e ve o catalogo inteiro
-- com PRECO — e o estoque por variante, se a 20260825210000 ainda nao rodou.
-- Ficha `pendente` fica com `tabela_preco_id` NULL, entao ela ve a tabela BASE
-- inteira. E o vazamento de inteligencia comercial mais barato do sistema.
--
-- Consertar so a rota nao resolve: a chave anon esta no bundle e a consulta pode
-- ser feita direto na API. A trava tem que ser a mesma que serve as telas — as
-- funcoes de visibilidade.
--
-- DENYLIST, nao allowlist: a MESMA lista que `fn_block_order_inactive_customer`
-- (20260623020000) ja usa para barrar PEDIDO. Status desconhecido NAO bloqueia —
-- nao quero derrubar cliente legitimo cujo status ninguem previu, no dia do
-- lancamento. E as duas travas passam a concordar, que e o que importa: hoje o
-- sistema BARRA o pedido do pendente e MOSTRA o catalogo para ele.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde. Sao as contas que PERDEM acesso
-- ao catalogo no instante em que isto rodar. Se houver cliente de verdade na
-- lista, APROVE ANTES de aplicar.
--
--   SELECT id, nome, empresa, email, status, is_active, created_at
--   FROM public.clientes
--   WHERE is_active IS FALSE
--      OR lower(coalesce(status::text,'')) IN
--         ('pendente','inativo','rejeitado','suspenso',
--          'pending','inactive','rejected','suspended','blocked')
--   ORDER BY created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

-- Helper unico, para as duas funcoes de visibilidade nao divergirem com o tempo.
CREATE OR REPLACE FUNCTION public.cliente_conta_liberada()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _st  text;
  _act boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(_uid,'admin') OR public.has_role(_uid,'manager') OR public.has_role(_uid,'warehouse') THEN
    RETURN true;
  END IF;

  -- Sub-usuario herda a situacao da conta da EMPRESA (`parent_customer_id`):
  -- empresa suspensa suspende o funcionario. Mesmo `COALESCE(parent, id)` que as
  -- funcoes de visibilidade ja usam para escolher a ficha.
  SELECT dono.status::text, dono.is_active
    INTO _st, _act
  FROM public.clientes me
  JOIN public.clientes dono ON dono.id = COALESCE(me.parent_customer_id, me.id)
  WHERE me.user_id = _uid
  LIMIT 1;

  -- Sem ficha nenhuma: nao e cliente. `ensure_my_cliente_record` cria a ficha no
  -- login, entao este caso e login sem cadastro — nao ve catalogo.
  IF _st IS NULL AND _act IS NULL THEN
    RETURN false;
  END IF;

  IF _act IS FALSE THEN
    RETURN false;
  END IF;

  IF lower(coalesce(_st,'')) IN
     ('pendente','inativo','rejeitado','suspenso',
      'pending','inactive','rejected','suspended','blocked') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- As duas funcoes de visibilidade, com UMA checagem nova cada.
--
-- Reescritas por inteiro (nao da para remendar funcao no Postgres). O corpo
-- abaixo e o da versao viva — `cliente_pode_ver_categoria` de 20260622200000 e
-- `cliente_pode_ver_produto` de 20260622200725 — com o `IF NOT
-- cliente_conta_liberada()` logo depois do atalho de staff. Nada mais mudou.
-- ---------------------------------------------------------------------------

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

  -- NOVO: conta pendente/inativa nao ve nada.
  IF NOT public.cliente_conta_liberada() THEN
    RETURN false;
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

  -- NOVO: conta pendente/inativa nao ve nada. Antes daqui, o ramo
  -- "produto nao privado -> RETURN true" liberava o catalogo inteiro para quem
  -- tinha acabado de se cadastrar.
  IF NOT public.cliente_conta_liberada() THEN
    RETURN false;
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

COMMIT;

-- ---------------------------------------------------------------------------
-- CUSTO
--
-- `cliente_conta_liberada()` roda uma vez por LINHA, junto com as consultas que
-- estas funcoes ja fazem. E um JOIN de duas linhas por chave primaria, barato
-- perto do `WITH RECURSIVE` que a de categoria ja faz. Se o catalogo ficar
-- lento, o caminho e cachear no nivel da consulta, nao afrouxar a checagem.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO conserta a tela: `/pending-approval` continua inalcancavel, porque as
-- guardas de rota seguem olhando so o papel. O cliente pendente vai ver um
-- catalogo VAZIO em vez de ser redirecionado. Feio, e melhor que vazar preco.
-- A guarda de rota vai junto no publish (mudanca irma deste lote).
--
-- NAO mexe em `produtos.ativo`: produto desativado continua visivel para quem ja
-- podia ver. Item separado da fila (C7).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK — reinstala as duas funcoes SEM a checagem, rodando de novo, nesta
-- ordem, os arquivos:
--
--   20260622200000_fix_subcat_inherit.sql                    (categoria)
--   20260622200725_fbcc1648-9e57-4f01-b6a7-37987ea46f9d.sql  (produto)
--
-- e depois, opcionalmente:
--   DROP FUNCTION IF EXISTS public.cliente_conta_liberada();
--
-- ATENCAO: reverter reabre o catalogo com preco para qualquer pessoa que se
-- cadastre.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) As duas funcoes tem a checagem:
--   SELECT proname, prosrc LIKE '%cliente_conta_liberada%' AS tem_checagem
--   FROM pg_proc
--   WHERE proname IN ('cliente_pode_ver_produto','cliente_pode_ver_categoria');
--   -- esperado: true nas duas
--
-- 2) CONTROLE — o caminho BOM tem que continuar funcionando. Entre com um
--    cliente ATIVO e confira que o catalogo aparece igual a antes. Sem este
--    teste, uma funcao que devolve `false` para TODO mundo passaria como
--    "consertada".
--
-- 3) Entre com uma conta recem-cadastrada (status `pendente`) e confira que o
--    catalogo vem VAZIO.
-- ---------------------------------------------------------------------------
