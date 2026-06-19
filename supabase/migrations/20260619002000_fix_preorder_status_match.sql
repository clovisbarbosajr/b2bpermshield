-- ============================================================================
-- Conserta a detecção de PRÉ-VENDA no trigger anti-oversell.
-- O admin salva `produtos.status_produto = 'pre_venda'` (com underline), mas a
-- migration 20260618234500 só excluía '%pre%order%' / '%pre-venda%' (com hífen),
-- que NÃO casam com 'pre_venda'. Resultado: produto de pré-venda seria bloqueado
-- por falta de estoque (errado — pré-venda compra além do estoque).
-- Aqui usamos '%pre%venda%' e '%pre%order%', que casam tanto 'pre_venda' quanto
-- 'pre-venda'/'pre order'/'preorder'. (Em LIKE, '%' cobre o separador.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_reserve_stock_on_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _backorder boolean;
  _status    text;
  _enforce   boolean;
  _updated   int;
BEGIN
  SELECT permitir_backorder, status_produto
    INTO _backorder, _status
  FROM produtos WHERE id = NEW.produto_id;

  _enforce :=
        auth.role() = 'authenticated'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND _backorder IS NOT TRUE
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%venda%'   -- pré-venda (pre_venda/pre-venda)
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%order%'   -- pre-order/preorder
    AND lower(coalesce(_status, '')) NOT LIKE '%encomenda%';  -- sob encomenda

  IF _enforce THEN
    UPDATE produtos
    SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id
      AND (estoque_total - estoque_reservado) >= NEW.quantidade;
    GET DIAGNOSTICS _updated = ROW_COUNT;
    IF _updated = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK'
        USING ERRCODE = 'check_violation',
              MESSAGE = 'Insufficient stock for product ' || NEW.produto_id;
    END IF;
  ELSE
    UPDATE produtos
    SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id;
  END IF;

  INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
  SELECT
    NEW.produto_id,
    p.estoque_total - (p.estoque_reservado - NEW.quantidade),
    p.estoque_total - p.estoque_reservado,
    'Order item reserved (order ' || NEW.pedido_id || ')'
  FROM produtos p WHERE p.id = NEW.produto_id;

  RETURN NEW;
END;
$$;
