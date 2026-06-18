-- ============================================================================
-- SYNC AUTOMÁTICO B2BWave (pg_cron) — server-side, sem aba aberta nem login admin
-- Ver SYNC_SPEC.md (§4) e a função supabase/functions/b2bwave-sync/index.ts.
--
-- PRÉ-REQUISITOS (fazer no painel do Supabase ANTES de aplicar / no deploy):
--   1. Habilitar as extensões pg_cron e pg_net (Dashboard → Database → Extensions),
--      ou os CREATE EXTENSION abaixo (precisam de privilégio).
--   2. Adicionar ao Vault (Dashboard → Project Settings → Vault) dois secrets:
--        CRON_SECRET       = o mesmo valor do Edge Function Secret CRON_SECRET
--        PROJECT_ANON_KEY  = a anon/publishable key do projeto
--      (NENHUMA chave fica no Git — são lidas do Vault em tempo de execução.)
--   3. Garantir que o Edge Function Secret CRON_SECRET existe (já usado pelo notify-dispatch).
-- O sync é MÃO ÚNICA (B2BWave → app). Nunca escreve de volta no B2BWave.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Estado do sync (cursor de paginação dos pedidos, usado pelo cron_orders)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage sync_state" ON public.sync_state;
CREATE POLICY "Admins manage sync_state" ON public.sync_state
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
-- (A Edge Function usa service_role e ignora RLS.)

-- NOTA: o upsert de pedidos do sync casa por `numero` via lookup manual (não usa
-- ON CONFLICT), então NÃO exigimos UNIQUE em pedidos.numero — isso evita conflito
-- com o SERIAL usado pelos pedidos criados no próprio app (checkout). Apenas um
-- índice (não-único) para acelerar a busca por numero no sync.
CREATE INDEX IF NOT EXISTS pedidos_numero_idx ON public.pedidos (numero);

-- ---------------------------------------------------------------------------
-- Helper: agenda um job que chama a Edge Function b2bwave-sync com uma action.
-- Lê CRON_SECRET e PROJECT_ANON_KEY do Vault (nada hardcoded).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._schedule_b2bwave_job(_jobname text, _cron text, _action text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _jobname) THEN
    PERFORM cron.unschedule(_jobname);
  END IF;

  PERFORM cron.schedule(
    _jobname,
    _cron,
    format($job$
      select net.http_post(
        url     := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/b2bwave-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey',       (select decrypted_secret from vault.decrypted_secrets where name = 'PROJECT_ANON_KEY'),
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
        ),
        body    := jsonb_build_object('action', %L)
      );
    $job$, _action)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Agendamentos
--   - Incremental LEVE (pedidos + clientes): a cada 15 min, defasados.
--   - PESADO (produtos + tabelas de preço): a cada hora.
-- O cron_orders caminha pelas páginas via cursor (sync_state) e faz upsert,
-- então não trava e cobre o histórico em ciclos. A tela manual continua existindo
-- para "forçar agora".
-- ---------------------------------------------------------------------------
-- Setup DEFENSIVO: habilita extensões e agenda os jobs. Se pg_cron/pg_net/Vault
-- ainda não estiverem prontos, a migration NÃO falha (só registra um aviso) —
-- assim as migrations de segurança nunca são bloqueadas por isto. Para ativar o
-- cron depois: habilite pg_cron + pg_net no painel, adicione os secrets no Vault
-- e re-aplique esta migration (ou rode o bloco abaixo manualmente).
DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-orders',     '*/15 * * * *', 'cron_orders');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-customers',  '5-59/15 * * * *', 'sync_customers');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-products',   '10 * * * *',  'sync_products');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-pricelists', '20 * * * *',  'sync_price_lists');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'b2bwave cron setup pulado (habilite pg_cron/pg_net + Vault e re-aplique): %', SQLERRM;
END
$outer$;

-- Para PAUSAR tudo depois (quando o B2BWave sair do ar):
--   select cron.unschedule('b2bwave-cron-orders');
--   select cron.unschedule('b2bwave-cron-customers');
--   select cron.unschedule('b2bwave-cron-products');
--   select cron.unschedule('b2bwave-cron-pricelists');
