-- ============================================================================
-- FALTAVA O CRON DE CATEGORIAS. Havia jobs para orders/customers/products/
-- pricelists, mas NÃO para categorias — categoria nova criada no B2BWave só
-- aparecia se alguém rodasse o sync manual (caso 2026-07-17: dono criou
-- categorias, não sincronizaram sozinhas). O sync_products lê categories.json
-- só para MAPEAR produto->categoria; não cria/atualiza a tabela `categorias`.
-- Agenda em :05 — ANTES do sync de produtos (:10) — para que os produtos já
-- encontrem as categorias novas ao mapear.
-- ============================================================================
DO $outer$
BEGIN
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-categories', '5 * * * *', 'sync_categories');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'b2bwave categories cron pulado: %', SQLERRM;
END
$outer$;

-- Para pausar no corte (junto dos outros):
--   select cron.unschedule('b2bwave-cron-categories');
