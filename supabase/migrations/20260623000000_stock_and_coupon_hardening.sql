-- ============================================================================
-- BUG HUNT round 3 — ESTOQUE + cupom.
--  A) CRÍTICO: o sync (service_role) inseria itens dos 884 pedidos históricos e
--     o trigger de reserva caía no ELSE -> `estoque_reservado += qtd` INCONDICIONAL,
--     inflando o reservado de forma permanente e crescente (delete+insert a cada
--     ciclo). Pedido SINCRONIZADO (b2bwave_order_id NOT NULL) NÃO deve reservar:
--     o B2BWave já manda quantity_reserved. -> trigger ignora pedido sincronizado.
--  B) ALTO: apagar um item do pedido (admin) não devolvia a reserva. -> trigger
--     AFTER DELETE devolve, só p/ pedido do APP ainda ativo.
--  C) cupom: o total recomputava o desconto a partir do cupom SEM checar validade
--     (ativo/datas/uso). -> valida; cupom inválido => desconto 0.
-- ============================================================================

-- A) Reserva ignora pedidos sincronizados do B2BWave.
CREATE OR REPLACE FUNCTION public.fn_reserve_stock_on_order_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _backorder boolean;
  _status    text;
  _enforce   boolean;
  _updated   int;
  _is_synced boolean;
BEGIN
  -- Pedido vindo do B2BWave: o reservado é responsabilidade do B2BWave
  -- (quantity_reserved chega no sync de produtos). NÃO reserva localmente.
  SELECT (b2bwave_order_id IS NOT NULL) INTO _is_synced FROM pedidos WHERE id = NEW.pedido_id;
  IF _is_synced THEN RETURN NEW; END IF;

  SELECT permitir_backorder, status_produto INTO _backorder, _status
  FROM produtos WHERE id = NEW.produto_id;

  _enforce :=
        auth.role() = 'authenticated'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND _backorder IS NOT TRUE
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%venda%'
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%order%'
    AND lower(coalesce(_status, '')) NOT LIKE '%encomenda%';

  IF _enforce THEN
    UPDATE produtos SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id AND (estoque_total - estoque_reservado) >= NEW.quantidade;
    GET DIAGNOSTICS _updated = ROW_COUNT;
    IF _updated = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK'
        USING ERRCODE = 'check_violation', MESSAGE = 'Insufficient stock for product ' || NEW.produto_id;
    END IF;
  ELSE
    UPDATE produtos SET estoque_reservado = estoque_reservado + NEW.quantidade WHERE id = NEW.produto_id;
  END IF;

  INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
  SELECT NEW.produto_id,
    p.estoque_total - (p.estoque_reservado - NEW.quantidade),
    p.estoque_total - p.estoque_reservado,
    'Order item reserved (order ' || NEW.pedido_id || ')'
  FROM produtos p WHERE p.id = NEW.produto_id;

  RETURN NEW;
END; $$;

-- B) Devolve a reserva ao apagar um item de pedido do APP ainda ativo.
CREATE OR REPLACE FUNCTION public.fn_release_stock_on_item_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st text; _b2b integer;
BEGIN
  SELECT status::text, b2bwave_order_id INTO _st, _b2b FROM pedidos WHERE id = OLD.pedido_id;
  -- Só pedido do APP (b2bwave_order_id NULL), parent ainda existente e ativo.
  -- (parent NULL = pedido sendo apagado em cascata -> não devolve, evita over-release.)
  IF _b2b IS NULL AND _st IS NOT NULL
     AND _st NOT IN ('cancelado','cancelled','concluido','complete') THEN
    UPDATE produtos SET estoque_reservado = GREATEST(0, estoque_reservado - OLD.quantidade)
    WHERE id = OLD.produto_id;
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_release_stock_on_item_delete ON public.pedido_itens;
CREATE TRIGGER trg_release_stock_on_item_delete AFTER DELETE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_release_stock_on_item_delete();

-- C) Total: valida o cupom antes de aplicar o desconto (ativo/datas/uso).
CREATE OR REPLACE FUNCTION public.fn_pedido_total_appside()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d numeric;
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    IF NEW.coupon_id IS NULL THEN
      NEW.desconto := 0;
    ELSE
      SELECT CASE WHEN cp.tipo = 'percentual'
                  THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                  ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
        INTO _d FROM public.coupons cp
        WHERE cp.id = NEW.coupon_id
          AND cp.ativo IS TRUE
          AND (cp.data_inicio IS NULL OR cp.data_inicio <= now())
          AND (cp.data_fim    IS NULL OR cp.data_fim    >= now())
          AND (cp.uso_maximo  IS NULL OR COALESCE(cp.uso_atual,0) < cp.uso_maximo);
      NEW.desconto := LEAST(GREATEST(COALESCE(_d,0),0), COALESCE(NEW.subtotal,0));
    END IF;
    NEW.sales_tax := GREATEST(COALESCE(NEW.sales_tax,0), 0);
    NEW.shipping_costs := GREATEST(COALESCE(NEW.shipping_costs,0), 0);
    NEW.total := GREATEST(0, COALESCE(NEW.subtotal,0) - NEW.desconto + NEW.sales_tax + NEW.shipping_costs);
  END IF;
  RETURN NEW;
END; $$;

-- D) (pequeno) idioma robusto no resolvedor de desconto por quantidade.
CREATE OR REPLACE FUNCTION public._resolve_desconto(_produto_id uuid, _tpid uuid, _qtd integer, _ref numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record;
BEGIN
  SELECT d.* INTO _b FROM public.produto_descontos d
  WHERE d.produto_id = _produto_id AND d.quantidade_minima <= _qtd
    AND (d.data_inicio IS NULL OR d.data_inicio <= now())
    AND (d.data_fim    IS NULL OR d.data_fim    >= now())
    AND (d.tabela_preco_id IS NULL OR d.tabela_preco_id = _tpid)
  ORDER BY (d.tabela_preco_id IS NOT NULL AND d.tabela_preco_id = _tpid) DESC, d.quantidade_minima DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _b.preco_final IS NOT NULL AND _b.preco_final > 0 THEN RETURN _b.preco_final; END IF;
  IF _b.percentual  IS NOT NULL AND _b.percentual  > 0 THEN RETURN round(_ref * (1 - _b.percentual/100.0), 2); END IF;
  RETURN NULL;
END; $$;

-- E) REPARO ÚNICO: zera a inflação histórica do reservado. Deixa só a reserva de
--    pedidos do APP ainda ativos (≈0 hoje). O sync de produtos volta a trazer o
--    quantity_reserved do B2BWave (após o fix do índice b2bwave-sync).
UPDATE public.produtos SET estoque_reservado = COALESCE((
  SELECT sum(pi.quantidade) FROM public.pedido_itens pi
  JOIN public.pedidos p ON p.id = pi.pedido_id
  WHERE pi.produto_id = produtos.id AND p.b2bwave_order_id IS NULL
    AND p.status::text NOT IN ('cancelado','cancelled','concluido','complete')
), 0);
