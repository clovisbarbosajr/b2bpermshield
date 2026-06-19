-- ============================================================================
-- Sub-customers (modelo do B2BWave): cliente com `parent_customer_id` apontando
-- pro pai + 2 permissões. Doc: docs.b2bwave.com/article/138-sub-customers.
--   can_confirm_order      = pode SUBMETER/CONFIRMAR pedido sozinho. OFF (padrão) =>
--                            só SALVA; o pai confirma. (B2BWave: "complete all steps
--                            to submit and confirm orders".)
--   can_view_full_history  = vê o histórico DELE + do PAI. OFF (padrão) => só o dele.
-- DEFAULT = false (seguro: sem permissão nenhuma até o admin/pai liberar).
-- A imposição de verdade é por RLS/trigger (próxima migration) — UI sozinha não basta.
-- ============================================================================
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS can_confirm_order     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_full_history boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clientes.can_confirm_order IS
  'Sub-customer pode submeter/confirmar pedido sozinho. false => só salva; o pai confirma.';
COMMENT ON COLUMN public.clientes.can_view_full_history IS
  'Sub-customer vê o histórico de pedidos do pai também. false => só os próprios.';
