-- ============================================================================
-- COLUNAS DE ITEM DE PEDIDO QUE SO O SERVIDOR/STAFF PODE DEFINIR
--
-- Irma de 20260825240000, que fez isto para `pedidos`. Aqui e `pedido_itens`.
--
-- A policy de INSERT do cliente e apenas "o pedido e meu":
--
--   CREATE POLICY "Clients can insert pedido_itens" ON public.pedido_itens
--     FOR INSERT WITH CHECK (EXISTS (
--       SELECT 1 FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
--       WHERE p.id = pedido_itens.pedido_id AND c.user_id = auth.uid()));
--
-- Ela nao diz nada sobre QUAIS colunas. `preco_unitario` e `subtotal` ja estao
-- cobertos (o gatilho de preco autoritativo reescreve), e `variante_id` tambem
-- (20260825220000). Ficaram de fora:
--
--   quantidade_enviada -> quanto ja foi EXPEDIDO daquela linha. O cliente cria o
--                         item ja marcado como enviado. Na tela do deposito o
--                         pedido aparece como despachado sem ninguem ter
--                         despachado nada.
--   status_linha       -> status por linha (texto livre, vindo do B2BWave).
--   backorder          -> marca de pendencia. Note que `produtos.permitir_backorder`
--                         DESLIGA a exigencia de estoque no gatilho de reserva —
--                         a coluna do ITEM nao faz isso hoje, mas e um campo de
--                         operacao que o cliente nao deveria escolher.
--   nome_produto, sku  -> TEXTO LIVRE do cliente que vai para a tela do staff, o
--                         PDF do pedido e o e-mail. NAO ESTA COBERTO AQUI — ver
--                         a secao "o que isto nao faz", no fim.
--
-- Quem preenche esses campos de verdade e o STAFF, na tela do pedido
-- (`admin/OrderDetail.tsx`), e o SYNC.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Item de pedido do PORTAL que nasceu marcado como enviado, ou com status de
-- linha preenchido. Numa criacao legitima os dois vem zerados/vazios — quem
-- preenche e o staff, depois.
--
--   SELECT pi.id, p.numero, pi.nome_produto, pi.quantidade,
--          pi.quantidade_enviada, pi.status_linha, pi.backorder, p.created_at
--   FROM public.pedido_itens pi
--   JOIN public.pedidos p ON p.id = pi.pedido_id
--   WHERE p.b2bwave_order_id IS NULL
--     AND (pi.quantidade_enviada > 0
--          OR coalesce(btrim(pi.status_linha), '') <> ''
--          OR pi.backorder IS TRUE)
--     AND p.status::text = 'submitted'
--   ORDER BY p.created_at DESC;
--
-- (Filtrei por `status = 'submitted'` de proposito: pedido ja processado tem
--  esses campos preenchidos com razao. O que interessa e o que nasceu assim.)
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_lock_item_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- `service_role` (o sync) e conexao direta ao banco passam.
  IF auth.role() = 'service_role' OR auth.role() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin')
     OR public.has_role(auth.uid(), 'manager')
     OR public.has_role(auth.uid(), 'warehouse') THEN
    RETURN NEW;
  END IF;

  -- Item de pedido IMPORTADO ja chega com esses campos preenchidos na origem.
  IF EXISTS (
    SELECT 1 FROM public.pedidos p
    WHERE p.id = NEW.pedido_id AND p.b2bwave_order_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Campos de EXPEDICAO: nascem zerados. Quem preenche e o deposito.
  NEW.quantidade_enviada := 0;
  NEW.status_linha       := NULL;
  NEW.backorder          := false;

  RETURN NEW;
END $$;

-- Prefixo `a_` para rodar ANTES dos demais BEFORE: o gatilho de variante
-- (`trg_item_exige_variante`) e o de produto valido (`trg_item_produto_valido`)
-- leem `produto_id`/`variante_id`, que este NAO altera — mas manter a mesma
-- convencao dos outros dois arquivos de trava evita surpresa se algum dia um
-- deles passar a ler `sku` ou `nome_produto`.
DROP TRIGGER IF EXISTS a_trg_lock_item_cols ON public.pedido_itens;
CREATE TRIGGER a_trg_lock_item_cols
  BEFORE INSERT ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_item_cols();

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- So BEFORE INSERT. O cliente nao tem policy de UPDATE nem de DELETE em
-- `pedido_itens` — conferido junto com as de `pedidos` — entao depois de criado
-- ele nao mexe. Quem edita e o staff, e para ele o gatilho e isento.
--
-- NAO corrige linhas historicas.
--
-- NAO TRAVA `nome_produto` E `sku`, e a razao importa.
--
-- Eu tinha escrito a trava: copiar os dois do produto, ignorando o corpo. So que
-- o Checkout monta o nome como "<produto> (<tamanho/cor>)", e o rotulo do
-- tamanho vem de `formatOpcao` (`src/lib/variants.ts`), que trata varios
-- formatos de `valores_opcao` — texto, numero, e objeto com `option_name`/
-- `value`. Copiar so `produtos.nome` APAGARIA a variante da linha, e o deposito
-- separaria errado.
--
-- Replicar `formatOpcao` em SQL resolveria — e criaria uma SEGUNDA copia de uma
-- regra de formatacao, que diverge no dia em que alguem mexer num lado so. Ja
-- tenho uma dessas neste projeto (a traducao de status em
-- 20260825330000) e ela so se justifica porque decide BLOQUEIO, nao texto.
--
-- Peso real: e texto que aparece no documento, nao decisao de preco, estoque ou
-- acesso. O cliente pode escrever algo estranho no nome do item DELE, e o staff
-- ve na conferencia. Fica anotado como divida, com o conserto certo sendo o
-- servidor MONTAR a linha do PDF a partir de `produto_id` + `variante_id` em vez
-- de confiar no texto gravado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS a_trg_lock_item_cols ON public.pedido_itens;
--
-- Reverter devolve ao cliente o poder de criar item ja marcado como enviado e de
-- escrever o texto que quiser no nome/SKU que aparece no seu PDF.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O gatilho existe e roda primeiro:
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.pedido_itens'::regclass AND NOT tgisinternal
--   ORDER BY tgname;
--   -- `a_trg_lock_item_cols` tem que ser o primeiro da lista.
--
-- 2) CONTROLE — feche um pedido de teste pelo portal e confira que os itens
--    entram normalmente, com nome e tamanho/cor certos, e com quantidade
--    enviada 0. Sem este teste, um gatilho que recusa todo item passaria como
--    "consertado".
--
-- 3) O admin continua conseguindo marcar quantidade enviada e status na tela do
--    pedido.
-- ---------------------------------------------------------------------------
