-- ============================================================================
-- BUG HUNT round 2 — integridade de PEDIDOS (3 correções densas).
-- ============================================================================

-- 1) COLISÃO DE NUMERO: o sync casava pedidos por `numero`, que colide com o
--    SERIAL dos pedidos criados no checkout (mesmo espaço de inteiros pequenos)
--    -> o sync podia SOBRESCREVER um pedido real do app. Agora o sync casa por
--    `b2bwave_order_id`; pedido nativo do app fica com NULL e NUNCA é tocado.
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS b2bwave_order_id integer;
-- Backfill: os pedidos existentes vieram TODOS do B2BWave (não há pedido criado
-- no checkout ainda — confirmado: 0 pedidos sem origem). numero = id do B2BWave.
UPDATE public.pedidos SET b2bwave_order_id = numero WHERE b2bwave_order_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_b2bwave_order_id_uidx
  ON public.pedidos (b2bwave_order_id) WHERE b2bwave_order_id IS NOT NULL;

-- 2) PAI VÊ PEDIDOS DO SUB-USUÁRIO. O pedido do sub fica com o cliente_id dele;
--    sem isto o dono da conta não enxerga os pedidos dos funcionários.
DROP POLICY IF EXISTS "Parent reads sub-customer orders" ON public.pedidos;
CREATE POLICY "Parent reads sub-customer orders" ON public.pedidos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clientes sub
    JOIN public.clientes parent ON parent.id = sub.parent_customer_id
    WHERE sub.id = pedidos.cliente_id AND parent.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "Parent reads sub-customer order items" ON public.pedido_itens;
CREATE POLICY "Parent reads sub-customer order items" ON public.pedido_itens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pedidos p
    JOIN public.clientes sub ON sub.id = p.cliente_id
    JOIN public.clientes parent ON parent.id = sub.parent_customer_id
    WHERE p.id = pedido_itens.pedido_id AND parent.user_id = auth.uid()
  ));

-- 3) TOTAL CONSISTENTE (pedidos do APP). O total é recomputado dos componentes
--    no banco, então o cliente NÃO consegue gravar um total inconsistente
--    (ex.: total=0.01 com subtotal alto). Pedidos do sync (b2bwave_order_id)
--    ficam com o total do B2BWave intacto. (Validação total dos preços por item
--    via price list é um passo maior — fica para uma RPC de criação de pedido.)
CREATE OR REPLACE FUNCTION public.fn_pedido_total_appside()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    NEW.total := GREATEST(0,
      COALESCE(NEW.subtotal,0) - COALESCE(NEW.desconto,0)
      + COALESCE(NEW.sales_tax,0) + COALESCE(NEW.shipping_costs,0));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pedido_total_appside ON public.pedidos;
CREATE TRIGGER trg_pedido_total_appside
  BEFORE INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_total_appside();
