-- ============================================================================
-- Anti-OVERSELL: reserva de estoque ATÔMICA no insert de pedido_itens.
--
-- Antes: `fn_reserve_stock_on_order_item` somava `estoque_reservado` cego, e a
-- validação de estoque era só client-side (Checkout, em JS) — janela TOCTOU:
-- dois clientes no último item liam "disponível=1", passavam, e ambos inseriam
-- → reservado > total (oversell).
--
-- Agora: para PEDIDO DE CLIENTE autenticado, em produto que NÃO permite backorder
-- e NÃO é pré-venda, a reserva vira um UPDATE condicional que trava a linha do
-- produto e só reserva se houver disponível. Pedidos concorrentes serializam;
-- o segundo falha (check_violation) em vez de furar o estoque.
--
-- GATED (fail-safe — nestes casos mantém o comportamento antigo, NÃO bloqueia):
--   • Sync do B2BWave (service_role)  -> traz histórico, não pode ser barrado.
--   • Admin (has_role admin)          -> pode fazer ajuste/oversell intencional.
--   • Produto com `permitir_backorder` -> backorder é permitido de propósito.
--   • Produto em pré-venda (status)    -> pré-venda compra além do estoque.
-- Detecção de pré-venda é best-effort por nome de status; testar um produto de
-- pré-venda após o deploy.
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
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%order%'
    AND lower(coalesce(_status, '')) NOT LIKE '%pre-venda%'
    AND lower(coalesce(_status, '')) NOT LIKE '%encomenda%';

  IF _enforce THEN
    -- Reserva atômica: o WHERE trava a linha e só passa se houver disponível.
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
    -- Comportamento antigo (sync / admin / backorder / pré-venda): reserva sem bloquear.
    UPDATE produtos
    SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id;
  END IF;

  -- Log do movimento (idêntico ao original).
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
