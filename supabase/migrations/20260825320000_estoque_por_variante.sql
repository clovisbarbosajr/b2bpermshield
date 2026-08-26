-- ============================================================================
-- ESTOQUE DE VARIANTE PASSA A DAR BAIXA (C6)
--
-- Hoje NENHUMA linha do sistema escreve `produto_variantes.quantidade` a partir
-- de uma venda. Varri as migrations: a coluna so aparece no CREATE TABLE, em
-- policy e num indice. Os unicos escritores sao a digitacao do admin, o feed do
-- B2BWave e o importador de variantes.
--
-- E a reserva atomica (`fn_reserve_stock_on_order_item`) olha SO o produto-pai:
--
--   UPDATE produtos SET estoque_reservado = estoque_reservado + NEW.quantidade
--   WHERE id = NEW.produto_id
--     AND (estoque_total - estoque_reservado) >= NEW.quantidade;
--
-- `NEW.variante_id` nunca e lido. Nenhuma linha de `produto_variantes` e travada
-- nem decrementada.
--
-- CONSEQUENCIA: dois clientes comprando o ULTIMO tamanho M ao mesmo tempo passam
-- os DOIS. Nem precisa de concorrencia — como `quantidade` nunca decrementa, da
-- para vender o M indefinidamente enquanto o PAI tiver estoque agregado (2 M +
-- 8 G = 10 no pai; dez vendas de M passam).
--
-- A unica checagem por variante que existe hoje e no NAVEGADOR
-- (`src/lib/stock.ts`), lendo um numero que nunca muda.
--
-- E ISTO PIORA quando o B2BWave for desligado: hoje o feed ainda reescreve
-- `quantidade` de tempos em tempos. Sem ele, o numero congela para sempre.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Da a `produto_variantes` o mesmo `estoque_reservado` que o pai ja tem.
--   2. Faz a reserva do item travar TAMBEM na variante, com o mesmo UPDATE
--      condicional atomico (`WHERE disponivel >= quantidade`), que e o que
--      resolve a corrida.
--   3. Espelha na variante os QUATRO movimentos que o pai ja tem por mudanca de
--      status: cancelado, concluido, saiu-de-concluido, reativado.
--   4. Devolve a reserva da variante quando o item e apagado.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- 1) Variantes que JA estao vendidas alem do que tem (o estrago acumulado ate
--    aqui). Se voltar linha, o numero de `quantidade` esta otimista demais:
--
--   SELECT v.id, p.nome AS produto, v.nome AS variante, v.quantidade,
--          COALESCE(SUM(pi.quantidade) FILTER (WHERE ped.id IS NOT NULL), 0)
--            AS ja_vendido_em_pedido_aberto
--   FROM public.produto_variantes v
--   JOIN public.produtos p ON p.id = v.produto_id
--   LEFT JOIN public.pedido_itens pi ON pi.variante_id = v.id
--   LEFT JOIN public.pedidos ped ON ped.id = pi.pedido_id
--        AND ped.b2bwave_order_id IS NULL
--        AND ped.status::text NOT IN ('cancelado','cancelled','concluido','complete')
--   GROUP BY v.id, p.nome, v.nome, v.quantidade
--   HAVING COALESCE(SUM(pi.quantidade) FILTER (WHERE ped.id IS NOT NULL), 0) > v.quantidade
--   ORDER BY p.nome, v.nome;
--
-- O `FILTER (WHERE ped.id IS NOT NULL)` NAO e detalhe. Os filtros de `pedidos`
-- estao no ON do LEFT JOIN, entao item de pedido cancelado, concluido ou do
-- B2BWave NAO e eliminado — ele sobrevive com `ped.*` NULL. Sem o FILTER, o SUM
-- contava TUDO que ja foi vendido daquela variante e a consulta cuspia linhas
-- falsas de "vendida alem do que tem". (Eu tinha escrito sem.)
--
-- 2) Quantas variantes existem, para dimensionar:
--
--   SELECT count(*) AS variantes, count(*) FILTER (WHERE ativo IS TRUE) AS ativas
--   FROM public.produto_variantes;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) A variante ganha reservado, igual ao pai ----------
-- `NOT NULL DEFAULT 0` nao reescreve a tabela no PG11+: o default vai para o
-- catalogo.
ALTER TABLE public.produto_variantes
  ADD COLUMN IF NOT EXISTS estoque_reservado integer NOT NULL DEFAULT 0;

