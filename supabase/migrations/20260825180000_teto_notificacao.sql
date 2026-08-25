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
  ('admin_alert_counter',  jsonb_build_object('hora', NULL, 'n', 0))
ON CONFLICT (key) DO NOTHING;

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

  IF _n > COALESCE(_teto, 20) THEN
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
-- `sync_products` grava em LOTE (um unico statement, uma transacao) e o estoque
-- vem de `parseInt(p.quantity || p.stock || "0") || 0`. Se o B2BWave devolver
-- resposta parcial ou renomear o campo, o catalogo inteiro vai a zero de uma vez,
-- todo produto cruza o limite no mesmo statement e sai um SMS por produto.
-- ---------------------------------------------------------------------------
DO $$
DECLARE _corpo text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _corpo
  FROM pg_proc WHERE proname = 'fn_low_stock_notify' AND pronamespace = 'public'::regnamespace;

  IF _corpo IS NULL THEN
    RAISE NOTICE 'fn_low_stock_notify nao existe — nada a proteger aqui.';
  ELSIF _corpo LIKE '%bump_notify_counter%' THEN
    RAISE NOTICE 'fn_low_stock_notify ja tem o teto.';
  ELSE
    -- Injeta o teto logo apos o BEGIN principal, sem reescrever a funcao inteira
    -- (o corpo dela e do 20260718120000 e nao quero divergir dele aqui).
    EXECUTE replace(
      _corpo,
      'BEGIN',
      'BEGIN
  IF public.bump_notify_counter(''low_stock_counter'') >
     COALESCE((SELECT (value->>''n'')::integer FROM public.sync_state WHERE key = ''low_stock_max_per_hour''), 50)
  THEN RETURN COALESCE(NEW, OLD); END IF;'
    );
    RAISE NOTICE 'teto aplicado em fn_low_stock_notify.';
  END IF;
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
