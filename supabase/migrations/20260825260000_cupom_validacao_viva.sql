-- ============================================================================
-- CUPOM: a validacao estava morta em 100% dos pedidos
--
-- `fn_pedido_total_appside` so confere elegibilidade (ativo / datas / uso) no
-- ramo `TG_OP = 'INSERT'`. O ramo de UPDATE reaplica o cupom sem conferir NADA
-- — o comentario original justifica assim: "no UPDATE o cupom JA foi consumido
-- por este pedido". A premissa e falsa.
--
-- O QUE ACONTECE DE VERDADE, em todo pedido do portal:
--
--   1. INSERT do pedido com `coupon_id` de um cupom EXPIRADO.
--      A elegibilidade roda, nao casa, `_d` fica NULL -> `desconto = 0`.
--      Parece que a trava funcionou. Mas `coupon_id` CONTINUA gravado.
--   2. INSERT dos itens dispara `fn_pedido_recompute_subtotal` (AFTER INSERT em
--      `pedido_itens`), que faz `UPDATE pedidos SET subtotal = ...`.
--   3. Esse UPDATE dispara `fn_pedido_total_appside` de novo, agora no ramo
--      ELSE — que le o cupom SEM elegibilidade e grava o desconto cheio.
--   4. `NEW.total` e recalculado com esse desconto. E o total e o valor cobrado.
--
-- Ou seja: cupom expirado, desativado ou de uso unico esgotado gera desconto no
-- valor final. A conferencia do passo 1 e decorativa, porque o passo 3 sempre
-- acontece — todo pedido tem item.
--
-- CONSERTO (uma linha): se o cupom for reprovado no INSERT, ZERA `coupon_id`.
-- O ramo de UPDATE deixa de ter o que reaplicar, e o cupom legitimamente
-- aplicado continua valendo nos UPDATEs seguintes (o admin editar um pedido
-- antigo nao pode revogar o desconto que o cliente ja ganhou).
--
-- Esta migration REESCREVE a funcao inteira, extraida de
-- 20260803130000_frete_autoritativo_por_condicao.sql. Fora o bloco do cupom,
-- e byte a byte a mesma — frete por condicao/zona e imposto inalterados.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — pedidos que ganharam desconto de cupom hoje
-- INELEGIVEL. Rode ANTES e guarde: e a conta do prejuizo ate agora.
--
--   SELECT p.id, p.numero, p.total, p.desconto, cp.codigo,
--          cp.ativo, cp.data_fim, cp.uso_atual, cp.uso_maximo, p.created_at
--   FROM public.pedidos p
--   JOIN public.coupons cp ON cp.id = p.coupon_id
--   WHERE COALESCE(p.desconto,0) > 0
--     AND (cp.ativo IS NOT TRUE
--          OR (cp.data_fim IS NOT NULL AND cp.data_fim < p.created_at)
--          OR (cp.data_inicio IS NOT NULL AND cp.data_inicio > p.created_at)
--          OR (cp.uso_maximo IS NOT NULL AND COALESCE(cp.uso_atual,0) > cp.uso_maximo))
--   ORDER BY p.created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

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

        -- >>> A CORRECAO <<<
        -- Cupom REPROVADO nao pode continuar pendurado no pedido. Antes ele
        -- ficava: o INSERT dava `desconto = 0` (parecia certo), mas o cupom
        -- inelegivel seguia gravado em `coupon_id` — e o ramo de UPDATE abaixo
        -- o reaplica SEM conferir nada.
        --
        -- `_d IS NULL` acontece SO quando o WHERE nao casou (cupom inexistente,
        -- inativo, fora da validade ou esgotado). Cupom valido em pedido de
        -- subtotal zero devolve 0, nao NULL, entao nao e derrubado aqui.
        IF _d IS NULL THEN
          NEW.coupon_id := NULL;
        END IF;
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

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NAO CONSERTA (e por que nao, agora)
--
-- `uso_maximo` continua sendo um limite HONESTO, nao imposto. Quem consome o
-- cupom e `increment_coupon_usage`, chamada pelo NAVEGADOR
-- (`src/pages/portal/Checkout.tsx`, helper `bumpCouponUsage`). Um cliente que simplesmente
-- nao faca essa chamada nunca incrementa `uso_atual`, e reusa um cupom de uso
-- unico quantas vezes quiser.
--
-- NAO movi o incremento para dentro deste gatilho DE PROPOSITO: a chamada esta
-- no fim do fluxo por decisao anterior e deliberada — antes ela rodava no
-- submit, e cartao recusado queimava o cupom sem venda nenhuma (o comentario
-- que precede `bumpCouponUsage` registra isso). Trazer para o INSERT reintroduziria
-- aquele bug.
--
-- O conserto certo e um consumo idempotente por pedido (marcar no proprio
-- pedido que o cupom ja foi contado), e e mudanca maior que esta. Fica na fila
-- COMO ITEM PROPRIO — o preco, que e o dinheiro de verdade, esta correto a
-- partir daqui.
--
-- SEGUNDO CAMINHO QUE FICA ABERTO: o ramo de UPDATE continua sem validar. Quem
-- TEM policy de UPDATE em `pedidos` — `warehouse`, `manager`, `admin` — grava
-- `coupon_id` de cupom expirado num pedido existente e o desconto entra cheio.
-- E risco INTERNO (exige papel de staff), diferente do risco do cliente que
-- esta fechado aqui. Anotado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK — reinstala a versao anterior da funcao rodando o arquivo
-- 20260803130000_frete_autoritativo_por_condicao.sql inteiro de novo.
-- Reverter reabre o desconto por cupom expirado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao tem a correcao:
--   SELECT prosrc LIKE '%NEW.coupon_id := NULL%' AS tem_correcao
--   FROM pg_proc WHERE proname = 'fn_pedido_total_appside';
--   -- esperado: true
--
-- 2) Teste vivo: desative um cupom (`UPDATE coupons SET ativo = false ...`),
--    aplique-o num pedido pelo portal e confira que o pedido nasce com
--    `desconto = 0` E `coupon_id IS NULL`.
--
-- 3) Controle — o caminho BOM tem que continuar funcionando: cupom ativo e
--    dentro da validade tem de gerar desconto normalmente e sobreviver ao
--    recalculo do subtotal.
-- ---------------------------------------------------------------------------
