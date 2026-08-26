-- ============================================================================
-- ESTADO DE TODAS AS TRAVAS DE NOTIFICACAO, NUMA TELA SO
--
-- Rode no editor de SQL do Lovable. Uma linha por trava, com veredito.
--
-- Serve para responder, a qualquer momento e sem depender da memoria de
-- ninguem: "hoje, se alguem rodar um sync, sai mensagem para cliente?"
--
-- COMO LER a coluna `veredito`:
--   MUDO       = esta trava, sozinha, impede envio
--   ABERTO     = esta trava NAO esta impedindo (pode ser normal; veja `o_que_e`)
--   CONFERIR   = valor inesperado, olhe com atencao
--
-- Enquanto QUALQUER linha marcada (TRAVA MESTRE) estiver MUDO, nada sai por
-- nenhum caminho.
-- ============================================================================

WITH t AS (
  -- ---------- Gatilhos que saem do banco para o mundo ----------
  SELECT 1 AS ord,
         'gatilho: status de pedido' AS trava,
         COALESCE((SELECT CASE tgenabled WHEN 'D' THEN 'desabilitado' ELSE 'HABILITADO' END
                     FROM pg_trigger
                    WHERE tgrelid = 'public.pedidos'::regclass
                      AND tgname = 'trg_order_status_notify'), 'nao existe') AS valor,
         'manda SMS quando o status de um pedido muda — foi este o gatilho do incidente' AS o_que_e,
         true AS mestre
  UNION ALL
  SELECT 2, 'gatilho: estoque baixo',
         COALESCE((SELECT CASE tgenabled WHEN 'D' THEN 'desabilitado' ELSE 'HABILITADO' END
                     FROM pg_trigger
                    WHERE tgrelid = 'public.produtos'::regclass
                      AND tgname = 'trg_low_stock_notify'), 'nao existe'),
         'avisa quando um produto cruza o limite de estoque baixo', true

  -- ---------- Torneira geral ----------
  UNION ALL
  SELECT 3, 'torneira geral (envio_pausado)',
         COALESCE((SELECT CASE WHEN (value->>'on')::boolean THEN 'PAUSADO' ELSE 'liberado' END
                     FROM public.sync_state WHERE key = 'envio_pausado'), 'linha ausente'),
         'quando PAUSADO, nenhum canal envia nada — vale para todo caminho', true

  -- ---------- Supressao temporaria (a de lote) ----------
  UNION ALL
  SELECT 4, 'supressao de lote (suppress_order_notify)',
         COALESCE((SELECT CASE
                     WHEN COALESCE((value->>'on')::boolean, false)
                          AND COALESCE((value->>'ate')::timestamptz, '-infinity') > now()
                       THEN 'ATIVA ate ' || (value->>'ate') || '  (lotes vivos: ' || COALESCE(value->>'n','?') || ')'
                     ELSE 'inativa' END
                     FROM public.sync_state WHERE key = 'suppress_order_notify'), 'linha ausente'),
         'ligada por sync/lote enquanto roda; expira sozinha. Inativa e o normal em repouso', false

  -- ---------- Tetos por hora ----------
  UNION ALL
  SELECT 5, 'teto: notificacao de status/hora',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'order_notify_max_per_hour'), 'AUSENTE'),
         'sem esta linha o gatilho falha FECHADO (nao notifica) — ausente nao e perigo', false
  UNION ALL
  SELECT 6, 'teto: estoque baixo/hora',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'low_stock_max_per_hour'), 'AUSENTE'),
         'idem', false
  UNION ALL
  SELECT 7, 'teto: SMS/hora',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'sms_max_per_hour'), 'AUSENTE'),
         'limite duro de SMS por hora, conferido imediatamente antes de cada envio', false
  UNION ALL
  SELECT 8, 'teto: e-mail/hora',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'email_max_per_hour'), 'AUSENTE'), 'idem', false
  UNION ALL
  SELECT 9, 'teto: e-mail de login/hora',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'auth_max_per_hour'), 'AUSENTE'),
         'recuperacao de senha e link magico — canal separado dos avisos', false

  -- ---------- Idade ----------
  UNION ALL
  SELECT 10, 'idade maxima do pedido (dias)',
         COALESCE((SELECT value->>'n' FROM public.sync_state WHERE key = 'order_notify_max_age_days'), 'AUSENTE'),
         'pedido mais velho que isto nunca gera aviso, por nenhum caminho. Numero ALTO aqui e perigoso', false

  -- ---------- Canais e eventos ----------
  UNION ALL
  SELECT 11, 'canais ligados',
         COALESCE((SELECT string_agg(id, ', ' ORDER BY id) FROM public.notification_channels WHERE enabled), 'nenhum'),
         'canal desligado nao envia, mesmo com evento ligado', false
  UNION ALL
  SELECT 12, 'eventos ligados',
         COALESCE((SELECT string_agg(id, ', ' ORDER BY id) FROM public.notification_events WHERE enabled), 'nenhum'),
         'evento desligado nao envia', false
  UNION ALL
  SELECT 13, 'eventos que avisam o CLIENTE',
         COALESCE((SELECT string_agg(id, ', ' ORDER BY id) FROM public.notification_events
                    WHERE enabled AND notify_customer), 'nenhum'),
         'estes chegam no telefone/e-mail do cliente — os que mais importam', false

  -- ---------- Automacao ----------
  UNION ALL
  SELECT 14, 'crons agendados',
         (SELECT count(*)::text FROM cron.job),
         'zero = nada roda sozinho. Cada cron e um sync que dispara sem ninguem clicar', false
  UNION ALL
  SELECT 15, 'fila HTTP pendente',
         (SELECT count(*)::text FROM net.http_request_queue),
         'chamadas ja enfileiradas esperando sair — deveria ser 0 em repouso', false
)
SELECT
  t.ord AS "#",
  CASE WHEN t.mestre THEN '** ' || t.trava ELSE '   ' || t.trava END AS trava,
  t.valor,
  CASE
    WHEN t.trava LIKE 'gatilho%'  AND t.valor IN ('desabilitado','nao existe') THEN 'MUDO'
    WHEN t.trava LIKE 'gatilho%'                                               THEN 'ABERTO'
    WHEN t.trava LIKE 'torneira%' AND t.valor = 'PAUSADO'                      THEN 'MUDO'
    WHEN t.trava LIKE 'torneira%' AND t.valor = 'liberado'                     THEN 'ABERTO'
    WHEN t.trava LIKE 'torneira%'                                              THEN 'CONFERIR'
    WHEN t.trava LIKE 'supressao%' AND t.valor LIKE 'ATIVA%'                   THEN 'MUDO'
    WHEN t.trava LIKE 'idade%'    AND t.valor <> 'AUSENTE'
         AND (t.valor ~ '^[0-9]+$') AND t.valor::int > 30                      THEN 'CONFERIR'
    WHEN t.trava = 'fila HTTP pendente' AND t.valor <> '0'                     THEN 'CONFERIR'
    WHEN t.trava = 'crons agendados'    AND t.valor <> '0'                     THEN 'ABERTO'
    ELSE '-'
  END AS veredito,
  t.o_que_e
FROM t
ORDER BY t.ord;

-- ============================================================================
-- LEITURA RAPIDA
--
-- Para "nada sai de jeito nenhum", basta UMA destas tres marcadas com ** estar
-- MUDO. Hoje, pela migration 20260825180000, as tres deveriam estar:
--   #1 gatilho de status  -> desabilitado
--   #2 gatilho de estoque -> desabilitado
--   #3 torneira geral     -> PAUSADO
--
-- Se alguma aparecer ABERTO e voce nao religou de proposito, PARE e me avise.
--
-- A linha #13 (eventos que avisam o CLIENTE) e a que mais importa no dia em que
-- as travas forem soltas: e a lista do que chega no telefone do cliente.
-- ============================================================================
