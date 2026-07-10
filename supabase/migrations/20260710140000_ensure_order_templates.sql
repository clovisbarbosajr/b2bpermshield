-- ============================================================================
-- Garante as colunas de template de pedido na configuracoes. As migrações de
-- abril (20260409000002 / 20260410000002) existiam no repo mas NUNCA foram
-- aplicadas neste banco — pdf_order_template faltando derrubava o select
-- combinado da aba Notifications → Email ("Configuration not found" no Save)
-- e o preview do generate-pdf. Idempotente.
-- ============================================================================
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS pdf_order_template text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS email_order_template text;
NOTIFY pgrst, 'reload schema';
