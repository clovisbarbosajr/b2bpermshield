-- ============================================================================
-- STATUS DE PEDIDO padronizado nos 7 do B2BWave + campos por-linha nos itens.
--
-- Antes: o app usava valores PT na prática ('recebido' default, trigger keyava
-- em 'cancelado'/'concluido'); os 7 EN existiam no enum mas estavam mortos; e o
-- dropdown do admin tinha valores inválidos ('processando','em_separacao').
--
-- Agora: canônico = os 7 do B2BWave (já no enum):
--   submitted, ready_for_pickup, partial, on_hold, sent, complete, cancelled.
-- Migramos os dados PT->EN, o default novo vira 'submitted', e o trigger de
-- estoque passa a disparar em PT OU EN (robusto durante/depois da transição).
-- ============================================================================

-- 1) Default de novos pedidos = submitted.
ALTER TABLE public.pedidos ALTER COLUMN status SET DEFAULT 'submitted';

-- 2) Migra valores legados (PT) -> canônico (EN).
UPDATE public.pedidos SET status = 'submitted' WHERE status = 'recebido';
UPDATE public.pedidos SET status = 'on_hold'   WHERE status = 'em_processamento';
-- (nota: 'em_separacao' nunca existiu no enum pedido_status — Postgres recusa o
--  literal no parse, então não há UPDATE para ele.)
UPDATE public.pedidos SET status = 'sent'      WHERE status = 'enviado';
UPDATE public.pedidos SET status = 'complete'  WHERE status = 'concluido';
UPDATE public.pedidos SET status = 'cancelled' WHERE status = 'cancelado';

-- 3) Trigger de estoque robusto: aceita PT OU EN para cancel/complete.
CREATE OR REPLACE FUNCTION public.fn_adjust_stock_on_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_cancel boolean := NEW.status IN ('cancelado','cancelled');
  _old_cancel boolean := OLD.status IN ('cancelado','cancelled');
  _new_done   boolean := NEW.status IN ('concluido','complete');
  _old_done   boolean := OLD.status IN ('concluido','complete');
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- CANCELADO: libera o reservado.
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

  -- CONCLUÍDO: baixa do total e libera reserva.
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

  -- REATIVADO de cancelado: re-reserva.
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

-- 4) Itens de pedido: rastreio por LINHA (igual ao B2BWave: qty shipped + backorder
--    + status da linha). A UI do OrderDetail já tem as colunas (eram "—").
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS quantidade_enviada integer NOT NULL DEFAULT 0;
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS backorder boolean NOT NULL DEFAULT false;
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS status_linha text;
