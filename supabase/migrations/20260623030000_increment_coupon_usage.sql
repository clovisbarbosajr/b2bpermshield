-- ============================================================================
-- Incremento ATÔMICO do uso de cupom. Antes o Checkout fazia read-modify-write
-- (uso_atual = lido + 1), o que perde update em corrida e estoura o uso_maximo.
-- Esta RPC faz um UPDATE condicional único: só incrementa se ainda há uso.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(_coupon_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.coupons
  SET uso_atual = COALESCE(uso_atual, 0) + 1
  WHERE id = _coupon_id
    AND (uso_maximo IS NULL OR COALESCE(uso_atual, 0) < uso_maximo);
$$;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage(uuid) TO authenticated;
