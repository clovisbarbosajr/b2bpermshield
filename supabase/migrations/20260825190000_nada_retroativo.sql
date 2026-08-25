-- ============================================================================
-- DUAS TRAVAS PEDIDAS PELO DONO DEPOIS DO INCIDENTE DOS 1281 SMS
--
--   1. NADA RETROATIVO. Cliente nunca recebe aviso sobre pedido velho. Mesmo
--      que alguem (eu) reconcilie a base inteira de novo, so pedido dos ultimos
--      N dias pode gerar notificacao. E o limite de dano por desenho: nao
--      depende de teto, de supressao, nem de ninguem lembrar de nada.
--
--   2. MUDANCA VIA SQL NAO NOTIFICA. Rodar UPDATE no SQL editor e operacao de
--      manutencao, nao um evento de negocio. Nunca deveria falar com o cliente.
--
-- As duas sao INDEPENDENTES das travas de 20260825180000 (torneira e tetos).
-- Cada uma sozinha ja teria evitado o incidente.
-- ============================================================================

INSERT INTO public.sync_state (key, value) VALUES
  -- Idade maxima do pedido para poder notificar. 5 dias uteis ~ 7 corridos.
  ('order_notify_max_age_days', jsonb_build_object('n', 7))
ON CONFLICT (key) DO NOTHING;
UPDATE public.sync_state SET value = jsonb_build_object('n', 7)
WHERE key = 'order_notify_max_age_days';

CREATE OR REPLACE FUNCTION public.fn_order_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cli record;
  _suprimido boolean;
  _teto integer;
  _n integer;
  _max_dias integer;
  _via_api text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- ==== TRAVA A — NADA RETROATIVO ====
  -- Pedido mais velho que o limite NUNCA notifica, aconteca o que acontecer.
  -- Esta e a trava que torna impossivel repetir o incidente: mesmo uma
  -- reconciliacao de 1.147 pedidos so poderia falar sobre os poucos recentes.
  --
  -- `created_at` do PEDIDO, nao a data da mudanca: e a data da compra que
  -- interessa ao cliente.
  SELECT COALESCE((value->>'n')::integer, 7) INTO _max_dias
  FROM public.sync_state WHERE key = 'order_notify_max_age_days';

  IF NEW.created_at < now() - make_interval(days => COALESCE(_max_dias, 7)) THEN
    RETURN NEW;
  END IF;

  -- ==== TRAVA B — MUDANCA VIA SQL NAO NOTIFICA ====
  -- `request.method` so existe quando a conexao veio pelo PostgREST (app, edge
  -- function, sync). Rodando UPDATE direto no SQL editor ela e NULA — e ali e
  -- manutencao, nunca evento de negocio para o cliente.
  _via_api := current_setting('request.method', true);
  IF _via_api IS NULL OR _via_api = '' THEN
    BEGIN
      INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
      VALUES ('order_status_sql', '-', '-', 'failed',
              'mudanca feita por SQL direto — notificacao suprimida por regra',
              jsonb_build_object('pedido', NEW.numero, 'de', OLD.status, 'para', NEW.status));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'log de supressao por SQL falhou (ignorado): %', SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- ==== Supressao explicita de lote ====
  SELECT COALESCE((value->>'on')::boolean, false)
         AND COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz) > now()
    INTO _suprimido
  FROM public.sync_state WHERE key = 'suppress_order_notify';

  IF COALESCE(_suprimido, false) THEN
    RETURN NEW;
  END IF;

  -- ==== Teto horario, contador sincrono ====
  SELECT COALESCE((value->>'n')::integer, 20) INTO _teto
  FROM public.sync_state WHERE key = 'order_notify_max_per_hour';

  _n := public.bump_notify_counter('order_notify_counter');

  IF _n IS NULL OR _n > COALESCE(_teto, 20) THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.notification_log
        WHERE event = 'order_status_teto' AND created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
        VALUES ('order_status_teto', '-', '-', 'failed',
                format('teto de %s/hora atingido — notificacoes de status suspensas ate virar a hora', _teto),
                jsonb_build_object('pedido', NEW.numero, 'status', NEW.status, 'contador', _n));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'marcador de teto falhou (ignorado): %', SQLERRM;
    END;
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
