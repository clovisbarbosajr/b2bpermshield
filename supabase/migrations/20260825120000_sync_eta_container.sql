-- ============================================================================
-- ETA automatico da Producao a partir do tracker (projeto CONTAINER ZAP).
--
-- Pedido do dono (25/ago): "pode sobrescrever pq o ETA muda, as vezes o navio
-- atrasa, ou adianta" + "pode mandar ele checar diariamente" + "1x por dia, SEM
-- FALHA".
--
-- PRE-REQUISITO: a RPC `eta_por_containers` precisa existir no projeto do
-- tracker (docs/integracao-container-zap/01-RODAR-NO-CONTAINER-ZAP.sql) e os
-- secrets TRACKER_SUPABASE_URL / TRACKER_SUPABASE_ANON_KEY configurados aqui.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Colunas e log. Em bloco SEPARADO do agendamento de proposito: se o cron
--    falhar (extensao ausente), a coluna e a tabela PRECISAM continuar de pe —
--    senao a edge function grava numa coluna inexistente e TODO update falha.
-- ---------------------------------------------------------------------------
ALTER TABLE public.producao_pedidos
  ADD COLUMN IF NOT EXISTS eta_atualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS eta_fonte text;

COMMENT ON COLUMN public.producao_pedidos.eta_atualizado_em IS
  'Ultima vez que o ETA veio do tracker (Container ZAP). NULL = ETA digitado a mao e nunca tocado pela sincronizacao.';
COMMENT ON COLUMN public.producao_pedidos.eta_fonte IS
  'De onde veio o ETA: arrival (chegada REAL), eta_predicted (previsao revisada), eta (ETA da ShipsGo) ou sheet (planilha). Permite a tela distinguir "chegou" de "vai chegar".';

CREATE TABLE IF NOT EXISTS public.producao_eta_sync_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em       timestamptz NOT NULL,
  terminado_em      timestamptz NOT NULL DEFAULT now(),
  ok                boolean     NOT NULL,
  mensagem          text,
  itens_lidos       integer     NOT NULL DEFAULT 0,
  itens_casados     integer     NOT NULL DEFAULT 0,
  itens_atualizados integer     NOT NULL DEFAULT 0,
  itens_com_erro    integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS producao_eta_sync_log_iniciado_idx
  ON public.producao_eta_sync_log (iniciado_em DESC);

ALTER TABLE public.producao_eta_sync_log ENABLE ROW LEVEL SECURITY;

-- Só staff lê. A edge function escreve com service_role, que ignora RLS.
DROP POLICY IF EXISTS "Staff reads eta sync log" ON public.producao_eta_sync_log;
CREATE POLICY "Staff reads eta sync log" ON public.producao_eta_sync_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );

-- ---------------------------------------------------------------------------
-- 2) Agendamento diario. Bloco proprio + EXCEPTION: mesmo padrao defensivo da
--    20260618000002. Se `pg_cron`/`pg_net` nao estiverem disponiveis, avisa e
--    segue — NAO derruba o passo 1 num rollback.
--    06:20 UTC ~ madrugada em NY, fora do horario de uso.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Sem `WITH SCHEMA`: pg_cron nao e livremente relocavel, e o precedente que
  -- funciona neste projeto (20260618000002) usa CREATE EXTENSION puro.
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'permshield-cron-eta') THEN
    PERFORM cron.unschedule('permshield-cron-eta');
  END IF;

  PERFORM cron.schedule('permshield-cron-eta', '20 6 * * *', $job$
    select net.http_post(
      url     := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/sync-container-eta',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'PROJECT_ANON_KEY'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
      ),
      body    := '{}'::jsonb
    );
  $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron do ETA nao agendado (%). A coluna e o log FORAM criados; reagende depois.', SQLERRM;
END $$;
