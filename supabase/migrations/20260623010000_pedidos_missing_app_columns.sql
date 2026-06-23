-- ============================================================================
-- Colunas que o fluxo de pedido do APP (Checkout.tsx) usa mas que nunca foram
-- criadas em `pedidos` na base real (o checkout nunca foi testado, então o erro
-- ficou latente). O insert do Checkout grava `desconto` e `coupon_id`, e o trigger
-- fn_pedido_total_appside lê os dois. Sem as colunas, TODO pedido do app falhava
-- ("record new has no field coupon_id"). IF NOT EXISTS: não-destrutivo.
-- ============================================================================
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS desconto numeric(12,2) DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id);
