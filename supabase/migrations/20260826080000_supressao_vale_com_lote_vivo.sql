-- ============================================================================
-- A SUPRESSAO PASSA A VALER ENQUANTO HOUVER LOTE VIVO
--
-- Achado do cetico, rodada 4, e o veredito foi duro: a contagem de referencia
-- de 20260826010000 era **INERTE**.
--
-- Eu fiz cada lote incrementar `n` ao entrar e decrementar ao sair, para que
-- ninguem desligasse a protecao de ninguem. Mas quem DECIDE nao olha `n`:
--
--     SELECT on AND ate > now() INTO _suprimido      (20260825200000:141-142)
--
-- Ou seja, a supressao morre no fim da janela, com `n` maior que zero e lote
-- ainda rodando. `b2bwave-sync` pede 10 minutos em dois pontos (`:1383`,
-- `:2345`); um lote que demore 14 fica desprotegido a partir do minuto 10.
--
-- Pior: eu tinha escrito, no comentario de 20260826010000, que "a supressao
-- pode viver alem de `ate` — que e o comportamento CERTO enquanto houver lote
-- vivo". Era falso. Comentario afirmando protecao inexistente e como o proximo
-- revisor e enganado, e desta vez o proximo revisor era eu.
--
-- O CONSERTO: quem decide passa a olhar as DUAS coisas — a janela OU o lote
-- vivo, este ultimo limitado pelo mesmo teto absoluto de 2 horas que impede
-- mudez permanente.
--
-- So o corpo da funcao muda; o gatilho `trg_order_status_notify` NAO e
-- recriado, entao ele continua DESABILITADO como esta hoje.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Estado da chave e do gatilho agora:
--
--   SELECT value FROM public.sync_state WHERE key = 'suppress_order_notify';
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.pedidos'::regclass
--      AND tgname = 'trg_order_status_notify';
--   -- 'D' = desabilitado (esperado hoje). Esta migration NAO muda isso.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_order_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cli record;
  _suprimido boolean;
  _teto integer;
  _n integer;
  _max_dias integer;
  _via_api text;
  _idade timestamptz;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- TRAVA A1 — marca explicita. Nao depende de data nenhuma.
  IF NEW.notificavel IS NOT TRUE THEN
    -- Deixa rastro. Sem isto, depois do backfill este vira o caminho de
    -- nao-envio MAIS COMUM do sistema e nao aparece no Notifications Log — o
    -- proprio projeto tem a regra de que todo nao-envio deixa rastro.
    -- Uma linha por hora, nao uma por pedido: em lote isso seriam milhares.
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.notification_log
        WHERE event = 'order_status_calado' AND created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
        VALUES ('order_status_calado', '-', '-', 'failed',
                'pedido marcado como nao-notificavel (importado sem data de origem) — ver coluna pedidos.notificavel',
                -- `id`, nao `numero`: numero NAO e unico, e um rastro forense que
                -- nao identifica a linha nao serve para nada.
                jsonb_build_object('pedido_id', NEW.id, 'numero', NEW.numero, 'status', NEW.status));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'log de A1 falhou (ignorado): %', SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- TRAVA A2 — idade. Usa a data da ORIGEM quando existe; so cai no `created_at`
  -- para pedido nativo do app, onde ele E a data da compra.
  SELECT COALESCE((value->>'n')::integer, 7) INTO _max_dias
  FROM public.sync_state WHERE key = 'order_notify_max_age_days';

  _idade := COALESCE(NEW.data_origem, NEW.created_at);
  IF _idade IS NULL OR _idade < now() - make_interval(days => COALESCE(_max_dias, 7)) THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.notification_log
        WHERE event = 'order_status_retroativo' AND created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
        VALUES ('order_status_retroativo', '-', '-', 'failed',
                format('pedido com mais de %s dias — nada retroativo', _max_dias),
                jsonb_build_object('pedido_id', NEW.id, 'numero', NEW.numero, 'data', _idade, 'status', NEW.status));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'log de A2 falhou (ignorado): %', SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- TRAVA B — mudanca feita por SQL direto nao fala com cliente.
  -- ATENCAO: isto NAO cobre o sync, que fala pelo PostgREST e portanto tem
  -- `request.method` preenchido. Quem cobre o sync sao as travas A1 e A2.
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

  -- SUPRIMIDO enquanto a JANELA vale OU enquanto houver LOTE VIVO.
  --
  -- Antes era so a janela. Isso tornava a contagem de referencia de
  -- 20260826010000 INERTE: o lote incrementava `n`, mas quem decide aqui era
  -- `ate` — e um lote que pede 10 minutos (o sync usa 10 em dois pontos) e
  -- demora 14 ficava DESPROTEGIDO a partir do minuto 10, com `n` maior que
  -- zero e nenhuma chamada posterior para empurrar `ate`.
  --
  -- O `desde + 120 minutos` e o teto que impede o outro extremo: lote que morre
  -- sem decrementar deixaria `n > 0` para sempre e a loja MUDA para sempre —
  -- que e pior do que o defeito original, porque nao aparece em lugar nenhum.
  SELECT COALESCE((value->>'on')::boolean, false)
         AND (
           COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz) > now()
           OR (COALESCE((value->>'n')::integer, 0) > 0
               AND COALESCE((value->>'desde')::timestamptz, '-infinity'::timestamptz)
                   > now() - interval '120 minutes')
         )
    INTO _suprimido
  FROM public.sync_state WHERE key = 'suppress_order_notify';

  IF COALESCE(_suprimido, false) THEN
    RETURN NEW;
  END IF;

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
        -- `order_id` passa a ser o UUID, nao o `numero`: `pedidos.numero` NAO e
        -- unico (app e B2BWave escrevem no mesmo espaco de inteiros), entao
        -- buscar por numero podia ler o pedido ERRADO e liberar o que devia
        -- calar.
        'vars', jsonb_build_object(
          'order_id', NEW.id,
          'order_numero', COALESCE(NEW.numero, 0),
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

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO religa o gatilho. `trg_order_status_notify` continua como esta.
--
-- NAO cobre os outros dois leitores da mesma chave (`_shared/dispatch.ts` e
-- `send-email`). Eles NAO leem `suppress_order_notify` — leem `notificavel`,
-- idade e `envio_permitido`. Conferido; a chave so tem este consumidor no banco.
--
-- NAO protege lote que passe de 2 HORAS. Nenhum lote real chega perto, e o teto
-- existe para que um lote morto nao cale o sistema para sempre.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Cole de volta o corpo de `fn_order_status_notify` de
-- 20260825200000_pedido_notificavel.sql (a versao cuja TRAVA de supressao le
-- apenas `on AND ate > now()`).
--
-- Reverter devolve o furo: lote que passa da propria janela roda desprotegido.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao passou a olhar `n` e `desde`:
--   SELECT count(*) AS deve_ser_1
--     FROM regexp_split_to_table(pg_get_functiondef(
--            'public.fn_order_status_notify()'::regprocedure), E'\n') l
--    WHERE l ~ '120 minutes';
--
-- 2) CONTROLE — o comportamento, nos DOIS sentidos. Estes testes so fazem
--    sentido com o gatilho LIGADO; se voce quiser fazer agora, ligue, teste e
--    DESLIGUE de novo:
--
--    a) LOTE VIVO ALEM DA JANELA — o caso que esta migration conserta:
--         SELECT public.set_suppress_order_notify(true, 1);   -- janela de 1 min
--         -- espere 2 minutos (a janela vence, o lote "continua vivo": n = 1)
--         -- mude o status de um pedido
--       ESPERADO: NAO notifica. Antes desta migration, notificaria.
--         SELECT public.set_suppress_order_notify(false);
--
--    b) NENHUM LOTE VIVO — o controle que impede o desastre oposto:
--         SELECT value FROM public.sync_state WHERE key='suppress_order_notify';
--         -- confirme {"n": 0, "on": false}
--         -- mude o status de um pedido
--       ESPERADO: NOTIFICA normalmente.
--       Sem o teste (b), uma funcao que suprime SEMPRE passaria por
--       "consertada", e o cliente nunca mais saberia que o pedido dele andou.
-- ---------------------------------------------------------------------------
