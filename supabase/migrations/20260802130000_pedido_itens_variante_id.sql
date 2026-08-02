-- ============================================================================
-- BUG (schema): `pedido_itens` não guarda QUAL VARIANTE foi comprada.
--
-- Hoje a variante chega no pedido só como TEXTO: `nome_produto` vira
-- "Camiseta (Size: M / Color: Blue)" e `sku` recebe o código da variante
-- (Checkout.tsx, montagem de `itens`). Consequências reais:
--
--   * RE-ORDER perde a variante. `Pedidos.tsx:handleReorder` e
--     `PedidoDetalhe.tsx:handleAddToOrder` remontam o item do carrinho só com
--     `produto_id` — o cliente repete o pedido e recebe o produto errado.
--   * Nenhum relatório consegue agrupar venda por variante (o "Sales per
--     product" soma tudo no produto-pai).
--   * O texto é imutável: se o nome do produto ou o rótulo da opção mudar
--     depois, não há como reconciliar o histórico.
--
-- CORREÇÃO: coluna própria, anulável e SEM backfill.
--   * ANULÁVEL de propósito: os pedidos antigos (e todo pedido de produto sem
--     variante) ficam NULL. Não dá pra inferir a variante do texto com
--     segurança, e chutar seria pior que deixar vazio.
--   * ON DELETE SET NULL: apagar uma variante do catálogo não pode apagar nem
--     travar o histórico de pedidos. O `nome_produto`/`sku` continuam lá como
--     registro textual do que foi vendido.
--
-- O app passa a gravar a coluna no checkout e a usá-la no re-order.
-- ============================================================================

ALTER TABLE public.pedido_itens
  ADD COLUMN IF NOT EXISTS variante_id uuid
  REFERENCES public.produto_variantes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pedido_itens.variante_id IS
  'Variante (produto_variantes) comprada nesta linha. NULL = produto sem variante ou pedido anterior a 02/ago/2026 (sem backfill: a variante so existia como texto em nome_produto/sku).';

-- Usado pelo re-order e por relatorio por variante.
CREATE INDEX IF NOT EXISTS pedido_itens_variante_id_idx
  ON public.pedido_itens (variante_id) WHERE variante_id IS NOT NULL;
