-- ============================================================================
-- FRETE + IMPOSTO autoritativos no total (pedido do app). Antes vinham do cliente
-- e só eram clampados >= 0 -> um cliente pagando com cartão (Stripe) podia zerar
-- frete/imposto e ser cobrado a menos. Agora o banco recomputa:
--   - imposto: taxa do grupo do cliente (ou grupo default) sobre (subtotal - desconto).
--   - frete:   modelo simples (grátis acima do limiar / preço base). Para opções com
--              `condicoes` (regras por zona, jsonb), não dá pra portar a lógica com
--              segurança aqui -> mantém o valor do cliente clampado >= 0 (residual:
--              fechar via RPC de criação de pedido antes de reativar o Stripe).
-- Pedido do sync (b2bwave_order_id) intocado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pedido_total_appside()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d numeric; _preco numeric; _gratis numeric; _ncond int;
  _grp uuid; _taxclass uuid; _rate numeric;
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    -- 1) desconto do cupom (validado: ativo/datas/uso)
    IF NEW.coupon_id IS NULL THEN
      NEW.desconto := 0;
    ELSE
      SELECT CASE WHEN cp.tipo = 'percentual'
                  THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                  ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
        INTO _d FROM public.coupons cp
        WHERE cp.id = NEW.coupon_id AND cp.ativo IS TRUE
          AND (cp.data_inicio IS NULL OR cp.data_inicio <= now())
          AND (cp.data_fim    IS NULL OR cp.data_fim    >= now())
          AND (cp.uso_maximo  IS NULL OR COALESCE(cp.uso_atual,0) < cp.uso_maximo);
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