-- Backfill: o que ja esta reservado por pedido do APP ainda aberto. Mesmo
-- criterio do reparo que 20260623000000 fez no pai.
UPDATE public.produto_variantes v
   SET estoque_reservado = COALESCE((
     SELECT SUM(pi.quantidade)::int
     FROM public.pedido_itens pi
     JOIN public.pedidos p ON p.id = pi.pedido_id
     WHERE pi.variante_id = v.id
       AND p.b2bwave_order_id IS NULL
       AND p.status::text NOT IN ('cancelado','cancelled','concluido','complete')
   ), 0);

-- ---------- 2) Reserva do item trava tambem na variante ----------
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
        RAISE EXCEPTION 'INSUFFICIENT_STOCK'
          USING ERRCODE = 'check_violation',
                MESSAGE = 'Insufficient stock for variant ' || NEW.variante_id;
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

-- ---------- 3) Devolucao ao apagar o item ----------
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

    -- NOVO: devolve tambem na variante, senao a reserva dela vaza e o tamanho
    -- fica "esgotado" para sempre — falha silenciosa que so aparece como venda
    -- perdida.
    IF OLD.variante_id IS NOT NULL THEN
      UPDATE produto_variantes SET estoque_reservado = GREATEST(0, estoque_reservado - OLD.quantidade)
      WHERE id = OLD.variante_id;
    END IF;
  END IF;
  RETURN OLD;
END; $$;

