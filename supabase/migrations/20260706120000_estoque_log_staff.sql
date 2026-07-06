-- ============================================================================
-- AJUSTE DE ESTOQUE PELO WAREHOUSE (tela nova "Inventory Adjustment").
-- estoque_log era admin-only (FOR ALL admin) — warehouse já podia ATUALIZAR
-- produtos.estoque_total (policy "Warehouse update produtos", 20260619003000),
-- mas o INSERT do histórico em estoque_log falhava silencioso. Staff completo
-- (admin/manager/warehouse) agora grava e lê o histórico de estoque.
-- (A policy "Admins can manage estoque_log" FOR ALL continua.)
-- ============================================================================

DROP POLICY IF EXISTS "Staff insert estoque_log" ON public.estoque_log;
CREATE POLICY "Staff insert estoque_log" ON public.estoque_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager')
    OR public.has_role(auth.uid(),'warehouse')
  );

DROP POLICY IF EXISTS "Staff read estoque_log" ON public.estoque_log;
CREATE POLICY "Staff read estoque_log" ON public.estoque_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager')
    OR public.has_role(auth.uid(),'warehouse')
  );
