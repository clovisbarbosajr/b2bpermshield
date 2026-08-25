-- ============================================================================
-- TETO DE NOTIFICACAO — contador SINCRONO.
--
-- INCIDENTE 25/ago/2026, 17:00 UTC: 1281 SMS aceitos pela Twilio numa hora, um
-- por pedido, com custo real. Causa: `trg_order_status_notify` dispara a cada
-- mudanca de status, inclusive quando quem muda e o sync do B2BWave. Ao corrigir
-- a paginacao da API (que so trazia 9 pedidos por pagina), o sync passou a
-- reconciliar 1.147 pedidos de uma vez.
--
-- POR QUE CONTADOR E NAO `count(*)` NO notification_log:
--   `net.http_post` ENFILEIRA. A linha no log so aparece 1-3s depois, quando o
--   pg_net dispara, o notify-dispatch acorda e grava. Nesse intervalo o laco do
--   sync ja processou dezenas de pedidos — um teto que le o log deixaria passar
--   ~50-100 SMS antes de engatar. O contador aqui e incrementado DENTRO da mesma
--   transacao do UPDATE, entao vale a partir do primeiro pedido.
--
-- O teto NAO substitui pensar antes de rodar operacao em massa. Ele existe para
-- o caso em que alguem (eu) nao pensou.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Estado das travas. `sync_state(key text PRIMARY KEY, value jsonb NOT NULL)`
-- ja existe (20260618000002).
-- ---------------------------------------------------------------------------
INSERT INTO public.sync_state (key, value) VALUES
  -- Supressao explicita para operacao em massa. `ate` e validade: se a operacao
  -- morrer no meio sem desligar, expira sozinha.
  ('suppress_order_notify', jsonb_build_object('on', false, 'ate', NULL)),
  -- Teto por hora, calibrado no volume REAL (medido no notification_log dos 7
  -- dias antes do incidente): o pico legitimo de order_status foi 10 linhas numa
  -- hora, o normal fica entre 2 e 4. O teto e o DOBRO do pico: 20.
  -- Estoque baixo tinha ~1/hora; teto 10.
  --
  -- Deliberadamente APERTADO. Estourar o teto e um alarme, nao um acidente:
  -- significa que alguma coisa esta disparando em lote, e nesse caso e melhor
  -- calar e investigar do que gastar. Para ajustar depois, sem deploy:
  --   UPDATE public.sync_state SET value = jsonb_build_object('n', 30)
  --   WHERE key = 'order_notify_max_per_hour';
  ('order_notify_max_per_hour', jsonb_build_object('n', 20)),
  ('low_stock_max_per_hour',    jsonb_build_object('n', 10)),
  -- Contadores sincronos: {"hora": "2026-08-25T17:00:00Z", "n": 0}
  ('order_notify_counter', jsonb_build_object('hora', NULL, 'n', 0)),
  ('low_stock_counter',    jsonb_build_object('hora', NULL, 'n', 0)),
  -- Alerta de falha ao admin: sai 1 por falha, e falha vem em lote (227 no
  -- incidente). Teto de 5/h no proprio dispatch.
  ('admin_alert_counter',  jsonb_build_object('hora', NULL, 'n', 0)),

  -- ===== TORNEIRA GERAL =====
  -- `true` = NADA sai. Nem SMS, nem e-mail, por nenhum caminho — inclusive o
  -- fallback Office365/SMTP, que nao aparece no painel do Resend e por isso e o
  -- que passa despercebido. Sem excecao e sem bypass.
  --   PARAR TUDO:   SELECT public.pausar_envios(true);
  --   VOLTAR:       SELECT public.pausar_envios(false);
  ('envio_pausado', jsonb_build_object('on', false)),

  -- Teto GLOBAL de e-mail por hora, valendo para todo tipo e todo provedor.
  -- 30/h: o volume real medido no Resend foi de 0 a 26 por DIA.
  ('email_max_per_hour', jsonb_build_object('n', 30)),
  ('email_counter',      jsonb_build_object('hora', NULL, 'n', 0)),

  -- Teto GLOBAL de SMS por hora, qualquer evento.
  -- 25/h: o volume real medido foi de 4 a 28 por DIA.
  ('sms_max_per_hour', jsonb_build_object('n', 25)),
  ('sms_counter',      jsonb_build_object('hora', NULL, 'n', 0))
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Torneira geral. Uma chamada para e outra volta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pausar_envios(_pausar boolean)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.sync_state (key, value)
  VALUES ('envio_pausado', jsonb_build_object('on', _pausar))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  RETURNING CASE WHEN _pausar
              THEN 'PAUSADO: nenhum SMS ou e-mail sai deste sistema.'
              ELSE 'LIBERADO: envios voltaram ao normal (respeitando os tetos).'
            END;
