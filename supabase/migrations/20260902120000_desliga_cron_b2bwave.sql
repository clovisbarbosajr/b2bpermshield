-- ============================================================================
-- DESLIGA os cron jobs do sync do B2BWave — decisão do cliente em 02/set/2026.
--
-- O sistema entra no ar com ZERO pedidos e sem integração com o B2BWave. A edge
-- `b2bwave-sync` foi APAGADA do repositório (commit 55ef241), então cada job que
-- sobreviver passa a fazer `net.http_post` para um endereço que responde 404 —
-- de 15 em 15 minutos, para sempre, e o erro só aparece se alguém for olhar
-- `cron.job_run_details`.
--
-- POR QUE ESTE ARQUIVO EXISTE, se o dono já rodou os `unschedule` à mão:
-- as migrations que CRIAM os jobs continuam no repositório e não foram editadas
-- (o projeto é forward-only — conserto vira arquivo novo, nunca edição do
-- antigo). Sem isto, qualquer banco montado a partir das migrations nasce com os
-- cinco jobs agendados de novo. Este arquivo é o que garante que a decisão de
-- 02/set sobrevive à reconstrução.
--
-- Quem os criou:
--   20260618000002_b2bwave_sync_cron.sql   → orders, customers, products, pricelists
--   20260618193846_a20235dc-....sql        → reagenda os mesmos
--   20260618200824_9eb7199c-....sql        → reagenda os mesmos
--   20260717130000_cron_categorias.sql     → categories  (o quinto, fácil de esquecer)
--
-- IDEMPOTENTE e seguro de re-rodar: `unschedule` de job inexistente lança, então
-- cada chamada é condicionada à existência.
--
-- NÃO TOCA em nenhum outro job. O ETA de container (`sync-container-eta`) tem
-- cron próprio e FICA — não é do B2BWave, alimenta o módulo Produção.
-- ============================================================================

DO $$
DECLARE
  _job text;
  _desligados int := 0;
BEGIN
  -- Se pg_cron não estiver instalado neste banco não há nada a desligar.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron nao instalado — nenhum job para desligar';
    RETURN;
  END IF;

  FOREACH _job IN ARRAY ARRAY[
    'b2bwave-cron-orders',
    'b2bwave-cron-customers',
    'b2bwave-cron-products',
    'b2bwave-cron-pricelists',
    'b2bwave-cron-categories'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _job) THEN
      PERFORM cron.unschedule(_job);
      _desligados := _desligados + 1;
      RAISE NOTICE 'cron desligado: %', _job;
    END IF;
  END LOOP;

  RAISE NOTICE 'b2bwave: % job(s) desligado(s)', _desligados;

  -- Rede de segurança: pega qualquer job `b2bwave-*` que não esteja na lista
  -- acima. Já aconteceu uma vez — `b2bwave-cron-categories` foi criado numa
  -- migration separada e não estava no inventário inicial.
  FOR _job IN SELECT jobname FROM cron.job WHERE jobname LIKE 'b2bwave-%' LOOP
    PERFORM cron.unschedule(_job);
    RAISE NOTICE 'cron desligado (nao estava na lista): %', _job;
  END LOOP;
END
$$;

-- A função que agendava os jobs. Sem ela, re-aplicar as migrations de junho não
-- recria nada: o `DO ... EXCEPTION WHEN OTHERS` delas engole o erro de função
-- inexistente, que é exatamente o comportamento desejado aqui.
DROP FUNCTION IF EXISTS public._schedule_b2bwave_job(text, text, text);

-- ---------------------------------------------------------------------------
-- `sync_state` NÃO É RESÍDUO DO SYNC — não apague.
--
-- Ela foi criada pela migration do cron do B2BWave e por isso PARECE sobra, mas
-- guarda duas coisas de notificação que não têm nada a ver com o B2BWave:
--
--   envio_pausado            — a TORNEIRA GERAL que cala todos os canais de uma
--                              vez. É o kill switch criado depois dos 1.508 SMS
--                              de 25/ago (20260825180000_teto_notificacao.sql).
--   order_notify_max_age_days — lido por `send-email/index.ts`.
--
-- Dropar esta tabela "limpando o sync" desarma o kill switch em silêncio.
-- ---------------------------------------------------------------------------
-- Os dois `COMMENT ON` abaixo vao dentro de um `DO` com checagem de existencia.
--
-- `COMMENT ON` nao aceita `IF EXISTS`: se o alvo nao existir, ele LANCA. E se
-- esta migration rodar em transacao unica, esse erro desfaz o bloco de cima
-- junto — ou seja, o comentario que existe para AVISAR que nao se deve apagar a
-- tabela impediria o desligamento dos cron jobs, que e a parte que importa.
-- Exatamente no banco onde alguem ja apagou o alvo a mao: o cenario que o
-- comentario existe para prevenir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.sync_state'::regclass) THEN
    COMMENT ON TABLE public.sync_state IS
      'NAO E residuo do sync do B2BWave (que morreu em 02/set/2026). Guarda o kill '
      'switch de notificacao `envio_pausado` e o `order_notify_max_age_days`. '
      'Apagar esta tabela desarma a torneira geral de notificacao em silencio.';
  ELSE
    RAISE WARNING 'public.sync_state NAO EXISTE — o kill switch de notificacao (`envio_pausado`) sumiu com ela';
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE WARNING 'public.sync_state NAO EXISTE — o kill switch de notificacao (`envio_pausado`) sumiu com ela';
END
$$;

-- ---------------------------------------------------------------------------
-- `pedidos_numero_idx` — mesma armadilha, vizinho de porta.
--
-- Nasceu na MESMA migration do cron do B2BWave (20260618000002:34) e por isso
-- também parece resíduo. Não é: é ele que faz o `count: "exact"` das três
-- checagens de pedido por número (`notify-dispatch`, `_shared/dispatch.ts`,
-- `send-email`) não virar varredura completa de `pedidos`.
--
-- Essas checagens existem porque `pedidos.numero` NÃO tem UNIQUE e o gatilho
-- `fn_pedido_numero_continua` gera com `MAX(numero)+1` sem lock — duas linhas
-- podem nascer com o mesmo número, e as três recusam a ambiguidade em vez de
-- adivinhar de quem é o pedido.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pedidos_numero_idx' AND relkind = 'i') THEN
    COMMENT ON INDEX public.pedidos_numero_idx IS
      'NAO E residuo do sync do B2BWave. Sustenta o `count: exact` das checagens de '
      'pedido por numero em notify-dispatch, _shared/dispatch.ts e send-email. '
      'Sem ele, cada checagem de notificacao vira seq scan em `pedidos`.';
  ELSE
    -- Recria em vez de so avisar: o indice e barato e as tres checagens de
    -- notificacao dependem dele. `IF NOT EXISTS` mantem a migration idempotente.
    RAISE WARNING 'pedidos_numero_idx nao existia — recriando (as checagens de pedido por numero dependem dele)';
    CREATE INDEX IF NOT EXISTS pedidos_numero_idx ON public.pedidos (numero);
  END IF;
END
$$;
