-- ============================================================================
-- Conserta os 307 erros do sync de PRODUTOS.
-- Causa: a função b2bwave-sync grava `produtos.b2bwave_id`, mas a coluna só
-- existia em `categorias` (migration 20260319202428). Sem ela, TODO upsert de
-- produto falhava ("column b2bwave_id does not exist") → 307 erros = todos.
-- ============================================================================
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS b2bwave_id integer;
CREATE INDEX IF NOT EXISTS produtos_b2bwave_id_idx ON public.produtos (b2bwave_id);