$$;

REVOKE ALL ON FUNCTION public.pausar_envios(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pausar_envios(boolean) TO authenticated, service_role;

-- Lida pelas edge functions antes de QUALQUER envio.
CREATE OR REPLACE FUNCTION public.envio_permitido(_canal text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pausado boolean; _teto int; _n int;
BEGIN
  SELECT COALESCE((value->>'on')::boolean, false) INTO _pausado
  FROM public.sync_state WHERE key = 'envio_pausado';
  IF COALESCE(_pausado, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'envio pausado manualmente');
  END IF;

  SELECT COALESCE((value->>'n')::integer, 25) INTO _teto
  FROM public.sync_state WHERE key = _canal || '_max_per_hour';

  _n := public.bump_notify_counter(_canal || '_counter');
  -- Falha FECHADO: sem contador, nao envia.
  IF _n IS NULL OR _n > COALESCE(_teto, 25) THEN
    RETURN jsonb_build_object('ok', false, 'motivo',
      format('teto de %s %s/hora atingido', _teto, _canal), 'contador', _n);
  END IF;
  RETURN jsonb_build_object('ok', true, 'contador', _n);
END $$;

REVOKE ALL ON FUNCTION public.envio_permitido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.envio_permitido(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Incrementa o contador da hora corrente e devolve o novo valor.
--
-- `UPDATE ... RETURNING` num unico statement: atomico, e o lock de linha
-- serializa chamadas concorrentes, entao duas transacoes nao passam do teto
-- juntas. Vira dezenas de UPDATEs na mesma linha durante um lote — aceitavel,
-- porque o proposito e exatamente barrar lote.
--
-- Vira a hora sozinho: se `hora` gravada != hora atual, reinicia em 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_notify_counter(_chave text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sync_state
  SET value = jsonb_build_object(
        'hora', to_jsonb(date_trunc('hour', now())),
        'n', CASE
               WHEN (value->>'hora')::timestamptz = date_trunc('hour', now())
                 THEN COALESCE((value->>'n')::integer, 0) + 1
               ELSE 1
             END)
  WHERE key = _chave
  RETURNING (value->>'n')::integer;
$$;

REVOKE ALL ON FUNCTION public.bump_notify_counter(text) FROM PUBLIC;
-- O `_shared/dispatch` chama esta RPC para limitar o alerta de falha ao admin.
GRANT EXECUTE ON FUNCTION public.bump_notify_counter(text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_suppress_order_notify(_on boolean, _minutos integer DEFAULT 30)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.sync_state (key, value)
  VALUES ('suppress_order_notify',
          jsonb_build_object('on', _on,
                             'ate', CASE WHEN _on THEN now() + make_interval(mins => _minutos) ELSE NULL END))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
$$;

REVOKE ALL ON FUNCTION public.set_suppress_order_notify(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_suppress_order_notify(boolean, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- order_status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_order_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cli record;
  _suprimido boolean;
  _teto integer;
  _n integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- TRAVA 1 — supressao explicita (operacao em massa avisa antes de comecar).
  -- Default do COALESCE no PASSADO: `on=true` sem `ate` NAO suprime. Se alguem
  -- editar a linha a mao e esquecer a validade, a notificacao volta sozinha em
  -- vez de ficar muda para sempre.
  SELECT COALESCE((value->>'on')::boolean, false)
         AND COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz) > now()
    INTO _suprimido
  FROM public.sync_state WHERE key = 'suppress_order_notify';

  IF COALESCE(_suprimido, false) THEN
    RETURN NEW;
  END IF;

  -- TRAVA 2 — teto horario, contador SINCRONO (vale desde o 1o pedido do lote).
  SELECT COALESCE((value->>'n')::integer, 20) INTO _teto
  FROM public.sync_state WHERE key = 'order_notify_max_per_hour';

  _n := public.bump_notify_counter('order_notify_counter');

  -- `_n IS NULL` = a linha do contador nao existe (alguem limpou `sync_state`).
  -- Sem este teste, `IF NULL > 20` e falso e a notificacao SAI: o teto ficaria
  -- desligado em silencio — exatamente o modo de falha que esta trava existe
  -- para evitar. Falha FECHADO: sem contador, nao notifica.
  IF _n IS NULL OR _n > COALESCE(_teto, 20) THEN
    -- Uma linha por hora, nao uma por pedido barrado. Em bloco proprio: se este
    -- insert falhar, NAO pode derrubar o UPDATE do pedido.
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

-- ---------------------------------------------------------------------------
-- low_stock — MESMO teto.
--
-- Este e mais perigoso que o order_status e nao tinha trava nenhuma: o
-- `sync_products` grava em LOTE (um unico statement) e o estoque vem de
-- `parseInt(p.quantity || p.stock || "0") || 0`. Se o B2BWave devolver resposta
-- parcial ou renomear o campo, o catalogo inteiro vai a zero de uma vez, todo
-- produto cruza o limite no mesmo statement, e sai um SMS por produto.
--
-- A funcao e reescrita INTEIRA (copia do 20260718120000 + o bump). A tentativa
-- anterior injetava a guarda com `replace(definicao, 'BEGIN', ...)` e era um
-- desastre silencioso: `replace` troca TODAS as ocorrencias, e esta funcao tem
-- dois `BEGIN` (o principal e o do EXCEPTION). O resultado compilava — o pior
-- caso — e contava TODO write em estoque, nao toda notificacao. Um pedido com 10
-- itens esgotaria o orcamento da hora e o alerta de estoque morreria em silencio.
--
-- O bump fica DENTRO do IF de cruzamento, imediatamente antes do envio: conta
-- notificacao, nao movimento de estoque.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_low_stock_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _evt        record;
  _threshold  int;
  _avail_new  int;
  _avail_old  int;
  _teto       int;
  _n          int;
BEGIN
  SELECT * INTO _evt FROM public.notification_events WHERE id = 'low_stock';
  IF _evt IS NULL OR _evt.enabled IS NOT TRUE THEN RETURN NEW; END IF;

  _threshold := COALESCE((_evt.extra->>'low_stock_threshold')::int, 5);
  _avail_new := COALESCE(NEW.estoque_total, 0) - COALESCE(NEW.estoque_reservado, 0);
  _avail_old := COALESCE(OLD.estoque_total, 0) - COALESCE(OLD.estoque_reservado, 0);

  -- Só ao CRUZAR o limite (evita repetir a cada update abaixo).
  IF _avail_old > _threshold AND _avail_new <= _threshold THEN
    SELECT COALESCE((value->>'n')::integer, 10) INTO _teto
    FROM public.sync_state WHERE key = 'low_stock_max_per_hour';

    _n := public.bump_notify_counter('low_stock_counter');
    IF _n IS NULL OR _n > COALESCE(_teto, 10) THEN
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.notification_log
          WHERE event = 'low_stock_teto' AND created_at > now() - interval '1 hour'
        ) THEN
          INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
          VALUES ('low_stock_teto', '-', '-', 'failed',
                  format('teto de %s/hora atingido — alertas de estoque suspensos ate virar a hora', _teto),
                  jsonb_build_object('produto', NEW.nome, 'sku', COALESCE(NEW.sku, ''), 'contador', _n));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'marcador de teto low_stock falhou (ignorado): %', SQLERRM;
      END;
      RETURN NEW;
    END IF;

    BEGIN
      PERFORM net.http_post(
        url := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/notify-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name='PROJECT_ANON_KEY'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
        ),
        body := jsonb_build_object(
          'event', 'low_stock',
          'vars', jsonb_build_object(
            'product_name', NEW.nome,
            'sku', COALESCE(NEW.sku, ''),
            'quantity', _avail_new,
            'threshold', _threshold,
            'stock', _avail_new
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'low_stock notify falhou (nao derruba o update): %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Recria o gatilho e o deixa DESLIGADO.
--
-- `DROP + CREATE` em vez de `ENABLE`: o gatilho foi desativado a mao durante o
-- incidente, e se tiver sido DROPADO em vez de desabilitado, um `ENABLE` aborta
-- a migration INTEIRA — nem as chaves nem o contador seriam criados, e daria pra
-- achar que rodou.
--
-- Fica DESLIGADO de proposito. Religar e passo manual, depois de verificar com o
-- canal ainda desligado que o sync nao gera enxurrada de linha no log.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_status_notify ON public.pedidos;
CREATE TRIGGER trg_order_status_notify
  AFTER UPDATE OF status ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_order_status_notify();
ALTER TABLE public.pedidos DISABLE TRIGGER trg_order_status_notify;
