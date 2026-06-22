ALTER TABLE public.pedidos ALTER COLUMN status SET DEFAULT 'submitted';

UPDATE public.pedidos SET status = 'submitted' WHERE status::text = 'recebido';
UPDATE public.pedidos SET status = 'on_hold'   WHERE status::text = 'em_processamento';
UPDATE public.pedidos SET status = 'sent'      WHERE status::text = 'enviado';
UPDATE public.pedidos SET status = 'complete'  WHERE status::text = 'concluido';
UPDATE public.pedidos SET status = 'cancelled' WHERE status::text = 'cancelado';

CREATE OR REPLACE FUNCTION public.fn_adjust_stock_on_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_cancel boolean := NEW.status::text IN ('cancelado','cancelled');
  _old_cancel boolean := OLD.status::text IN ('cancelado','cancelled');
  _new_done   boolean := NEW.status::text IN ('concluido','complete');
  _old_done   boolean := OLD.status::text IN ('concluido','complete');
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF _new_cancel AND NOT _old_cancel THEN
    UPDATE produtos p
    SET estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id,
           p.estoque_total - (p.estoque_reservado + pi.quantidade),
           p.estoque_total - p.estoque_reservado,
           'Stock returned - order cancelled (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  IF _new_done AND NOT _old_done THEN
    UPDATE produtos p
    SET estoque_total = GREATEST(0, p.estoque_total - pi.quantidade),
        estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id, p.estoque_total + pi.quantidade, p.estoque_total,
           'Stock deducted - order completed (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  IF _old_cancel AND NOT _new_cancel THEN
    UPDATE produtos p
    SET estoque_reservado = p.estoque_reservado + pi.quantidade
    FROM pedido_itens pi
    WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id,
           p.estoque_total - (p.estoque_reservado - pi.quantidade),
           p.estoque_total - p.estoque_reservado,
           'Stock re-reserved - order reactivated (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS quantidade_enviada integer NOT NULL DEFAULT 0;
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS backorder boolean NOT NULL DEFAULT false;
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS status_linha text;