
-- 1) Trigger: when pedido_itens are inserted, reserve stock
CREATE OR REPLACE FUNCTION public.fn_reserve_stock_on_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Increment estoque_reservado
  UPDATE produtos
  SET estoque_reservado = estoque_reservado + NEW.quantidade
  WHERE id = NEW.produto_id;

  -- Log the movement
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

CREATE TRIGGER trg_reserve_stock_on_order_item
AFTER INSERT ON public.pedido_itens
FOR EACH ROW
EXECUTE FUNCTION public.fn_reserve_stock_on_order_item();

-- 2) Trigger: when pedido status changes, handle stock
CREATE OR REPLACE FUNCTION public.fn_adjust_stock_on_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when status actually changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- CANCELLED: release reserved stock back
  IF NEW.status = 'cancelado' AND OLD.status != 'cancelado' THEN
    UPDATE produtos p
    SET estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id
      AND p.id = pi.produto_id;

    -- Log the return
    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT
      pi.produto_id,
      p.estoque_total - (p.estoque_reservado + pi.quantidade),
      p.estoque_total - p.estoque_reservado,
      'Stock returned - order cancelled (' || NEW.id || ')'
    FROM pedido_itens pi
    JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  -- COMPLETED: deduct from total stock and release reservation
  IF NEW.status = 'concluido' AND OLD.status != 'concluido' THEN
    UPDATE produtos p
    SET
      estoque_total = GREATEST(0, p.estoque_total - pi.quantidade),
      estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id
      AND p.id = pi.produto_id;

    -- Log the deduction
    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT
      pi.produto_id,
      p.estoque_total + pi.quantidade,
      p.estoque_total,
      'Stock deducted - order completed (' || NEW.id || ')'
    FROM pedido_itens pi
    JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  -- RE-ACTIVATED from cancelled: re-reserve stock
  IF OLD.status = 'cancelado' AND NEW.status != 'cancelado' THEN
    UPDATE produtos p
    SET estoque_reservado = p.estoque_reservado + pi.quantidade
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id
      AND p.id = pi.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT
      pi.produto_id,
      p.estoque_total - (p.estoque_reservado - pi.quantidade),
      p.estoque_total - p.estoque_reservado,
      'Stock re-reserved - order reactivated (' || NEW.id || ')'
    FROM pedido_itens pi
    JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_adjust_stock_on_order_status
AFTER UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.fn_adjust_stock_on_order_status();
