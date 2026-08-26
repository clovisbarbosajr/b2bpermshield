-- ============================================================================
-- O REGISTRO ANTIGO GANHA A MARCA DE ORIGEM, SENAO O DEDUPE E CEGO
--
-- Achado do cetico, rodada 2. O sync passou a marcar `origem: "b2bwave"` no
-- payload da notificacao, e a checagem de "ja anunciei este pedido?" filtra por
-- essa marca.
--
-- So que a marca comeca a existir NESTE deploy. Toda linha `new_order` gravada
-- antes nao tem `origem` — inclusive as das ultimas 48 horas, que sao
-- exatamente as que a barreira de idade deixa passar.
--
-- Resultado sem este backfill: um pedido sincronizado ontem, reimportado hoje,
-- RE-NOTIFICA. O dedupe nao cobriria a janela para a qual foi construido.
--
-- COMO DISTINGUIR o que veio do sync do que veio do portal, olhando so o log:
-- `order_numero` nao serve — o Checkout (`Checkout.tsx:884`) e a tela do admin
-- (`OrderDetail.tsx:447`) tambem gravam esse campo. O discriminador e `items`:
-- os dois chamadores do portal SEMPRE mandam a lista de itens; o sync NUNCA
-- manda. Linha com `order_numero` e sem `items` veio do sync.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Quantas linhas vao ser marcadas, e quantas ficam de fora (as do portal):
--
--   SELECT
--     count(*) FILTER (WHERE payload ? 'order_numero'
--                        AND NOT (payload ? 'origem')
--                        AND NOT (payload ? 'items'))            AS vao_ser_marcadas,
--     count(*) FILTER (WHERE payload ? 'items')                  AS do_portal_ficam_de_fora,
--     count(*) FILTER (WHERE payload ? 'origem')                 AS ja_marcadas,
--     count(*)                                                   AS total_new_order
--   FROM public.notification_log WHERE event = 'new_order';
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) Indice, ANTES do backfill ----------
-- Sem ele, cada pedido criado num tick faz varredura completa em
-- `notification_log`. Num reimport de ~1.150 pedidos sao ~1.150 varreduras.
-- Parcial (`WHERE event = 'new_order'`) porque e o unico evento consultado.
CREATE INDEX IF NOT EXISTS notification_log_dedupe_idx
  ON public.notification_log ((payload->>'order_numero'))
  WHERE event = 'new_order';

-- ---------- 2) Marca o historico do sync ----------
UPDATE public.notification_log
   SET payload = payload || '{"origem":"b2bwave"}'::jsonb
 WHERE event = 'new_order'
   AND payload ? 'order_numero'
   AND NOT (payload ? 'origem')   -- nao remarca o que ja tem
   AND NOT (payload ? 'items');   -- `items` = veio do portal, nao do sync

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO marca linha do portal. Marcar seria pior que nao marcar: o dedupe
-- passaria a calar aviso de pedido do B2BWave por causa de um pedido do portal
-- com o mesmo numero — e os dois numeram no mesmo espaco.
--
-- NAO distingue envio de nao-envio. Quem faz isso e o filtro `status = 'sent'`
-- do proprio dedupe (b2bwave-sync). Aqui a marca vai em toda linha do sync,
-- inclusive as de skip, porque a marca e de ORIGEM, nao de resultado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   UPDATE public.notification_log
--      SET payload = payload - 'origem'
--    WHERE event = 'new_order' AND payload->>'origem' = 'b2bwave';
--   DROP INDEX IF EXISTS public.notification_log_dedupe_idx;
--
-- ATENCAO: isto remove TAMBEM a marca das linhas gravadas depois do deploy, que
-- sao legitimas. Reverter deixa o dedupe cego de novo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O historico foi marcado e o portal NAO:
--   SELECT
--     count(*) FILTER (WHERE payload->>'origem' = 'b2bwave')  AS marcadas,
--     count(*) FILTER (WHERE payload ? 'items'
--                        AND payload ? 'origem')              AS deve_ser_0
--   FROM public.notification_log WHERE event = 'new_order';
--
-- 2) CONTROLE — o indice existe:
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'notification_log'
--      AND indexname = 'notification_log_dedupe_idx';
--   -- ESPERADO: uma linha.
--
--   (Aqui NAO se usa `EXPLAIN`: em tabela pequena o planejador escolhe
--    `Seq Scan` porque e mais barato, com o indice existindo e funcionando
--    perfeitamente. Eu ia pedir para voce me avisar de um "problema" que nao e
--    problema — e a proxima vez que um aviso desses aparecesse de verdade,
--    voce ja o ignoraria.)
-- ---------------------------------------------------------------------------
