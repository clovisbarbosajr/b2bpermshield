-- ============================================================================
-- SEGREDOS DE `configuracoes` PARAM DE SER LEGIVEIS POR manager/warehouse (A2)
--
-- A policy viva libera SELECT da tabela para os TRES papeis de staff:
--
--   CREATE POLICY "Staff can read configuracoes" ON public.configuracoes
--     FOR SELECT USING (has_role(...,'admin') OR has_role(...,'manager')
--                       OR has_role(...,'warehouse'));
--
-- E RLS no Postgres e por LINHA, nao por coluna. Passou a policy, levou a linha
-- inteira — e nessa linha moram, no minimo:
--
--   api_token             -> bearer da edge `api`, que roda com SERVICE ROLE.
--                            Quem tem esse token le e escreve o banco inteiro
--                            SEM RLS. E o pior item da tabela.
--   stripe_secret_key     -> acesso total a conta Stripe
--   stripe_webhook_secret -> permite FORJAR webhook e marcar pedido como pago
--   email_api_key         -> chave do Resend/SendGrid
--   smtp_username/password, zapier_username/password, webhook_auth_header
--
-- E nao e teorico: `EmailSettings.tsx` e `Profile.tsx` fazem `select("*")` e sao
-- rotas que o MANAGER alcanca (`view_email_settings` e `view_profile_settings`
-- vem `true` no default do manager em `src/lib/permissions.ts`). O `Profile`
-- ainda RENDERIZA `api_token` e `zapier_password` em texto puro. O manager ja
-- recebe tudo isso no navegador, sem precisar de devtools.
--
-- Para o warehouse a tela e comportada (so pede colunas `warehouse_*`), mas isso
-- e disciplina de front, nao controle: a chave anon esta no bundle, e um
-- `select("stripe_secret_key")` no console volta preenchido.
--
-- POR QUE NAO "PRIVILEGIO POR COLUNA": `admin`, `manager` e `warehouse` sao o
-- MESMO papel do Postgres (`authenticated`) — privilegio de coluna nao enxerga
-- `has_role()`, entao a restricao atingiria o admin junto e quebraria a tela de
-- configuracao dele. (E `REVOKE SELECT (col)` sozinho nem faria efeito: no
-- Postgres, revogar privilegio de COLUNA nao revoga o de TABELA, e o Supabase ja
-- concede o de tabela no bootstrap.)
--
-- CONSERTO: a tabela passa a ser de ADMIN. O que o staff nao-admin realmente
-- precisa sai por uma funcao que devolve SO colunas nao secretas.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- 1) As policies atuais da tabela (para reconstruir se precisar):
--
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'configuracoes'
--   ORDER BY policyname;
--
-- 2) QUANTAS LINHAS de configuracao existem. Deveria ser 1. Nao ha UNIQUE nem
--    CHECK garantindo isso, e duas telas fazem `insert({})` quando o SELECT vem
--    vazio — inclusive quando vem vazio por ERRO. Se voltar mais de uma, me
--    avise ANTES de rodar: telas diferentes podem estar lendo linhas
--    diferentes.
--
--   SELECT id, created_at FROM public.configuracoes ORDER BY created_at;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) A tabela vira de admin ----------
-- `DROP IF EXISTS` nos dois nomes de propósito: 20260618000000 e 20260618193846
-- criam a MESMA policy com o MESMO nome, e a segunda so dropa o nome ANTIGO —
-- entao nao da para saber daqui qual das duas vingou no banco. Dropar os dois
-- nomes deixa o estado deterministico.
DROP POLICY IF EXISTS "Staff can read configuracoes"         ON public.configuracoes;
DROP POLICY IF EXISTS "Authenticated can read configuracoes" ON public.configuracoes;

CREATE POLICY "Admin reads configuracoes" ON public.configuracoes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- A policy de ESCRITA ("Admins can manage configuracoes", 20260318182853) fica
-- como esta: ja e admin-only. Registro aqui porque isso significa que o manager
-- NUNCA conseguiu salvar nessas telas — o UPDATE passava pela RLS afetando ZERO
-- linhas, o supabase-js devolvia `error: null`, e a tela dava
-- `toast.success("Settings saved")`. Ele lia tudo e escrevia nada, achando que
-- escrevia. Corrigido do lado do front, no mesmo lote.

