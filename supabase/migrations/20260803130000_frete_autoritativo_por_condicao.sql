-- ============================================================================
-- FRETE AUTORITATIVO — o banco passa a CALCULAR o frete por condição/zona, em
-- vez de aceitar o número que o navegador mandou.
--
-- Como estava: `fn_pedido_total_appside` só calculava o frete quando a opção
-- NÃO tinha condições (`jsonb_array_length(condicoes) = 0`). Se tivesse, caía em
--     NEW.shipping_costs := GREATEST(COALESCE(NEW.shipping_costs,0), 0);
-- ou seja, aceitava o valor do cliente, só impedindo negativo.
--
-- E toda opção criada pela tela do admin TEM condições: o formulário começa com
-- uma linha (`defaultCondition()` em ShippingOptions.tsx:34) e o botão de remover
-- só habilita com mais de uma (`:287`). Resultado: o ramo autoritativo era
-- INALCANÇÁVEL na prática — 100% do frete vinha do navegador, e a única defesa
-- era o `GREATEST(...,0)`.
--
-- Esta migration porta pro SQL a MESMA regra que o checkout aplica
-- (`Checkout.tsx`, efeito do `shippingCost`), pra que os dois cheguem ao mesmo
-- número e o banco tenha a palavra final:
--
--   1) filtra as condições onde:
--        país      = país do cliente (condição sem país casa com qualquer um)
--        província = "All", vazia, ou igual ao estado do cliente
--        from_net_value <= subtotal
--   2) entre as que casam, pega a de MAIOR `from_net_value` (regra mais específica)
--   3) custo = price + subtotal * percentage_upcharge / 100
--   4) nenhuma condição casa  -> cai no `preco` da opção (mesmo fallback do app)
--   5) opção sem condição     -> modelo simples (grátis acima de X, senão `preco`)
--
-- O ESTADO sai só do endereço de entrega (igual ao app). O PAÍS sai de
-- `clientes.pais`; vazio assume 'United States', default do sistema pra cliente
-- novo — mesma suposição do app.
--
-- IMPORTANTE 1: no INSERT, `NEW.shipping_costs` deixa de ser lido. Um pedido
-- forjado com frete 0 é recalculado e cobrado certo.
--
-- IMPORTANTE 2: no UPDATE, o frete só é recalculado se a OPÇÃO, o SUBTOTAL ou o
-- ENDEREÇO mudaram. Recalcular sempre re-precificaria pedido já pago (bastaria o
-- admin editar a opção de frete depois) e apagaria o frete digitado à mão no
-- admin. Ver a guarda no corpo da função.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pedido_total_appside()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d numeric; _preco numeric; _gratis numeric; _ncond int; _cond jsonb;
  _grp uuid; _taxclass uuid; _rate numeric;
  _pais text; _estado text; _best jsonb;
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    -- 1) desconto do cupom
    IF NEW.coupon_id IS NULL THEN
      NEW.desconto := 0;
    ELSE
      IF TG_OP = 'INSERT' THEN
        -- No INSERT valida ELEGIBILIDADE (ativo/datas/uso).
        SELECT CASE WHEN cp.tipo = 'percentual'
                    THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                    ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
          INTO _d FROM public.coupons cp
          WHERE cp.id = NEW.coupon_id AND cp.ativo IS TRUE
            AND (cp.data_inicio IS NULL OR cp.data_inicio <= now())
            AND (cp.data_fim    IS NULL OR cp.data_fim    >= now())
            AND (cp.uso_maximo  IS NULL OR COALESCE(cp.uso_atual,0) < cp.uso_maximo);
      ELSE
        -- No UPDATE o cupom JÁ foi consumido por este pedido: só recalcula o
        -- valor (o subtotal pode ter mudado num ajuste de preço do admin).
        SELECT CASE WHEN cp.tipo = 'percentual'
                    THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                    ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
          INTO _d FROM public.coupons cp WHERE cp.id = NEW.coupon_id;
      END IF;
      NEW.desconto := LEAST(GREATEST(COALESCE(_d,0),0), COALESCE(NEW.subtotal,0));
    END IF;

    -- 2) FRETE autoritativo, INCLUSIVE por condição/zona.
    --
    -- SÓ recalcula quando algo que AFETA o frete mudou (opção, subtotal ou
    -- endereço) — ou no INSERT. Sem esta guarda, o frete seria recomputado em
    -- QUALQUER update de `pedidos` (status, tracking, is_paid): um pedido JÁ PAGO
    -- mudaria de total sozinho se o admin editasse a opção de frete depois, e o
    -- frete digitado à mão no admin (OrderDetail) seria sobrescrito no próprio
    -- save. É a mesma classe de bug que a 20260801130000 corrigiu no cupom.
    IF TG_OP = 'UPDATE'
       AND NEW.shipping_option_id IS NOT DISTINCT FROM OLD.shipping_option_id
       AND NEW.subtotal            IS NOT DISTINCT FROM OLD.subtotal
       AND NEW.endereco_entrega_id IS NOT DISTINCT FROM OLD.endereco_entrega_id THEN
      -- Mantém o que veio (valor atual, ou o override manual do admin).
      NEW.shipping_costs := GREATEST(COALESCE(NEW.shipping_costs, 0), 0);
    ELSIF NEW.shipping_option_id IS NULL THEN
      NEW.shipping_costs := 0;
    ELSE
      SELECT so.preco, so.gratis_acima_de, COALESCE(jsonb_array_length(so.condicoes), 0), so.condicoes
        INTO _preco, _gratis, _ncond, _cond
      FROM public.shipping_options so WHERE so.id = NEW.shipping_option_id;

      IF COALESCE(_ncond,0) = 0 THEN
        -- Modelo simples: grátis acima do limiar, senão o preço da opção.
        NEW.shipping_costs := CASE
          WHEN _gratis IS NOT NULL AND COALESCE(NEW.subtotal,0) >= _gratis THEN 0
          ELSE GREATEST(COALESCE(_preco,0), 0) END;
      ELSE
        -- Estado SÓ do endereço de entrega — igual ao app, que usa apenas
        -- `selectedEndereco?.estado ?? ""` (Checkout.tsx). Com fallback pro
        -- cadastro do cliente, o banco casaria uma condição que a tela não casou
        -- e o cliente pagaria um frete diferente do exibido.
        SELECT COALESCE(NULLIF(btrim(e.estado), ''), '') INTO _estado
        FROM public.enderecos e WHERE e.id = NEW.endereco_entrega_id;
        _estado := COALESCE(_estado, '');

        SELECT COALESCE(NULLIF(btrim(c.pais), ''), 'United States') INTO _pais
        FROM public.clientes c WHERE c.id = NEW.cliente_id;

        -- Melhor condição que casa: maior `from_net_value` entre as elegíveis.
        -- `WITH ORDINALITY` + `ord ASC` no desempate: o app usa `Array.sort`, que é
        -- ESTÁVEL, então em empate de `from_net_value` ele fica com a PRIMEIRA
        -- condição do array. Sem isso, o banco escolhia arbitrariamente entre duas
        -- linhas empatadas (ex.: "All $20" e "Texas $10", ambas a partir de 0) e
        -- podia cobrar diferente do que a tela mostrou.
        SELECT t.cond INTO _best
        FROM jsonb_array_elements(_cond) WITH ORDINALITY AS t(cond, ord)
        WHERE (t.cond->>'country' IS NULL OR btrim(t.cond->>'country') = ''
               OR lower(btrim(t.cond->>'country')) = lower(_pais))
          AND (t.cond->>'province' IS NULL OR btrim(t.cond->>'province') = ''
               OR t.cond->>'province' = 'All'
               OR lower(btrim(t.cond->>'province')) = lower(COALESCE(_estado,'')))
          AND COALESCE((t.cond->>'from_net_value')::numeric, 0) <= COALESCE(NEW.subtotal,0)
        ORDER BY COALESCE((t.cond->>'from_net_value')::numeric, 0) DESC, t.ord ASC
        LIMIT 1;

        IF _best IS NULL THEN
          -- Nenhuma condição casa: mesmo fallback do app (preço da opção).
          NEW.shipping_costs := GREATEST(COALESCE(_preco,0), 0);
        ELSE
          -- `round(...,2)`: sem isso o `percentage_upcharge` gerava 3+ casas
          -- (a coluna é `numeric` sem escala) e o total ficava um centavo fora do
          -- que a tela mostrou. O imposto já arredondava; o frete não.
          NEW.shipping_costs := round(GREATEST(
            COALESCE((_best->>'price')::numeric, 0)
            + COALESCE(NEW.subtotal,0) * COALESCE((_best->>'percentage_upcharge')::numeric, 0) / 100.0,
          0), 2);
        END IF;
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
