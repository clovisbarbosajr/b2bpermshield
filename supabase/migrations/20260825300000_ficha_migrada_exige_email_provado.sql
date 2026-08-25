-- ============================================================================
-- SEQUESTRO DE FICHA MIGRADA (A3)
--
-- `ensure_my_cliente_record` roda em TODO login (`AuthContext.initUserSession`).
-- Ela vincula a ficha de `clientes` ao usuario logado casando por E-MAIL:
--
--   WHERE lower(c.email) = _email
--     AND ( c.user_id IS NULL
--           OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id) )
--
-- O segundo ramo existe porque o sync grava `user_id: crypto.randomUUID()` para
-- todo cliente importado (`b2bwave-sync/index.ts:1266`) — um UUID que nunca
-- existiu em `auth.users`. Ou seja: **100% das fichas migradas sao reivindicaveis
-- por e-mail**, e elas chegam com `status = 'ativo'`.
--
-- O que o atacante herda ao vincular: pedidos, enderecos, `tabela_preco_id`,
-- `discount`, e conta ATIVA — que fecha pedido, porque
-- `fn_block_order_inactive_customer` so barra a denylist de status.
--
-- E NAO ha nenhuma exigencia de que o e-mail tenha sido PROVADO. Basta ter uma
-- sessao com aquele e-mail no JWT.
--
-- ----------------------------------------------------------------------------
-- HONESTIDADE SOBRE O ALCANCE DESTA MIGRATION
--
-- Esta trava fecha o caminho DIRETO e so vale se "Confirm email" estiver LIGADO
-- no painel do Auth. Com ele DESLIGADO, o Supabase marca todo cadastro como
-- confirmado no ato — a checagem abaixo passa e o sequestro continua possivel.
--
-- Ou seja: **ligar "Confirm email" e o conserto; isto aqui e a rede.** Sem a
-- rede, um dia em que a confirmacao for desligada por engano reabre tudo em
-- silencio; sem o toggle, a rede nao segura nada.
--
-- E existe um SEGUNDO caminho, que nem o toggle fecha sozinho — o pre-registro:
-- o atacante se cadastra ANTES com o e-mail da vitima, criando um auth user NAO
-- confirmado com a senha DELE; quando a vitima usa o link de acesso por e-mail,
-- o Supabase confirma AQUELA linha; e o atacante entra com a senha que escolheu.
-- Esse esta sendo fechado do lado da edge function `send-email`, no mesmo lote.
-- ----------------------------------------------------------------------------
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- 1) Fichas migradas ainda NAO reivindicadas (as que estao expostas hoje):
--
--   SELECT c.id, c.nome, c.empresa, c.email, c.status, c.created_at
--   FROM public.clientes c
--   WHERE c.email IS NOT NULL AND c.email <> ''
--     AND c.user_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id)
--   ORDER BY c.created_at;
--
-- 2) SINAL DE ABUSO — ficha vinculada a um login cujo e-mail NAO e o da ficha.
--    Uma vinculacao legitima sempre casa os dois. Se voltar alguma linha, aquele
--    login pegou a ficha de outra pessoa:
--
--   SELECT c.id, c.nome, c.email AS email_da_ficha, u.email AS email_do_login,
--          u.created_at AS login_criado_em, u.email_confirmed_at
--   FROM public.clientes c
--   JOIN auth.users u ON u.id = c.user_id
--   WHERE lower(coalesce(c.email,'')) <> lower(coalesce(u.email,''))
--   ORDER BY u.created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_my_cliente_record(_nome text DEFAULT '', _empresa text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid       uuid := auth.uid();
  _email     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _cid       uuid;
  _provado   boolean;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;

  -- STAFF (admin/manager/warehouse) NÃO é cliente: nunca cria nem vincula.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin','manager','warehouse')
  ) THEN
    RETURN NULL;
  END IF;

  -- já tem registro pelo user_id?
  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;
  IF _cid IS NOT NULL THEN RETURN _cid; END IF;

  -- >>> NOVO: o e-mail precisa estar PROVADO para reivindicar ficha alheia. <<<
  --
  -- Le de `auth.users`, e nao do JWT: o claim `email_verified` vem do provedor e
  -- pode estar ausente ou desatualizado numa sessao antiga. `email_confirmed_at`
  -- e o registro do proprio Supabase.
  SELECT (u.email_confirmed_at IS NOT NULL) INTO _provado
  FROM auth.users u WHERE u.id = _uid;

  -- Ficha com este e-mail e SEM DONO REAL (nula ou órfã do sync) -> vincula.
  -- Uma ficha que já pertence a um login existente NÃO é tocada.
  IF _email <> '' AND COALESCE(_provado, false) THEN
    SELECT c.id INTO _cid
    FROM public.clientes c
    WHERE lower(c.email) = _email
      AND (
        c.user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id)
      )
    ORDER BY c.created_at ASC
    LIMIT 1;

    IF _cid IS NOT NULL THEN
      UPDATE public.clientes SET user_id = _uid WHERE id = _cid;
      RETURN _cid;
    END IF;
  END IF;

  -- cliente novo: cria SEMPRE com defaults seguros.
  --
  -- Vale TAMBEM para quem chegou aqui com e-mail nao provado: ele ganha ficha
  -- PROPRIA e `pendente`, nao a de outra pessoa. Nao devolvo NULL porque o app
  -- espera um id; e a ficha pendente nao ve catalogo nem fecha pedido
  -- (20260825280000 e 20260623020000). Quando o e-mail for confirmado, o proximo
  -- login cai no ramo "ja tem registro pelo user_id" e devolve ESTA ficha — a
  -- vinculacao com a ficha migrada nao acontece mais sozinha, e passa a ser
  -- trabalho do admin (mesclar as duas fichas na tela de clientes).
  INSERT INTO public.clientes (user_id, nome, email, empresa, status, can_confirm_order, parent_customer_id, tabela_preco_id)
  VALUES (_uid, COALESCE(NULLIF(_nome, ''), NULLIF(_email, ''), 'Cliente'), _email, COALESCE(_empresa, ''),
          'pendente', false, NULL, NULL)
  RETURNING id INTO _cid;
  RETURN _cid;
