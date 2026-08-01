-- ============================================================================
-- OS 3 CRÍTICOS DE TRIGGER (pendentes desde a varredura de 26/jul).
-- Todos são bugs de banco: não adianta publish, precisa rodar este SQL.
--
--  1) fn_adjust_stock_on_order_status — `UPDATE produtos p ... FROM pedido_itens pi`
--     aplica APENAS UMA linha por alvo quando o mesmo produto aparece 2x no pedido.
--     Como variante NÃO tem coluna própria em pedido_itens, duas variantes viram
--     duas linhas com o MESMO produto_id → é o caso comum, não a exceção.
--     Efeito: pedido cancelado/concluído devolve/baixa só uma das linhas → o
--     estoque_reservado fica preso pra sempre e some do disponível.
--
--  2) fn_pedido_total_appside — revalida o CUPOM em TODO UPDATE de `pedidos`,
--     inclusive na condição `uso_atual < uso_maximo`. Só que o checkout incrementa
--     `uso_atual` DEPOIS de criar o pedido. Num cupom de uso único, a primeira
--     mudança de status (ex.: "processing") não acha mais o cupom → `desconto := 0`
--     → o TOTAL DO CLIENTE SOBE sozinho, depois de ele já ter pago.
--
--  3) fn_lock_privileged_cliente_cols — trava tabela_preco_id, parent_customer_id
--     etc., mas NÃO trava `tax_customer_group_id`. O cliente edita a própria linha
--     em "My Account" e zera o próprio imposto (o trigger de total usa essa coluna).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Estoque: agregar por produto ANTES do UPDATE.
--    A soma (SUM(quantidade) GROUP BY produto_id) faz o produto repetido virar
--    uma linha só, então o `UPDATE ... FROM` volta a ser correto.
-- ----------------------------------------------------------------------------
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

  -- CANCELADO: devolve o reservado.
  IF _new_cancel AND NOT _old_cancel THEN
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

-- ----------------------------------------------------------------------------
-- 2) Cupom: só valida ELEGIBILIDADE (ativo/datas/uso) no INSERT. No UPDATE o
--    pedido já existe e o cupom já foi consumido por ele — recalcular o valor
--    é certo (o subtotal pode ter mudado num ajuste de preço do admin), mas
--    re-checar a elegibilidade é errado e zerava o desconto do cliente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pedido_total_appside()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d numeric; _preco numeric; _gratis numeric; _ncond int;
  _grp uuid; _taxclass uuid; _rate numeric;
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    -- 1) desconto do cupom
    IF NEW.coupon_id IS NULL THEN
      NEW.desconto := 0;
    ELSE
      SELECT CASE WHEN cp.tipo = 'percentual'
                  THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                  ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
        INTO _d FROM public.coupons cp
        WHERE cp.id = NEW.coupon_id
          -- Elegibilidade SÓ no INSERT. No UPDATE o cupom já foi aplicado a este
          -- pedido: o checkout incrementa `uso_atual` DEPOIS do insert, então um
          -- cupom de uso único falhava aqui na 1ª mudança de status e o desconto
          -- do cliente virava 0 (o total subia sozinho depois do pagamento).
          AND (TG_OP <> 'INSERT' OR (
                cp.ativo IS TRUE
            AND (cp.data_inicio IS NULL OR cp.data_inicio <= now())
            AND (cp.data_fim    IS NULL OR cp.data_fim    >= now())
            AND (cp.uso_maximo  IS NULL OR COALESCE(cp.uso_atual,0) < cp.uso_maximo)
          ));
      -- Cupom inexistente no INSERT (ou inelegível) → sem desconto, como antes.
      NEW.desconto := LEAST(GREATEST(COALESCE(_d,0),0), COALESCE(NEW.subtotal,0));
    END IF;

    -- 2) FRETE autoritativo (modelo simples). Opção com condicoes -> mantém cliente clampado.
    IF NEW.shipping_option_id IS NULL THEN
      NEW.shipping_costs := 0;
    ELSE
      SELECT so.preco, so.gratis_acima_de, COALESCE(jsonb_array_length(so.condicoes), 0)
        INTO _preco, _gratis, _ncond
      FROM public.shipping_options so WHERE so.id = NEW.shipping_option_id;
      IF COALESCE(_ncond,0) = 0 THEN
        NEW.shipping_costs := CASE
          WHEN _gratis IS NOT NULL AND COALESCE(NEW.subtotal,0) >= _gratis THEN 0
          ELSE GREATEST(COALESCE(_preco,0), 0) END;
      ELSE
        NEW.shipping_costs := GREATEST(COALESCE(NEW.shipping_costs,0), 0);
      END IF;
    END IF;

    -- 3) IMPOSTO autoritativo: taxa do grupo do cliente sobre (subtotal - desconto).
    SELECT COALESCE(c.tax_customer_group_id, (SELECT id FROM public.tax_customer_groups WHERE is_default LIMIT 1))
      INTO _grp FROM public.clientes c WHERE c.id = NEW.cliente_id;
    SELECT id INTO _taxclass FROM public.tax_classes WHERE is_default LIMIT 1;
    _rate := 0;
    IF _grp IS NOT NULL AND _taxclass IS NOT NULL THEN
      SELECT tr.percentual INTO _rate
      FROM public.tax_rules ru JOIN public.tax_rates tr ON tr.id = ru.tax_rate_id
      WHERE ru.tax_customer_group_id = _grp AND ru.tax_class_id = _taxclass LIMIT 1;
    END IF;
    NEW.sales_tax := round(GREATEST(COALESCE(NEW.subtotal,0) - NEW.desconto, 0) * COALESCE(_rate,0)/100.0, 2);

    -- 4) total
    NEW.total := GREATEST(0, COALESCE(NEW.subtotal,0) - NEW.desconto + NEW.sales_tax + NEW.shipping_costs);
  END IF;
  RETURN NEW;
END; $$;

-- ----------------------------------------------------------------------------
-- 3) Travar tax_customer_group_id junto das outras colunas privilegiadas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lock_privileged_cliente_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
    NEW.user_id               := OLD.user_id;
    NEW.tabela_preco_id       := OLD.tabela_preco_id;
    NEW.representante_id      := OLD.representante_id;
    NEW.parent_customer_id    := OLD.parent_customer_id;
    NEW.can_confirm_order     := OLD.can_confirm_order;
    NEW.can_view_full_history := OLD.can_view_full_history;
    NEW.status                := OLD.status;
    NEW.is_active             := OLD.is_active;
    NEW.disable_ordering      := OLD.disable_ordering;
    -- Faltava: sem isto o cliente zerava o próprio imposto (o trigger de total
    -- de `pedidos` resolve a alíquota por esta coluna).
    NEW.tax_customer_group_id := OLD.tax_customer_group_id;
  END IF;
  RETURN NEW;
END; $$;
