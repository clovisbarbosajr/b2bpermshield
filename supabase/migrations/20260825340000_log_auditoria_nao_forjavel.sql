-- ============================================================================
-- LOG DE AUDITORIA DEIXA DE SER FORJAVEL
--
-- A policy de INSERT em `activity_logs` e:
--
--   CREATE POLICY "Authenticated users can insert activity_logs"
--     ON public.activity_logs FOR INSERT
--     WITH CHECK (auth.uid() IS NOT NULL);
--
-- "Qualquer autenticado". Nem posse ela valida — e o cadastro deste sistema e
-- ABERTO, entao `authenticated` e qualquer pessoa que crie uma conta.
--
-- E o app manda TODOS os campos de identidade do lado do cliente
-- (`src/hooks/useActivityLog.ts`): `user_id`, `user_email`, `user_name`. Um POST
-- direto grava a linha que quiser, com o nome de quem quiser:
--
--   { user_id: <uuid da admin>, user_email: "jess@...", user_name: "Jess",
--     action: "deleted", entity_type: "order", entity_name: "Order #1234" }
--
-- A leitura e admin-only. Ou seja: e forja plantada EXATAMENTE no lugar onde o
-- dono vai olhar para entender o que aconteceu. Um log de auditoria em que
-- qualquer um escreve nao e log de auditoria — e pior que nao ter, porque
-- transmite confianca.
--
-- CONSERTO, duas camadas:
--   1. So STAFF pode inserir (o app so registra em tela de admin — conferido:
--      nenhuma pagina do portal usa o hook).
--   2. Um gatilho REESCREVE a identidade a partir do servidor, ignorando o que
--      veio no corpo. Assim nem staff pode assinar em nome de outro.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- SINAL DE FORJA: linha cujo `user_email` nao bate com o e-mail do login que ela
-- diz ser. Numa gravacao legitima os dois sempre casam.
--
--   SELECT l.id, l.created_at, l.action, l.entity_type, l.entity_name,
--          l.user_email AS email_no_log, u.email AS email_do_login
--   FROM public.activity_logs l
--   LEFT JOIN auth.users u ON u.id = l.user_id
--   WHERE l.user_id IS NOT NULL
--     AND lower(coalesce(l.user_email,'')) <> lower(coalesce(u.email,''))
--   ORDER BY l.created_at DESC;
--
-- E quem escreveu no log SEM ser staff (nao deveria existir nenhum):
--
--   SELECT l.user_id, u.email, count(*) AS linhas, max(l.created_at) AS ultima
--   FROM public.activity_logs l
--   LEFT JOIN auth.users u ON u.id = l.user_id
--   WHERE l.user_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM public.user_roles r
--                     WHERE r.user_id = l.user_id
--                       AND r.role IN ('admin','manager','warehouse'))
--   GROUP BY l.user_id, u.email
--   ORDER BY linhas DESC;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) So staff escreve ----------
DROP POLICY IF EXISTS "Authenticated users can insert activity_logs" ON public.activity_logs;

CREATE POLICY "Staff insert activity_logs" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );

-- ---------- 2) A identidade vem do SERVIDOR, nao do corpo ----------
CREATE OR REPLACE FUNCTION public.fn_activity_log_identidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- `service_role` e conexao direta ao banco passam: sao as edge functions e o
  -- SQL do dono, que precisam poder registrar em nome do sistema.
  IF auth.role() = 'service_role' OR auth.role() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reescreve, nao valida: o que veio do corpo e simplesmente descartado.
  -- Validar exigiria comparar e recusar, o que quebraria o app por um campo que
  -- ele preenche errado sem ma intencao. Reescrever nao quebra nada e nao deixa
  -- forjar.
  NEW.user_id := auth.uid();

  SELECT u.email INTO NEW.user_email FROM auth.users u WHERE u.id = auth.uid();

  -- Nome de exibicao: `profiles` primeiro, depois o metadata do login, e por fim
  -- o proprio e-mail. Nunca o que veio do cliente.
  SELECT COALESCE(
           NULLIF(btrim(p.nome), ''),
           NULLIF(btrim(u.raw_user_meta_data ->> 'nome'), ''),
           u.email
         )
    INTO NEW.user_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = auth.uid();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_activity_log_identidade ON public.activity_logs;
CREATE TRIGGER trg_activity_log_identidade
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_activity_log_identidade();

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO limpa linha forjada que ja exista. Use a consulta de BACKUP para achar; se
-- vier alguma coisa, me avise antes de apagar — a linha em si e evidencia.
--
-- NAO impede staff de registrar acao que nao fez (um admin ainda pode chamar o
-- hook com `entity_id` errado). O que ele nao consegue mais e assinar com o NOME
-- DE OUTRA PESSOA, que era o que tornava o log inutil.
--
-- NAO ha UPDATE nem DELETE liberados para ninguem alem de admin, entao a linha,
-- depois de gravada, nao e reescrita pelo app.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_activity_log_identidade ON public.activity_logs;
--   DROP POLICY  IF EXISTS "Staff insert activity_logs" ON public.activity_logs;
--   CREATE POLICY "Authenticated users can insert activity_logs"
--     ON public.activity_logs FOR INSERT
--     WITH CHECK (auth.uid() IS NOT NULL);
--
-- ATENCAO: reverter devolve a qualquer pessoa cadastrada o poder de escrever no
-- seu log de auditoria, com o nome que ela quiser.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A policy antiga saiu e o gatilho existe:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='activity_logs' ORDER BY policyname;
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_activity_log_identidade';
--
-- 2) CONTROLE — o caminho BOM tem que continuar funcionando: edite um produto no
--    admin e confira que a linha aparece em Activity Logs, com O SEU nome.
--    Sem este teste, um gatilho que recusa tudo passaria como "consertado".
--
-- 3) Rode de novo a primeira consulta do BACKUP: ela nao pode ganhar linha nova.
-- ---------------------------------------------------------------------------
