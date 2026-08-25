-- ============================================================================
-- MARCA EXPLICITA DE "PODE NOTIFICAR" NO PEDIDO
--
-- A tentativa anterior (nao gravar `created_at` quando o B2BWave nao manda data)
-- NAO resolveu nada: a coluna tem `DEFAULT now()`, entao o pedido de 2025
-- continuava nascendo com a data de hoje e a trava de idade o considerava
-- recente. Mesmo furo, so que escondido atras de um comentario dizendo o
-- contrario.
--
-- A correcao nao pode depender de adivinhar a idade a partir de um campo que o
-- proprio sync preenche errado. Passa a existir uma marca explicita:
--
--   notificavel = false  ->  este pedido NUNCA gera notificacao, ponto.
--
-- Quem marca: o sync, quando importa um pedido sem data de origem confiavel.
-- O sync reabilita automaticamente se a origem passar a informar a data — e
-- tudo bem, porque nesse momento ele grava a data REAL junto, e a trava de
-- idade passa a avaliar contra ela.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS notificavel boolean NOT NULL DEFAULT true,
  -- Data REAL da origem (B2BWave). NULL = a origem nao informou.
  -- `created_at` continua sendo a data da linha no nosso banco.
  ADD COLUMN IF NOT EXISTS data_origem timestamptz;

COMMENT ON COLUMN public.pedidos.notificavel IS
  'false = pedido nunca gera notificacao (importado sem data de origem confiavel). Ver incidente 25/ago/2026.';
COMMENT ON COLUMN public.pedidos.data_origem IS
  'Data em que o pedido foi feito na ORIGEM (B2BWave). NULL quando a origem nao informou — nesse caso created_at e a data da importacao, NAO a da compra.';

-- ---------------------------------------------------------------------------
-- BACKFILL DEFENSIVO
--
-- Criterio: `data_origem IS NULL`. Neste instante a coluna acabou de ser criada,
-- entao ela e NULA em 100% das linhas — o UPDATE cala TODO pedido importado que
-- ja existe. E deterministico e nao depende de adivinhar nada.
--
-- A versao anterior usava `created_at < now() - 7 dias`, o que era o MESMO erro
-- que esta migration passa 40 linhas denunciando: em linha importada,
-- `created_at` e a data da IMPORTACAO, nao a da compra. O pedido de 2025
-- importado ontem escapava do backfill, ficava `notificavel = true` com data
-- falsa-recente, e virava exatamente o SMS retroativo que estamos evitando.
--
-- REVERSAO: o sync devolve a voz ao pedido no primeiro ciclo em que o vir com
-- data real da origem — inclusive quando NADA mais mudou nele (ha uma condicao
-- `precisaReparar` no `b2bwave-sync` exatamente para isso; sem ela, pedido
-- estavel nunca seria revisitado e ficaria calado para sempre, inclusive um
-- pedido legitimo de hoje).
--
-- Reabilitar em massa NAO gera mensagem: `data_origem` e `notificavel` vao na
-- MESMA sentenca de UPDATE, entao quando o gatilho avalia a idade ja e contra a
-- data verdadeira, e o antigo continua barrado.
-- ---------------------------------------------------------------------------
UPDATE public.pedidos
SET notificavel = false
WHERE b2bwave_order_id IS NOT NULL
  AND data_origem IS NULL;

-- ---------------------------------------------------------------------------
-- O gatilho de status passa a olhar a marca ANTES da idade.
-- ---------------------------------------------------------------------------
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

  SELECT COALESCE((value->>'on')::boolean, false)
         AND COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz) > now()
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

-- ---------------------------------------------------------------------------
-- MODELOS DE MENSAGEM: `{order_id}` -> `{order_numero}`
--
-- `order_id` passou a carregar o UUID (porque `pedidos.numero` NAO e unico e a
-- barreira de idade busca por ele). Os textos usam `{order_id}` no corpo, entao
-- sem esta troca o cliente receberia "Pedido #a3f2e1b0-4c9d-..." no lugar de
-- "#2726". O numero continua disponivel em `{order_numero}`.
-- ---------------------------------------------------------------------------
UPDATE public.notification_events SET
  template_email    = replace(COALESCE(template_email,    ''), '{order_id}', '{order_numero}'),
  template_sms      = replace(COALESCE(template_sms,      ''), '{order_id}', '{order_numero}'),
  template_whatsapp = replace(COALESCE(template_whatsapp, ''), '{order_id}', '{order_numero}')
WHERE COALESCE(template_email, '')    LIKE '%{order_id}%'
   OR COALESCE(template_sms, '')      LIKE '%{order_id}%'
   OR COALESCE(template_whatsapp, '') LIKE '%{order_id}%';
