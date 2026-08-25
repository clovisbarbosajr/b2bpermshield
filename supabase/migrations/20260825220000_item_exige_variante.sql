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

CREATE OR REPLACE FUNCTION public.fn_item_exige_variante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- So checa quando a linha NAO tem variante. Linha com variante ja e validada
  -- pela FK e pelas telas.
  IF NEW.variante_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.produto_variantes v
    WHERE v.produto_id = NEW.produto_id AND v.ativo IS TRUE
  ) THEN
    RAISE EXCEPTION
      'produto % tem opcoes (tamanho/cor) e o item nao especifica qual — escolha uma opcao',
      NEW.produto_id
      USING ERRCODE = 'check_violation';
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
-- Ele NAO corrige as linhas historicas. Pedido antigo com item sem variante
-- continua como esta: mexer nele reescreveria pedido ja faturado, e a
-- informacao de qual variante era nao existe mais em lugar nenhum.
--
-- Ele TAMBEM vale para o `b2bwave-sync`, que grava `pedido_itens` com
-- `variante_id` sempre NULL (o `buildOrderItems` nunca resolve variante). Se o
-- B2BWave mandar um pedido de produto que aqui tem variante, o item sera
-- RECUSADO e o pedido ficara sem essa linha, com o contador de erro subindo no
-- sync_log.
--
-- Isso e deliberado: melhor o pedido chegar incompleto e visivel no log do que
-- completo e errado. Mas E uma mudanca de comportamento do sync — se aparecer
-- erro em massa depois de aplicar, o `sync_log` dira, e o ROLLBACK abaixo
-- destrava na hora.
-- ---------------------------------------------------------------------------

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