-- ---------- 2) O que o staff nao-admin precisa, sem segredo ----------
-- Colunas escolhidas a partir do que as telas de staff nao-admin LEEM hoje:
--   `WarehouseSettings`   -> warehouse_*
--   `MondayPopup`         -> warehouse_popup_*
--   `InactivityLogout`    -> warehouse_inactivity_*, warehouse_popup_day
--   `admin/OrderDetail`   -> email_new_orders, email_contato
--
-- Nenhuma delas e credencial. Se amanha uma tela de staff precisar de outra
-- coluna, ela entra AQUI, uma a uma, e nao por `*`.
CREATE OR REPLACE FUNCTION public.config_staff()
RETURNS TABLE (
  id                            uuid,
  nome_empresa                  text,
  email_contato                 text,
  email_new_orders              text,
  warehouse_popup_enabled       boolean,
  warehouse_popup_message       text,
  -- TIPOS CONFERIDOS contra 20260409000004_warehouse_settings.sql:5-9.
  -- `warehouse_popup_day` e INTEGER (0=Dom..6=Sab), nao texto; e
  -- `warehouse_inactivity_popup` e INTEGER (minutos), nao boolean. Eu tinha
  -- escrito os dois errados — `RETURNS TABLE` com tipo trocado nao falha no
  -- CREATE, falha na PRIMEIRA CHAMADA, ou seja, na tela do usuario.
  warehouse_popup_day           integer,
  warehouse_inactivity_popup    integer,
  warehouse_inactivity_default  integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- SECURITY DEFINER ignora RLS: a checagem de papel tem que estar AQUI DENTRO.
  -- Ja errei exatamente isso hoje (dei EXECUTE de uma funcao administrativa para
  -- `authenticated` num sistema de cadastro ABERTO, onde `authenticated` e
  -- qualquer pessoa).
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'manager')
       OR public.has_role(auth.uid(), 'warehouse')) THEN
    RETURN;  -- zero linhas, sem vazar nem a existencia da configuracao
  END IF;

  RETURN QUERY
  SELECT c.id, c.nome_empresa, c.email_contato, c.email_new_orders,
         c.warehouse_popup_enabled, c.warehouse_popup_message, c.warehouse_popup_day,
         c.warehouse_inactivity_popup, c.warehouse_inactivity_default
  FROM public.configuracoes c
  -- `ORDER BY created_at, id`: os leitores de hoje usam `LIMIT 1` SEM ordenacao,
  -- entao se houver mais de uma linha cada tela pode pegar uma diferente. Aqui
  -- pelo menos a escolha e sempre a MESMA (a mais antiga).
  ORDER BY c.created_at, c.id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.config_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.config_staff() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ — e por que
--
-- NAO tira os segredos da tabela. `stripe-checkout` le `stripe_secret_key` e
-- `stripe_webhook_secret` DALI (nao do env), e a edge `api` le `api_token` dali.
-- Move-los para os secrets do Supabase exige mudar essas duas functions E o dono
-- cadastrar os secrets no painel — passo proprio, na fila.
--
-- NAO afeta edge function nenhuma: todas usam service role, que ignora RLS.
--
-- As colunas `smtp_host/port/username/password` sao CODIGO MORTO: o
-- `send-email` le SMTP so dos secrets do Supabase e diz isso no proprio
-- comentario. Da para zerar na tabela sem quebrar nada — nao fiz aqui porque
-- apagar dado e decisao do dono, e o valor pode servir de referencia para ele.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK — reabre a leitura para manager e warehouse.
--
--   DROP POLICY IF EXISTS "Admin reads configuracoes" ON public.configuracoes;
--   CREATE POLICY "Staff can read configuracoes" ON public.configuracoes
--     FOR SELECT TO authenticated
--     USING (public.has_role(auth.uid(), 'admin')
--            OR public.has_role(auth.uid(), 'manager')
--            OR public.has_role(auth.uid(), 'warehouse'));
--
--   DROP FUNCTION IF EXISTS public.config_staff();
--
-- ATENCAO: reverter devolve a chave do Stripe e o token da API ao navegador do
-- manager.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) So a policy de admin sobrou para SELECT:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='configuracoes' ORDER BY policyname;
--   -- esperado: "Admin reads configuracoes" (SELECT) e
--   --           "Admins can manage configuracoes" (ALL)
--
-- 2) CONTROLE — o admin continua abrindo Configuracoes, Email Settings e Profile
--    com os campos PREENCHIDOS. Sem este teste, uma policy que recusa TODO mundo
--    passaria como "consertada".
--
-- 3) Entre com um usuario `warehouse` e confira que o popup de segunda-feira e o
--    logout por inatividade continuam funcionando (agora via `config_staff()`).
--
-- 4) Entre com um `manager` e confira que Email Settings e Profile NAO aparecem
--    mais no menu (mudanca irma, no publish).
-- ---------------------------------------------------------------------------
