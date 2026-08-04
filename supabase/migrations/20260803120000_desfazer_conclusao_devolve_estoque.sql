-- ============================================================================
-- BUG (estoque, ALTO): DESFAZER a conclusão de um pedido não devolvia o estoque,
-- e reconcluir baixava DE NOVO.
--
-- `fn_adjust_stock_on_order_status` tinha 3 ramos:
--   1) entrou em cancelado  → devolve o reservado
--   2) entrou em concluído  → baixa `estoque_total` e libera o reservado
--   3) saiu  de cancelado   → reserva de novo
--
-- Faltava o par do ramo 2: **saiu de concluído**. Consequência real, e o
-- caminho é um `<Select>` na LINHA da lista de pedidos (sem confirmação):
--
--   1. admin marca "Complete" no pedido errado → 40 caixas somem do total;
--   2. percebe e volta o status para "Sent"    → o estoque NÃO volta;
--   3. conclui o pedido certo mais tarde       → baixa as mesmas 40 OUTRA VEZ,
--      porque `_new_done AND NOT _old_done` é satisfeito de novo.
--
-- Cada ida e volta some com estoque de forma permanente e silenciosa.
--
-- CORREÇÃO: ramo 4 — ao SAIR de concluído, desfaz exatamente o que o ramo 2 fez:
-- devolve `estoque_total` e volta a reservar. Ou seja, o pedido volta ao estado
-- "aberto com reserva", que é o que ele era antes de concluir.
--
-- Detalhe importante: se o pedido saiu de concluído DIRETO para cancelado, o
-- ramo 1 também dispara e devolveria o reservado — mas neste caso o reservado
-- ainda nem tinha voltado a existir. Por isso o ramo 4 só re-reserva quando o
-- destino NÃO é cancelado; indo para cancelado, apenas o total é devolvido.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_adjust_stock_on_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_cancel boolean := NEW.status::text IN ('cancelado','cancelled');
  _old_cancel boolean := OLD.status::text IN ('cancelado','cancelled');
  _new_done   boolean := NEW.status::text IN ('concluido','complete');
  _old_done   boolean := OLD.status::text IN ('concluido','complete');
BEGIN
  IF NEW.b2bwave_order_id IS NOT NULL THEN RETURN NEW; END IF;  -- pedido do sync: não mexe local
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- CANCELADO: devolve o reservado. (Se veio de concluído, o ramo 4 abaixo já
  -- devolveu o total e NÃO re-reservou — então aqui não há reserva a tirar.)
  IF _new_cancel AND NOT _old_cancel AND NOT _old_done THEN
    UPDATE produtos p SET estoque_reservado = GREATEST(0, p.estoque_reservado - it.qtd)
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    WHERE p.id = it.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT it.produto_id,
           p.estoque_total - (p.estoque_reservado + it.qtd),
           p.estoque_total - p.estoque_reservado,
           'Stock returned - order cancelled (' || NEW.id || ')'
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    JOIN produtos p ON p.id = it.produto_id;
  END IF;

  -- CONCLUÍDO: baixa do total e libera o reservado.
  IF _new_done AND NOT _old_done THEN
    UPDATE produtos p SET estoque_total     = GREATEST(0, p.estoque_total - it.qtd),
                          estoque_reservado = GREATEST(0, p.estoque_reservado - it.qtd)
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    WHERE p.id = it.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT it.produto_id, p.estoque_total + it.qtd, p.estoque_total,
           'Stock deducted - order completed (' || NEW.id || ')'
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    JOIN produtos p ON p.id = it.produto_id;
  END IF;

  -- ===== RAMO NOVO =====
  -- SAIU DE CONCLUÍDO: desfaz o ramo 2. Devolve o `estoque_total` e, se o pedido
  -- volta a ficar ABERTO (destino não é cancelado), reserva de novo.
  IF _old_done AND NOT _new_done THEN
    UPDATE produtos p
       SET estoque_total     = p.estoque_total + it.qtd,
           estoque_reservado = p.estoque_reservado + CASE WHEN _new_cancel THEN 0 ELSE it.qtd END
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    WHERE p.id = it.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT it.produto_id, p.estoque_total - it.qtd, p.estoque_total,
           'Stock restored - order un-completed (' || NEW.id || ')'
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    JOIN produtos p ON p.id = it.produto_id;
  END IF;

  -- REATIVADO (saiu de cancelado): reserva de novo.
  IF _old_cancel AND NOT _new_cancel THEN
    UPDATE produtos p SET estoque_reservado = p.estoque_reservado + it.qtd
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    WHERE p.id = it.produto_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT it.produto_id,
           p.estoque_total - (p.estoque_reservado - it.qtd),
           p.estoque_total - p.estoque_reservado,
           'Stock re-reserved - order reactivated (' || NEW.id || ')'
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    JOIN produtos p ON p.id = it.produto_id;
  END IF;

  RETURN NEW;
END; $$;
