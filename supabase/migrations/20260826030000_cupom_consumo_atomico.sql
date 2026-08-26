-- ============================================================================
-- CUPOM DE USO UNICO DEIXA DE SER ILIMITADO EM CORRIDA
--
-- Achado do cetico de preco (26/ago). O caminho era este:
--
--   1. `fn_pedido_total_appside` (BEFORE INSERT) so CONFERIA a elegibilidade,
--      com um SELECT sem trava.
--   2. Quem incrementava `uso_atual` era `fn_cupom_consome` (AFTER INSERT,
--      20260825380000) — e o proprio arquivo dizia que, se o incremento
--      falhasse, o pedido NAO seria derrubado.
--
-- Entre o SELECT de uma transacao e o UPDATE de outra cabe o mundo inteiro:
-- N pedidos em PARALELO com o mesmo cupom de uso unico liam todos
-- `uso_atual = 0`, todos ganhavam desconto cheio, e so um incrementava.
--
-- Nao e teoria de laboratorio: e um `for` disparando POSTs, e o dinheiro sai.
--
-- O CONSERTO: consumir no MESMO comando que confere, com
-- `UPDATE ... WHERE uso_atual < uso_maximo`. O UPDATE trava a linha; a segunda
-- transacao espera, re-avalia o WHERE ja com o valor novo, e nao casa. E a
-- mesma forma que a reserva de estoque usa (20260825320000).
--
-- DEPENDE de `pedidos.cupom_consumido`, criada em 20260825380000. Se aquela
-- migration nao tiver rodado, esta falha no `NEW.cupom_consumido`.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Cupom cujo limite JA foi estourado. Se vier linha, o furo foi usado (ou o
-- limite foi reduzido depois) — vale olhar os pedidos daquele cupom.
--
--   SELECT cp.codigo, cp.uso_maximo, cp.uso_atual,
--          count(p.id) FILTER (WHERE p.status::text NOT IN ('cancelado','cancelled')) AS pedidos_vivos
--     FROM public.coupons cp
--     LEFT JOIN public.pedidos p ON p.coupon_id = cp.id
--    WHERE cp.uso_maximo IS NOT NULL
--    GROUP BY cp.id, cp.codigo, cp.uso_maximo, cp.uso_atual
--   HAVING count(p.id) FILTER (WHERE p.status::text NOT IN ('cancelado','cancelled')) > cp.uso_maximo
--    ORDER BY cp.codigo;
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
        -- CONSUMO ATOMICO. Antes eram duas etapas: este SELECT so CONFERIA a
        -- elegibilidade, e quem incrementava era `fn_cupom_consome` (AFTER
        -- INSERT, 20260825380000) — que, se falhasse, NAO derrubava o pedido.
        --
        -- Entre o SELECT de uma transacao e o UPDATE de outra cabe o mundo
        -- inteiro: N pedidos disparados em paralelo com o mesmo cupom de uso
        -- unico liam todos `uso_atual = 0`, todos ganhavam o desconto cheio, e
        -- so um incrementava. Cupom de uso unico virava ilimitado, e o dinheiro
        -- saia de verdade.
        --
        -- `UPDATE ... WHERE uso_atual < uso_maximo` resolve porque o UPDATE
        -- TRAVA a linha: a segunda transacao espera, re-avalia o WHERE com o
        -- valor ja incrementado, e nao casa. Mesma forma da reserva de estoque
        -- (20260825320000).
        UPDATE public.coupons cp
           SET uso_atual = COALESCE(cp.uso_atual, 0) + 1
         WHERE cp.id = NEW.coupon_id AND cp.ativo IS TRUE
           AND (cp.data_inicio IS NULL OR cp.data_inicio <= now())
           AND (cp.data_fim    IS NULL OR cp.data_fim    >= now())
           AND (cp.uso_maximo  IS NULL OR COALESCE(cp.uso_atual,0) < cp.uso_maximo)
        RETURNING CASE WHEN cp.tipo = 'percentual'
                       THEN round(COALESCE(NEW.subtotal,0) * cp.valor/100.0, 2)
                       ELSE LEAST(cp.valor, COALESCE(NEW.subtotal,0)) END
          INTO _d;

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
        ELSE
          -- Consumido AQUI, dentro da mesma transacao do INSERT: se o pedido
          -- nao entrar, o incremento volta junto. Marcar `cupom_consumido` faz
          -- `fn_cupom_consome` sair na primeira linha (ele testa exatamente
          -- isto) e NAO contar de novo. A devolucao no cancelamento e no delete
          -- continua funcionando — ela tambem se guia por esta marca.
          NEW.cupom_consumido := true;
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
-- O QUE ISTO NAO FAZ
--
-- NAO mexe em `fn_cupom_consome` (20260825380000). Ela continua existindo e
-- passa a sair na primeira linha, porque `cupom_consumido` ja vem `true` do
-- BEFORE. Deixei de proposito: apagar a funcao quebraria a devolucao no
-- cancelamento, que e outra coisa e esta certa.
--
-- NAO limita cupom por CLIENTE — `coupons` nao tem esse conceito. Limite e
-- global, como sempre foi.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Cole de volta o corpo de `fn_pedido_total_appside` de
-- 20260825260000_cupom_validacao_viva.sql (a versao com o SELECT de conferencia
-- no ramo do INSERT).
--
-- Reverter devolve o cupom de uso unico a condicao de ilimitado sob corrida.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O consumo agora e UPDATE, nao SELECT:
--   SELECT count(*) AS deve_ser_1
--     FROM regexp_split_to_table(pg_get_functiondef(
--            'public.fn_pedido_total_appside()'::regprocedure), E'\n') l
--    WHERE l ~ 'UPDATE public\.coupons';
--
-- 2) CONTROLE — dois testes, e o segundo e o que importa:
--    a) crie um cupom `uso_maximo = 1`, feche UM pedido com ele pelo portal:
--       tem que aplicar o desconto e `uso_atual` virar 1.
--    b) feche um SEGUNDO pedido com o mesmo cupom: o pedido tem que entrar
--       SEM desconto e com `coupon_id` NULO.
--       Sem o teste (a), uma funcao que recusa TODO cupom passaria por
--       "consertada" e voce perderia a promocao inteira sem perceber.
--
-- 3) Cancele o pedido do teste (a) e confira que `uso_atual` VOLTOU para 0 —
--    a devolucao de 20260825380000 continua funcionando.
-- ---------------------------------------------------------------------------
