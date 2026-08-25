-- ============================================================================
-- TETO DE NOTIFICACAO + supressao em operacao em massa.
--
-- Em 25/ago/2026, as 17:00 UTC, sairam 1498 SMS de `order_status` numa unica
-- hora. Causa: `trg_order_status_notify` dispara a CADA mudanca de status,
-- inclusive quando quem muda e o sync do B2BWave. Ao corrigir a paginacao da API
-- (que so trazia 9 pedidos), o sync passou a reconciliar 1.147 pedidos de uma
-- vez — e o gatilho mandou um SMS por pedido.
--
-- Duas travas independentes, porque uma so nao basta:
--   1. SUPRESSAO: operacao em massa avisa o banco antes de comecar, e o gatilho
--      nao dispara. Resolve a causa.
--   2. TETO HORARIO: mesmo sem supressao, o gatilho para de disparar depois de N
--      notificacoes na hora. Resolve o que a gente ainda nao previu.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Chave de supressao. Fica em `sync_state`, que ja existe e ja e usada pelo
-- sync para o cursor de pedidos.
-- ---------------------------------------------------------------------------
INSERT INTO public.sync_state (key, value)
VALUES ('suppress_order_notify', jsonb_build_object('on', false, 'ate', NULL))
ON CONFLICT (key) DO NOTHING;

-- Quanto o sistema pode mandar de `order_status` por hora. 40 e folgado para a
-- operacao normal (o pico legitimo observado foi 10/h) e corta qualquer
-- reconciliacao em massa.
INSERT INTO public.sync_state (key, value)
VALUES ('order_notify_max_per_hour', jsonb_build_object('n', 40))
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS notification_log_event_created_idx
  ON public.notification_log (event, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_order_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cli record;
  _suprimido boolean;
  _teto integer;
  _na_hora integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- TRAVA 1 — supressao explicita, ligada por operacao em massa.
  -- `ate` e uma validade: se a operacao morrer no meio sem desligar a flag, ela
  -- expira sozinha em vez de deixar a notificacao muda para sempre.
  SELECT COALESCE((value->>'on')::boolean, false)
         AND COALESCE((value->>'ate')::timestamptz, now() + interval '1 hour') > now()
    INTO _suprimido
  FROM public.sync_state WHERE key = 'suppress_order_notify';

  IF COALESCE(_suprimido, false) THEN
    RETURN NEW;
  END IF;

  -- TRAVA 2 — teto horario. Ultima linha de defesa: vale mesmo que alguem
  -- esqueca de ligar a supressao, ou que a causa seja outra que nao o sync.
  SELECT COALESCE((value->>'n')::integer, 40) INTO _teto
  FROM public.sync_state WHERE key = 'order_notify_max_per_hour';

  SELECT count(*) INTO _na_hora
  FROM public.notification_log
  WHERE event = 'order_status' AND created_at > now() - interval '1 hour';

  IF _na_hora >= COALESCE(_teto, 40) THEN
    -- Deixa rastro: sem isto, "parou de notificar" viraria um misterio.
    -- Uma linha por hora, nao uma por pedido barrado.
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_log
      WHERE event = 'order_status_teto' AND created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
      VALUES ('order_status_teto', '-', '-', 'failed',
              format('teto horario atingido (%s/h) — notificacoes de status suspensas ate a proxima hora', _teto),
              jsonb_build_object('pedido', NEW.numero, 'status', NEW.status));
    END IF;
    RETURN NEW;
  END IF;

  SELECT nome, empresa, email, telefone INTO _cli FROM public.clientes WHERE id = NEW.cliente_id;
  BEGIN
    PERFORM net.http_post(
      url := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/notify-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name='PROJECT_ANON_KEY'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
      ),
      body := jsonb_build_object(
        'event', 'order_status',
        'vars', jsonb_build_object(
          'order_id', COALESCE(NEW.numero, 0),
          'status', NEW.status,
          'total', COALESCE(NEW.total, 0),
          'customer_name', COALESCE(_cli.nome, ''),
          'customer_company', COALESCE(_cli.empresa, ''),
          'customer_email', COALESCE(_cli.email, ''),
          'customer_phone', COALESCE(_cli.telefone, '')
        ),
        'customer', jsonb_build_object(
          'email', _cli.email, 'phone', _cli.telefone, 'whatsapp', _cli.telefone
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'order_status notify falhou (nao derruba o update): %', SQLERRM;
  END;

  RETURN NEW;
END $$;

-- Liga/desliga a supressao. A edge function chama isto antes e depois de uma
-- reconciliacao em massa. `_minutos` da validade: mesmo que a chamada de
-- desligar nunca aconteca, a supressao expira.
CREATE OR REPLACE FUNCTION public.set_suppress_order_notify(_on boolean, _minutos integer DEFAULT 30)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.sync_state (key, value)
  VALUES ('suppress_order_notify',
          jsonb_build_object('on', _on, 'ate', CASE WHEN _on THEN now() + make_interval(mins => _minutos) ELSE NULL END))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
$$;

REVOKE ALL ON FUNCTION public.set_suppress_order_notify(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_suppress_order_notify(boolean, integer) TO service_role;

-- O gatilho foi desligado a mao para estancar o incidente. Religa agora que as
-- travas existem.
ALTER TABLE public.pedidos ENABLE TRIGGER trg_order_status_notify;