-- ---------- 4) Os quatro movimentos por status, espelhados na variante --------
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

    UPDATE produto_variantes v SET estoque_reservado = GREATEST(0, v.estoque_reservado - iv.qtd)
    FROM (SELECT variante_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id AND variante_id IS NOT NULL GROUP BY variante_id) iv
    WHERE v.id = iv.variante_id;

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

    -- AQUI ESTAVA O BURACO PRINCIPAL: a baixa de verdade. Sem esta linha,
    -- `produto_variantes.quantidade` NUNCA diminuia com venda nenhuma.
    UPDATE produto_variantes v
       SET quantidade        = GREATEST(0, COALESCE(v.quantidade, 0) - iv.qtd),
           estoque_reservado = GREATEST(0, v.estoque_reservado - iv.qtd)
    FROM (SELECT variante_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id AND variante_id IS NOT NULL GROUP BY variante_id) iv
    WHERE v.id = iv.variante_id;

    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT it.produto_id, p.estoque_total + it.qtd, p.estoque_total,
           'Stock deducted - order completed (' || NEW.id || ')'
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    JOIN produtos p ON p.id = it.produto_id;
  END IF;

  -- SAIU DE CONCLUÍDO: desfaz o ramo anterior. Devolve o `estoque_total` e, se o
  -- pedido volta a ficar ABERTO (destino não é cancelado), reserva de novo.
  IF _old_done AND NOT _new_done THEN
    UPDATE produtos p
       SET estoque_total     = p.estoque_total + it.qtd,
           estoque_reservado = p.estoque_reservado + CASE WHEN _new_cancel THEN 0 ELSE it.qtd END
    FROM (SELECT produto_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id GROUP BY produto_id) it
    WHERE p.id = it.produto_id;

    UPDATE produto_variantes v
       SET quantidade        = COALESCE(v.quantidade, 0) + iv.qtd,
           estoque_reservado = v.estoque_reservado + CASE WHEN _new_cancel THEN 0 ELSE iv.qtd END
    FROM (SELECT variante_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id AND variante_id IS NOT NULL GROUP BY variante_id) iv
    WHERE v.id = iv.variante_id;

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

    UPDATE produto_variantes v SET estoque_reservado = v.estoque_reservado + iv.qtd
    FROM (SELECT variante_id, SUM(quantidade)::int AS qtd FROM pedido_itens
          WHERE pedido_id = NEW.id AND variante_id IS NOT NULL GROUP BY variante_id) iv
    WHERE v.id = iv.variante_id;

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

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO impede o SYNC de sobrescrever `produto_variantes.quantidade` com o numero
-- do B2BWave no proximo ciclo. Enquanto os dois sistemas existirem, o feed manda.
-- Quando o B2BWave for desligado, este passa a ser o unico dono do numero — e ai
-- ele estara certo, porque a baixa passa a acontecer. Item proprio na fila.
--
-- NAO gera linha em `estoque_log` por variante: os relatorios somam essa tabela,
-- e uma linha por variante MAIS a do pai contaria o mesmo movimento duas vezes.
-- O log continua por produto, como sempre foi.
--
-- FALTA UMA VIA DE ENTRADA PARA A VARIANTE — e isto precisa entrar na fila
-- JUNTO, nao depois. Nada no sistema DEVOLVE estoque para uma variante: o
-- check-in de producao credita so `produtos.estoque_total` (20260619210000), a
-- API publica so mexe no pai, e o ajuste manual do admin so escreve no pai.
-- A partir daqui cada pedido concluido decrementa `produto_variantes.quantidade`
-- de forma permanente, e as UNICAS reposicoes sao o feed do B2BWave (que vai ser
-- desligado) e a digitacao manual no ProductEdit.
--
-- No dia em que o B2BWave morrer, o estoque de variante vira CATRACA DE MAO
-- UNICA ate zero: a vitrine mostra "esgotado" por tamanho enquanto a producao
-- credita so o produto-pai.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- NAO E TRIVIAL, e eu tinha escrito duas coisas erradas aqui. Leia antes.
--
-- 1) NAO rode `20260623000000_stock_and_coupon_hardening.sql` de novo.
--    Aquele arquivo tambem reinstala `fn_pedido_total_appside` numa versao
--    ANTERIOR ao conserto de 20260801130000 — a que revalida a elegibilidade do
--    cupom em TODO update e zera o desconto, SUBINDO o total de um pedido que o
--    cliente ja fechou. Ele traz junto o `_resolve_desconto` antigo e um UPDATE
--    de reparo no estoque reservado do produto-pai.
--
-- 2) NAO adianta "zerar a coluna". Depois desta migration a coluna E LIDA, no
--    proprio WHERE que recusa a venda. Zerar so apaga o razao: a trava continua
--    de pe e o decremento de `quantidade` no fechamento tambem.
--
-- O rollback de verdade e reinstalar as TRES funcoes sem os blocos de variante.
-- Os corpos originais estao em:
--   `fn_reserve_stock_on_order_item`  e `fn_release_stock_on_item_delete`
--       -> 20260623000000_stock_and_coupon_hardening.sql (SO essas duas funcoes,
--          copiadas a mao; nao rode o arquivo inteiro)
--   `fn_adjust_stock_on_order_status`
--       -> 20260803120000_desfazer_conclusao_devolve_estoque.sql (idem)
--
-- Depois, opcionalmente:
--   ALTER TABLE public.produto_variantes DROP COLUMN estoque_reservado;
--
-- Reverter reabre a venda do mesmo tamanho para dois clientes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A coluna existe e a reserva foi preenchida:
--   SELECT count(*) AS variantes,
--          count(*) FILTER (WHERE estoque_reservado > 0) AS com_reserva
--   FROM public.produto_variantes;
--
-- 2) As tres funcoes tem o espelho:
--   SELECT proname, prosrc LIKE '%produto_variantes%' AS mexe_em_variante
--   FROM pg_proc
--   WHERE proname IN ('fn_reserve_stock_on_order_item',
--                     'fn_release_stock_on_item_delete',
--                     'fn_adjust_stock_on_order_status')
--   ORDER BY proname;
--   -- esperado: true nas tres
--
-- 3) CONTROLE — o caminho BOM tem que continuar funcionando: feche um pedido de
--    teste com um produto que TEM variante e saldo suficiente. Tem que passar.
--    Sem este teste, uma trava que recusa TODO mundo passaria como "consertada".
--
-- 4) A trava funciona: tente comprar mais unidades de um tamanho do que ele tem.
--    Tem que recusar com "Insufficient stock".
-- ---------------------------------------------------------------------------
