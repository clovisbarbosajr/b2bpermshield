-- ============================================================================
-- RAISE COM MESSAGE VALIDO (estoque e pedido minimo)
--
-- POR QUE. `RAISE EXCEPTION 'LITERAL' USING ERRCODE = ..., MESSAGE = '...'` e
-- INVALIDO em execucao: o Postgres levanta 42601 "RAISE option already
-- specified: MESSAGE" (a doc: MESSAGE nao pode ser usado na forma com literal).
-- O INSERT continua recusado, mas o cliente ve o texto cru, e o Checkout — que
-- procura o CODIGO em `error.message` — nao traduz. Aqui fica a forma valida
-- `RAISE EXCEPTION USING ERRCODE = ..., MESSAGE = 'CODIGO: texto'`.
--
-- Corpo, assinatura e atributos IDENTICOS as ultimas definicoes
-- (20260825320000_estoque_por_variante.sql e
-- 20260825390000_pedido_minimo_no_servidor.sql); so os RAISE mudam. Gatilhos
-- NAO sao recriados: `CREATE OR REPLACE` mantem os existentes apontando para ca.
--
-- ORDEM: pode rodar antes do publish — so corrige mensagens.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

BEGIN;

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
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'INSUFFICIENT_STOCK: Insufficient stock for product ' || NEW.produto_id;
    END IF;

    -- >>> NOVO: a VARIANTE tambem tem que ter saldo. <<<
    --
    -- Mesmo UPDATE condicional do pai: e a condicao dentro do proprio UPDATE que
    -- resolve a corrida — dois pedidos simultaneos do ultimo M, so um consegue a
    -- linha. Um `SELECT` antes seguido de `UPDATE` NAO resolveria.
    IF NEW.variante_id IS NOT NULL THEN
      UPDATE produto_variantes
         SET estoque_reservado = estoque_reservado + NEW.quantidade
       WHERE id = NEW.variante_id
         AND (COALESCE(quantidade, 0) - estoque_reservado) >= NEW.quantidade;
      GET DIAGNOSTICS _updated = ROW_COUNT;
      IF _updated = 0 THEN
        -- Mesmo token do pai: o Checkout ja traduz `INSUFFICIENT_STOCK` para
        -- "um item acabou de esgotar". Mensagem distinta so no texto, para o log.
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
                MESSAGE = 'INSUFFICIENT_STOCK: Insufficient stock for variant ' || NEW.variante_id;
      END IF;
    END IF;
  ELSE
    UPDATE produtos SET estoque_reservado = estoque_reservado + NEW.quantidade WHERE id = NEW.produto_id;
    -- Sem exigencia de saldo (admin, backorder, pre-venda): reserva mesmo assim,
    -- para a conta da variante nao ficar defasada da do pai.
    IF NEW.variante_id IS NOT NULL THEN
      UPDATE produto_variantes SET estoque_reservado = estoque_reservado + NEW.quantidade
      WHERE id = NEW.variante_id;
    END IF;
  END IF;

  -- `estoque_log` continua por PRODUTO. Nao gero linha por variante de proposito:
  -- os relatorios somam essa tabela, e uma linha por variante MAIS a do pai
  -- contaria o mesmo movimento duas vezes.
  INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
  SELECT NEW.produto_id,
    p.estoque_total - (p.estoque_reservado - NEW.quantidade),
    p.estoque_total - p.estoque_reservado,
    'Order item reserved (order ' || NEW.pedido_id || ')'
  FROM produtos p WHERE p.id = NEW.produto_id;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_pedido_minimo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r   record;
BEGIN
  -- Sync e qualquer conexao sem sessao (service key nao carrega `sub`).
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Staff nao e barrado. `SECURITY DEFINER` ignora RLS, entao a checagem de
  -- papel precisa estar AQUI dentro — nao ha politica que a faca por mim.
  IF public.has_role(_uid, 'admin')
     OR public.has_role(_uid, 'manager')
     OR public.has_role(_uid, 'warehouse') THEN
    RETURN NULL;
  END IF;

  FOR _r IN
    SELECT p.id,
           c.minimum_order_value AS minimo,
           -- Soma direto dos ITENS, e nao `p.subtotal`. O `trg_pedido_recompute_subtotal`
           -- ja corrige `p.subtotal` a partir dos itens, mas ele e FOR EACH ROW:
           -- depender da ordem entre gatilhos de nivel diferente e apostar numa
           -- garantia que eu nao preciso. Somar aqui e independente disso.
           (SELECT COALESCE(sum(i.subtotal), 0)
              FROM public.pedido_itens i WHERE i.pedido_id = p.id) AS valor
      FROM (SELECT DISTINCT pedido_id FROM novos) n
      JOIN public.pedidos  p ON p.id = n.pedido_id
      JOIN public.clientes c ON c.id = p.cliente_id
     WHERE p.b2bwave_order_id IS NULL
       AND COALESCE(c.minimum_order_value, 0) > 0
  LOOP
    IF _r.valor < _r.minimo THEN
      -- Token reconhecivel; a tela traduz. Sem isto o cliente veria texto cru
      -- do Postgres — regra da casa: erro de programador nao chega na tela.
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
              MESSAGE = format(
                'ORDER_BELOW_MINIMUM: order value %s is below the minimum %s for this account',
                round(_r.valor, 2), round(_r.minimo, 2));
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Reaplicar as definicoes de `fn_reserve_stock_on_order_item` em
-- 20260825320000_estoque_por_variante.sql e de `fn_pedido_minimo` em
-- 20260825390000_pedido_minimo_no_servidor.sql (so o CREATE OR REPLACE).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO — depois de aplicar ESTA e a 20260916150000, tem que dar 0 linhas:
--
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('fn_reserve_stock_on_order_item','fn_pedido_minimo','fn_pedido_opcoes_validas')
--      AND prosrc ~ 'RAISE\s+EXCEPTION\s+''[^'']*''[^;]*USING[^;]*MESSAGE';
-- ---------------------------------------------------------------------------
