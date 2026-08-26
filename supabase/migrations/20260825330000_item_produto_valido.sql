-- ============================================================================
-- ITEM DE PEDIDO NAO ACEITA MAIS PRODUTO DESATIVADO, PRIVADO OU NAO-VENDAVEL (C7)
--
-- A policy de INSERT em `pedido_itens` valida SO a posse do pedido:
--
--   CREATE POLICY "Clients can insert pedido_itens" ON public.pedido_itens
--     FOR INSERT WITH CHECK (EXISTS (
--       SELECT 1 FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
--       WHERE p.id = pedido_itens.pedido_id AND c.user_id = auth.uid()));
--
-- `produto_id` nao e olhado em lugar nenhum. E os gatilhos que ja rodam no
-- INSERT — preco autoritativo, recalculo de subtotal, reserva de estoque,
-- exigencia de variante, `CHECK (quantidade > 0)` — nenhum confere se o produto
-- pode ser comprado.
--
-- TRES BURACOS, todos alcancaveis por um POST direto na API:
--
--   1. PRODUTO DESATIVADO (`produtos.ativo = false`). Pior: `cliente_pode_ver_
--      produto` tambem NAO olha `ativo`, entao produto descontinuado continua
--      LEGIVEL e comprável. Re-order de pedido antigo entra sem reclamar.
--   2. PRODUTO PRIVADO de outro grupo. A privacidade so vale na LEITURA; nada
--      impedia gravar o item.
--   3. STATUS "nao vendavel" (`product_statuses.permite_comprar = false`). A
--      coluna existe desde 20260319150711 e NUNCA aparece em SQL nenhum — as 10
--      referencias sao todas TypeScript, ou seja, so no navegador.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Itens JA gravados que o gatilho passaria a recusar. Sao pedidos historicos e
-- continuam validos (o gatilho so vale para INSERT/UPDATE novos), mas e bom
-- saber o tamanho — e se aparecer numero alto, vale entender por que.
--
--   SELECT count(*) FILTER (WHERE NOT pr.ativo)                    AS produto_desativado,
--          count(*) FILTER (WHERE ps.permite_comprar IS FALSE)     AS status_nao_vendavel
--   FROM public.pedido_itens pi
--   JOIN public.pedidos p   ON p.id = pi.pedido_id
--   JOIN public.produtos pr ON pr.id = pi.produto_id
--   LEFT JOIN public.product_statuses ps ON ps.nome = pr.status_produto
--   WHERE p.b2bwave_order_id IS NULL;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_item_produto_valido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ativo   boolean;
  _status  text;
  _vende   boolean;
BEGIN
  -- ISENTA O SYNC, pela mesma razao do gatilho de variante: o insert de itens do
  -- B2BWave e em LOTE, e uma linha recusada derrubaria TODOS os itens do pedido
  -- — e o caminho de UPDATE ja apagou os itens antes de reinserir. Viraria
  -- pedido VAZIO permanente, em laco.
  IF EXISTS (
    SELECT 1 FROM public.pedidos p
    WHERE p.id = NEW.pedido_id AND p.b2bwave_order_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Staff monta pedido manual e precisa poder incluir produto fora do catalogo
  -- (venda de sobra, item descontinuado que ainda esta no estoque). A trava e
  -- contra o caminho do CLIENTE.
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin')
     OR public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;

  SELECT pr.ativo, pr.status_produto INTO _ativo, _status
  FROM public.produtos pr WHERE pr.id = NEW.produto_id;

  IF _ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'ITEM_PRODUTO_INATIVO: product % is not available',
      NEW.produto_id USING ERRCODE = 'check_violation';
  END IF;

  -- Privacidade: a MESMA funcao que decide o que o cliente ve no catalogo.
  -- Assim a vitrine e o pedido nao podem discordar.
  IF NOT public.cliente_pode_ver_produto(NEW.produto_id) THEN
    RAISE EXCEPTION 'ITEM_PRODUTO_INATIVO: product % is not available',
      NEW.produto_id USING ERRCODE = 'check_violation';
  END IF;

  -- Status "nao vendavel".
  --
  -- ATENCAO AO CASAMENTO: `produtos.status_produto` guarda um nome em PORTUGUES
  -- ("disponivel", "esgotado", "pre_venda"), e `product_statuses.nome` esta em
  -- INGLES ("available", "sold out", "pre-order"). O front traduz antes de
  -- comparar (`NAME_MAP` em `src/lib/stock.ts`); se eu comparasse cru, NADA
  -- casaria — e como a denylist e conservadora, a trava simplesmente nunca
  -- dispararia. Seria decoracao.
  --
  -- Mesma tabela de traducao, aqui. Se alguem mexer no `NAME_MAP` do front, tem
  -- que mexer aqui tambem — anotado nos dois lados.
  IF _status IS NOT NULL AND btrim(_status) <> '' THEN
    _status := lower(btrim(_status));
    _status := CASE _status
      WHEN 'disponivel'       THEN 'available'
      WHEN 'indisponivel'     THEN 'not available'
      WHEN 'esgotado'         THEN 'sold out'
      WHEN 'pre_venda'        THEN 'pre-order'
      WHEN 'estoque_limitado' THEN 'limited stock'
      WHEN 'descontinuado'    THEN 'discontinued'
      ELSE _status
    END;

    -- Denylist conservadora: status sem linha em `product_statuses`, ou com
    -- `permite_comprar` nulo, NAO bloqueia — nao quero derrubar venda por causa
    -- de um status que ninguem cadastrou direito.
    SELECT ps.permite_comprar INTO _vende
    FROM public.product_statuses ps
    WHERE lower(btrim(ps.nome)) = _status
    LIMIT 1;

    IF _vende IS FALSE THEN
      RAISE EXCEPTION 'ITEM_PRODUTO_NAO_VENDAVEL: product % cannot be ordered right now',
        NEW.produto_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Nome sem prefixo `a_`: este roda DEPOIS dos que ajustam preco/estoque, e nao
-- importa a ordem — ele so recusa ou deixa passar, nao altera coluna nenhuma.
DROP TRIGGER IF EXISTS trg_item_produto_valido ON public.pedido_itens;
CREATE TRIGGER trg_item_produto_valido
  BEFORE INSERT OR UPDATE OF produto_id ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_produto_valido();

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO corrige linhas historicas: pedido antigo com produto hoje desativado
-- continua como esta. Mexer nele reescreveria pedido ja faturado.
--
-- NAO faz `cliente_pode_ver_produto` olhar `produtos.ativo`. Produto desativado
-- continua LEGIVEL para quem ja podia ver — o que muda e que ele nao entra mais
-- em pedido. Fechar a leitura tambem e mudanca maior (a tela de pedido antigo
-- precisa conseguir carregar o produto para mostrar o item), e fica na fila.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_item_produto_valido ON public.pedido_itens;
--   -- (a funcao pode ficar; sem gatilho ela nao executa)
--
-- Reverter reabre pedido de produto desativado, privado de outro grupo, e de
-- status marcado como nao-vendavel.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O gatilho existe:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgname = 'trg_item_produto_valido';
--
-- 2) CONTROLE — o caminho BOM tem que continuar funcionando: feche um pedido de
--    teste pelo portal, com produto ativo e visivel. Tem que passar.
--    Sem este teste, um gatilho que recusa TODO mundo passaria como "consertado".
--
-- 3) A trava funciona: desative um produto no admin e tente coloca-lo num pedido
--    pelo portal (por re-order de um pedido antigo, por exemplo). Tem que recusar.
-- ---------------------------------------------------------------------------
