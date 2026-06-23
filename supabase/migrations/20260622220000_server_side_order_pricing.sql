-- ============================================================================
-- PREÇO AUTORITATIVO no servidor (fecha o último buraco: o cliente mandava o
-- preco_unitario de cada item). Agora o banco RECOMPUTA, para pedidos do APP
-- (b2bwave_order_id NULL): preço por item (price list/cliente/desconto/base),
-- subtotal (= soma dos itens), desconto (do cupom) e total. Pedidos do sync
-- (b2bwave_order_id) ficam intactos. Espelha src/lib/pricing.ts.
-- ============================================================================

-- Desconto por quantidade (produto_descontos), específico da tabela ou global.
CREATE OR REPLACE FUNCTION public._resolve_desconto(_produto_id uuid, _tpid uuid, _qtd integer, _ref numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record;
BEGIN
  SELECT d.* INTO _b FROM public.produto_descontos d
  WHERE d.produto_id = _produto_id
    AND d.quantidade_minima <= _qtd
    AND (d.data_inicio IS NULL OR d.data_inicio <= now())
    AND (d.data_fim    IS NULL OR d.data_fim    >= now())
    AND (d.tabela_preco_id IS NULL OR d.tabela_preco_id = _tpid)
  ORDER BY (d.tabela_preco_id IS NOT NULL AND d.tabela_preco_id = _tpid) DESC,
           d.quantidade_minima DESC
  LIMIT 1;
  IF _b IS NULL THEN RETURN NULL; END IF;
  IF _b.preco_final IS NOT NULL AND _b.preco_final > 0 THEN RETURN _b.preco_final; END IF;
  IF _b.percentual  IS NOT NULL AND _b.percentual  > 0 THEN RETURN round(_ref * (1 - _b.percentual/100.0), 2); END IF;
  RETURN NULL;
END; $$;

-- Preço autoritativo de um produto para um cliente/quantidade (mesma ordem do lib).
CREATE OR REPLACE FUNCTION public.preco_autoritativo(_produto_id uuid, _cliente_id uuid, _qtd integer)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _base numeric; _tpid uuid; _cust numeric; _extras boolean; _pl numeric; _disc numeric;
BEGIN
  SELECT preco INTO _base FROM public.produtos WHERE id = _produto_id;
  IF _base IS NULL THEN RETURN 0; END IF;
  SELECT tabela_preco_id INTO _tpid FROM public.clientes WHERE id = _cliente_id;

  -- 1) preço específico do cliente (maior prioridade)
  SELECT preco, aplicar_descontos_extras INTO _cust, _extras
  FROM public.produto_precos_cliente WHERE produto_id = _produto_id AND cliente_id = _cliente_id;
  IF _cust IS NOT NULL THEN
    IF _extras IS TRUE THEN
      _disc := public._resolve_desconto(_produto_id, _tpid, _qtd, _cust);
      IF _disc IS NOT NULL THEN RETURN _disc; END IF;
    END IF;
    RETURN _cust;
  END IF;

  -- 2) tabela de preço do cliente
  IF _tpid IS NOT NULL THEN
    SELECT preco INTO _pl FROM public.tabela_preco_itens
    WHERE tabela_preco_id = _tpid AND produto_id = _produto_id;
    IF _pl IS NOT NULL THEN RETURN _pl; END IF;
  END IF;

  -- 3) descontos por quantidade
  _disc := public._resolve_desconto(_produto_id, _tpid, _qtd, _base);
  IF _disc IS NOT NULL THEN RETURN _disc; END IF;

  -- 4) base
  RETURN _base;
END; $$;

-- BEFORE INSERT no item: recomputa preco_unitario + subtotal (só pedidos do app).
CREATE OR REPLACE FUNCTION public.fn_pedido_item_preco_autoritativo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cli uuid; _b2b integer; _p numeric;
BEGIN
  SELECT cliente_id, b2bwave_order_id INTO _cli, _b2b FROM public.pedidos WHERE id = NEW.pedido_id;
  IF _b2b IS NULL AND _cli IS NOT NULL AND NEW.produto_id IS NOT NULL THEN
    _p := public.preco_autoritativo(NEW.produto_id, _cli, GREATEST(COALESCE(NEW.quantidade,1),1));
    NEW.preco_unitario := _p;
    NEW.subtotal := round(_p * COALESCE(NEW.quantidade,1), 2);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_pedido_item_preco ON public.pedido_itens;
CREATE TRIGGER trg_pedido_item_preco BEFORE INSERT ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_item_preco_autoritativo();

-- AFTER INSERT no item: recomputa o subtotal do pedido a partir dos itens reais
-- (só pedidos do app). Dispara o trigger de total (recomputa total/desconto).
CREATE OR REPLACE FUNCTION public.fn_pedido_recompute_subtotal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b2b integer; _sub numeric;
BEGIN
  SELECT b2bwave_order_id INTO _b2b FROM public.pedidos WHERE id = NEW.pedido_id;
  IF _b2b IS NULL THEN
    SELECT COALESCE(sum(subtotal),0) INTO _sub FROM public.pedido_itens WHERE pedido_id = NEW.pedido_id;
    UPDATE public.pedidos SET subtotal = _sub WHERE id = NEW.pedido_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_pedido_recompute_subtotal ON public.pedido_itens;
CREATE TRIGGER trg_pedido_recompute_subtotal AFTER INSERT ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_recompute_subtotal();

-- Total autoritativo (substitui a versão anterior): para pedidos do app recomputa
-- desconto a partir do CUPOM (0 se não houver), clampa imposto/frete >= 0, e
-- total = subtotal - desconto + imposto + frete. Sync intocado.
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
        INTO _d FROM public.coupons cp WHERE cp.id = NEW.coupon_id;
      NEW.desconto := LEAST(GREATEST(COALESCE(_d,0),0), COALESCE(NEW.subtotal,0));
    END IF;
    NEW.sales_tax := GREATEST(COALESCE(NEW.sales_tax,0), 0);
    NEW.shipping_costs := GREATEST(COALESCE(NEW.shipping_costs,0), 0);
    NEW.total := GREATEST(0, COALESCE(NEW.subtotal,0) - NEW.desconto + NEW.sales_tax + NEW.shipping_costs);
  END IF;
  RETURN NEW;
END; $$;
