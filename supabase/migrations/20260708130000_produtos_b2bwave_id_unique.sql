-- ============================================================================
-- SYNC PASSA A CASAR PRODUTO POR B2BWAVE_ID (não mais por sku).
-- Pré-requisito do upsert onConflict "b2bwave_id": índice ÚNICO na coluna.
-- NULLs não colidem (produtos criados manualmente ficam de fora sem problema).
--
-- Isso torna SEGURO limpar os códigos auto-gerados ("Black Box-341" etc.):
-- o sync reconhece o produto pela identidade real do B2BWave, com ou sem código.
--
-- ORDEM OBRIGATÓRIA:
--   1. Rodar este índice.
--   2. REDEPLOY da edge function b2bwave-sync (nova versão casa por b2bwave_id).
--   3. Só então rodar a limpeza:
--      UPDATE public.produtos SET sku = NULL WHERE b2bwave_id IS NOT NULL;
--      (limpa só os produtos vindos do B2BWave; código digitado à mão fica.)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS produtos_b2bwave_id_uidx
  ON public.produtos (b2bwave_id);
