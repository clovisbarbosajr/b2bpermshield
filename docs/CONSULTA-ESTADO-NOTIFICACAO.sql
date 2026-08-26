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
-- SO UMA trava e global: a #3, a torneira (`envio_pausado`). Ela e lida por
-- `envio_permitido`, e nao ha caminho de envio que nao passe por la — com ela
-- fechada, nada sai por nenhum canal.
--
-- As #1 e #2 sao POR GATILHO: #1 muda so cala mudanca de status de pedido, e #2
-- muda so cala alerta de estoque. Uma nao cobre a outra, e nenhuma das duas
-- cobre os avisos que saem por edge function. Este texto ja afirmou que
-- "qualquer uma das tres" bastava; era falso, e a diferenca aparece justamente
-- no dia de religar, quando elas param de estar todas fechadas juntas.
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
         -- `mestre` = trava GLOBAL, que sozinha impede qualquer envio. So a
         -- torneira (#3) e. Este gatilho, mudo, nao impede alerta de estoque nem
         -- nada que saia por edge function — marcar as tres com o mesmo
         -- asterisco ensinava uma redundancia que nao existe, e o cabecalho
         -- afirmava isso por escrito ate 26/ago.
         false AS mestre
  UNION ALL
  SELECT 2, 'gatilho: estoque baixo',
         COALESCE((SELECT CASE tgenabled WHEN 'D' THEN 'desabilitado' ELSE 'HABILITADO' END
                     FROM pg_trigger
                    WHERE tgrelid = 'public.produtos'::regclass
                      AND tgname = 'trg_low_stock_notify'), 'nao existe'),
         -- Idem: mudo, nao impede notificacao de status de pedido.
         'avisa quando um produto cruza o limite de estoque baixo', false

  -- ---------- Torneira geral ----------
  UNION ALL
  SELECT 3, 'torneira geral (envio_pausado)',
         COALESCE((SELECT CASE WHEN (value->>'on')::boolean THEN 'PAUSADO' ELSE 'liberado' END
                     FROM public.sync_state WHERE key = 'envio_pausado'), 'linha ausente'),
         -- A UNICA global: `envio_permitido` e consultada por todo caminho de
         -- envio, um por um, no instante antes de gastar.
         'quando PAUSADO, nenhum canal envia nada — vale para todo caminho', true

  -- ---------- Supressao temporaria (a de lote) ----------
  UNION ALL
  SELECT 4, 'supressao de lote (suppress_order_notify)',
         -- MESMA regra que `fn_order_status_notify` usa depois de 20260826080000:
         -- janela valida OU lote vivo (limitado pelo teto de 2h). A versao
         -- anterior desta consulta olhava so a janela, entao dizia "inativa"
         -- com o banco suprimindo — um painel contradizendo a funcao que ele
         -- existe para explicar.
         COALESCE((SELECT CASE
                     WHEN COALESCE((value->>'on')::boolean, false)
                          AND (COALESCE((value->>'ate')::timestamptz, '-infinity') > now()
                               OR (COALESCE((value->>'n')::integer, 0) > 0
                                   AND COALESCE((value->>'desde')::timestamptz, '-infinity')
                                       > now() - interval '120 minutes'))
                       THEN 'ATIVA  (ate ' || COALESCE(value->>'ate','?')
                            || ', lotes vivos: ' || COALESCE(value->>'n','?') || ')'
                     ELSE 'inativa' END
                     FROM public.sync_state WHERE key = 'suppress_order_notify'), 'linha ausente'),
         'ligada por sync/lote enquanto roda. Se ficar ATIVA em repouso, e contador orfao: some sozinha 120min apos o `desde`. Inativa e o normal', false

  -- ---------- Supressao de ESTOQUE (a chave nova, 20260826090000) ----------
  -- Sem esta linha, o painel diria "tudo limpo" com `trg_low_stock_notify` mudo:
  -- a chave nova tem o MESMO modo de falha (contador orfao, ate 2h de silencio)
  -- e TRES levantadores novos — `sync_products`, a tela de ajuste de inventario
  -- e a importacao de pedidos. Nao-envio invisivel na propria coisa que a leva
  -- de 26/ago introduziu.
  UNION ALL
  SELECT 4.5, 'supressao de lote (suppress_stock_notify)',
         COALESCE((SELECT CASE
                     WHEN COALESCE((value->>'on')::boolean, false)
                          AND (COALESCE((value->>'ate')::timestamptz, '-infinity') > now()
                               OR (COALESCE((value->>'n')::integer, 0) > 0
                                   AND COALESCE((value->>'desde')::timestamptz, '-infinity')
                                       > now() - interval '120 minutes'))
                       THEN 'ATIVA  (ate ' || COALESCE(value->>'ate','?')
                            || ', lotes vivos: ' || COALESCE(value->>'n','?') || ')'
                     ELSE 'inativa' END
                     FROM public.sync_state WHERE key = 'suppress_stock_notify'), 'linha ausente (migration 20260826090000 nao rodou)'),
         'ligada por sync de produtos / ajuste de inventario / import de pedidos. ATIVA em repouso = contador orfao', false

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
  -- `**` marca a UNICA trava global. As outras sao por gatilho e nao se cobrem.
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
-- Para "nada sai de jeito nenhum", quem responde e a #3, a torneira. As #1 e #2
-- sao por gatilho e NAO se cobrem: veja a nota do cabecalho.
--
-- O ESTADO ESPERADO MUDA conforme o passo do religamento em que voce esta — o
-- roteiro e a secao "FALTA (nesta ordem)" do `docs/LOG-TRABALHO.md`. Confira
-- contra ela, nao contra uma foto fixa; este rodape ja descreveu um estado que a
-- propria leva de 26/ago abandonou no mesmo dia.
--
--   antes do passo 4 : #1 HABILITADO (religado em 26/ago), #2 desabilitado, #3 PAUSADO
--   depois do passo 4: #1 e #2 HABILITADOS, #3 ainda PAUSADO
--   depois do passo 7: as tres abertas — e ai vale o passo 8, a vigia
--
-- A qualquer momento ANTES do passo 7, a #3 tem que estar PAUSADO. Se ela
-- aparecer liberada e voce nao abriu de proposito, PARE e me avise: e a unica
-- das tres cuja abertura gasta dinheiro.
--
-- A linha #13 (eventos que avisam o CLIENTE) e a que mais importa no dia em que
-- as travas forem soltas: e a lista do que chega no telefone do cliente.
-- ============================================================================
