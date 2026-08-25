-- ============================================================================
-- REDE NO BANCO: item de pedido nao entra sem variante quando o produto tem
--
-- Ate aqui a regra existia SO no navegador (`src/lib/stock.ts`). Isso significa
-- que qualquer caminho que nao passe por ela grava o item errado:
--   - carrinho salvo no localStorage de antes de o produto ganhar opcao;
--   - re-order de pedido importado (o sync nunca grava `variante_id`);
--   - "add product" do admin em pedido existente (`OrderDetail.tsx`);
--   - a propria validacao do checkout, se a consulta de estoque falhar.
--
-- O item vira produto-PAI, com o preco do pai, e ninguem ve. O cliente recebe o
-- produto errado.
--
-- `pedido_itens.variante_id` e anulavel de proposito (produto sem opcao nao tem
-- variante), entao nao da para resolver com NOT NULL. Precisa de gatilho.
--
-- ROLLBACK e VERIFICACAO no fim do arquivo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP — quantas linhas JA existem no estado que passa a ser recusado.
-- Rode ANTES e guarde: sao pedidos historicos que continuam validos (o gatilho
-- so vale para INSERT/UPDATE novos), mas e bom saber o tamanho.
--
--   SELECT count(*) AS itens_sem_variante_em_produto_com_variante
--   FROM public.pedido_itens pi
--   WHERE pi.variante_id IS NULL
--     AND EXISTS (SELECT 1 FROM public.produto_variantes v
--                 WHERE v.produto_id = pi.produto_id AND v.ativo IS TRUE);
-- ---------------------------------------------------------------------------

BEGIN;

-- Indice: sem ele o EXISTS abaixo faz seq scan A CADA LINHA inserida —
-- multiplicado por lote de import e pelos ~1150 pedidos do sync.
CREATE INDEX IF NOT EXISTS produto_variantes_produto_ativo_idx
  ON public.produto_variantes (produto_id) WHERE ativo IS TRUE;

CREATE OR REPLACE FUNCTION public.fn_item_exige_variante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ISENTA O SYNC. `buildOrderItems` do b2bwave-sync NUNCA resolve variante, e o
  -- insert e em LOTE: uma linha recusada derrubaria TODOS os itens do pedido.
  -- Pior, o caminho de UPDATE ja apagou os itens antes de reinserir e grava
  -- `quantidade_total: 0` no erro — entao o `changed` do proximo tick veria
  -- diferenca, tentaria de novo, falharia de novo. Pedido VAZIO e permanente,
  -- com o log entupido. Nao e "incompleto e visivel", e destruicao em laco.
  --
  -- Mesma isencao que os triggers de recalculo ja usam. Sai quando o
  -- `buildOrderItems` passar a casar `product_code` com `produto_variantes.codigo`
  -- — anotado na fila como o conserto de verdade.
  IF EXISTS (
    SELECT 1 FROM public.pedidos p
    WHERE p.id = NEW.pedido_id AND p.b2bwave_order_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Variante informada: confere que ela e DESTE produto. A FK garante que a
  -- variante existe, nao que pertence ao produto da linha.
  IF NEW.variante_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.produto_variantes v
      WHERE v.id = NEW.variante_id AND v.produto_id = NEW.produto_id
    ) THEN
      RAISE EXCEPTION 'ITEM_VARIANT_MISMATCH: variant % does not belong to product %',
        NEW.variante_id, NEW.produto_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- `variante_id` foi ZERADO por um UPDATE: e a acao do ON DELETE SET NULL da FK
  -- (alguem apagou a variante), nao uma escrita do app. Recusar aqui travaria a
  -- exclusao de variante obsoleta no ProductEdit e no proprio sync.
  IF TG_OP = 'UPDATE' AND OLD.variante_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.produto_variantes v
    WHERE v.produto_id = NEW.produto_id AND v.ativo IS TRUE
  ) THEN
    -- Token reconhecivel no INICIO da mensagem: o Checkout casa por texto, nao
    -- por codigo, e sem isto o cliente via este texto cru na tela.
    RAISE EXCEPTION 'ITEM_NEEDS_VARIANT: product % has options (size/color) — pick one',
      NEW.produto_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

-- BEFORE INSERT OR UPDATE OF produto_id/variante_id: pega tanto o item novo
-- quanto a troca de produto num item existente.
DROP TRIGGER IF EXISTS trg_item_exige_variante ON public.pedido_itens;
CREATE TRIGGER trg_item_exige_variante
  BEFORE INSERT OR UPDATE OF produto_id, variante_id ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_exige_variante();

COMMIT;

-- ---------------------------------------------------------------------------
-- IMPORTANTE — o que este gatilho NAO faz
--
-- NAO corrige linhas historicas. Pedido antigo com item sem variante continua
-- como esta: mexer nele reescreveria pedido ja faturado, e a informacao de qual
-- variante era nao existe mais.
--
-- NAO vale para pedido do B2BWave (ver a isencao no topo da funcao). Enquanto o
-- sync nao resolver `variante_id`, isentar e a unica opcao segura — sem isso o
-- primeiro tick esvaziaria pedidos em laco.
--
-- Fecha o caminho ACIDENTAL: carrinho velho do localStorage, re-order de pedido
-- importado, "add product" do admin, import por CSV, e a falha da validacao do
-- checkout. E por onde o pedido errado entrava de verdade.
--
-- NAO fecha o caminho DELIBERADO enquanto `b2bwave_order_id` for gravavel pelo
-- cliente: mandando essa coluna no insert, o pedido fica isento deste gatilho e
-- de todos os recalculos de preco. A trava esta em
-- 20260825230000_trava_b2bwave_order_id.sql e precisa rodar JUNTO com esta.
-- (Eu tinha escrito aqui que "fecha o caminho do CLIENTE". Era falso.)
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_item_exige_variante ON public.pedido_itens;
--   -- (a funcao pode ficar; sem gatilho ela nao executa)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO — tem que voltar uma linha, com tgenabled = 'O'
--
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_item_exige_variante';
-- ---------------------------------------------------------------------------