END; $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- EFEITO COLATERAL QUE O DONO PRECISA SABER
--
-- Com "Confirm email" LIGADO, o cliente migrado que se cadastrar com senha so
-- vincula a ficha antiga DEPOIS de clicar no e-mail de confirmacao. Antes disso
-- ele tem uma ficha propria `pendente` e ve catalogo vazio.
--
-- O caminho bom para o migrado continua sendo o LINK DE ACESSO POR E-MAIL
-- ("One-Time Login Link"), que ja prova o e-mail por construcao.
--
-- Se aparecer cliente com DUAS fichas (a migrada e a nova pendente), e este
-- cenario: ele se cadastrou com senha antes de confirmar. Mesclar na tela de
-- clientes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK — reinstala a versao anterior, SEM a exigencia de e-mail provado.
-- Cole o corpo de `20260811120000_ensure_cliente_nao_rouba_ficha.sql`
-- (a funcao `ensure_my_cliente_record`, sem o bloco marcado `>>> NOVO`).
--
-- ATENCAO: reverter reabre a reivindicacao de ficha migrada por qualquer pessoa
-- que se cadastre com o e-mail do cliente.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao tem a checagem:
--   SELECT prosrc LIKE '%email_confirmed_at%' AS tem_checagem
--   FROM pg_proc WHERE proname = 'ensure_my_cliente_record';
--   -- esperado: true
--
-- 2) CONTROLE — o caminho BOM tem que continuar funcionando: peca um "One-Time
--    Login Link" para um cliente migrado, clique, e confira que ele cai na ficha
--    ANTIGA (com os pedidos dele), e nao numa ficha nova vazia.
--
-- 3) Rode de novo a consulta (2) do BACKUP: ela nao pode ganhar linha nova.
-- ---------------------------------------------------------------------------
