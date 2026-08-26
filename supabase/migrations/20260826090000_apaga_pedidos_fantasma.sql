-- ============================================================================
-- OS 18 PEDIDOS FANTASMA SAEM
--
-- A comparacao de 26/ago achou 18 pedidos que existem AQUI e nao existem mais no
-- B2BWave. A Jessika confirmou por escrito e conferiu duas deles no sistema:
--
--   "se nao ta no b2b, foi deletado de proposito"
--   "a gente deleta ordem quando o cliente faz merda, ou precisamos migrar 2
--    ordens, ou nao tem o material e o cliente cancela"
--
-- O sync NUNCA apaga pedido — so cria e atualiza. Entao toda exclusao feita la
-- desde sempre deixou um fantasma aqui. Enquanto o B2BWave for a fonte da
-- verdade, o clone tem que refletir tambem o que foi APAGADO.
--
-- ROLLBACK e VERIFICACAO no fim. Leia o AVISO antes de rodar.
-- ============================================================================
--
-- ⚠ AVISO — ISTO APAGA DADO, E NAO TEM DESFAZER.
--
-- `pedido_itens` tem `ON DELETE CASCADE` (20260317043654:133), entao as linhas
-- de cada pedido vao junto. Nenhuma outra tabela referencia `pedidos` — conferi
-- as 182 migrations, so existe essa uma chave estrangeira.
--
-- RODE A CONSULTA DE BACKUP ABAIXO E GUARDE O RESULTADO ANTES. Se um dia
-- descobrirmos que alguma dessas exclusoes no B2BWave foi engano, o retorno
-- guardado e a unica coisa que sobra.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP — rode ANTES, exporte o CSV e guarde.
--
--   SELECT p.numero, p.created_at, p.status, p.total, p.subtotal,
--          c.email AS cliente, p.observacoes, p.po_number,
--          i.sku, i.nome_produto, i.quantidade, i.preco_unitario, i.subtotal AS item_subtotal
--     FROM public.pedidos p
--     LEFT JOIN public.clientes c    ON c.id = p.cliente_id
--     LEFT JOIN public.pedido_itens i ON i.pedido_id = p.id
--    WHERE p.b2bwave_order_id IS NOT NULL
--      AND p.numero IN (1,2,3,4,2153,2287,2321,2576,2585,2612,2620,2634,
--                       2648,2659,2671,2699,2720,2738)
--    ORDER BY p.numero, i.sku;
-- ---------------------------------------------------------------------------

BEGIN;

-- `b2bwave_order_id IS NOT NULL` NAO e detalhe.
--
-- O numero de pedido NAO e unico neste banco: a comparacao mostrou DOIS pedidos
-- 2659, de clientes diferentes. Um deles nasceu aqui, no portal (tem
-- `b2bwave_order_id` nulo) e NAO e fantasma — apagar por numero levaria os dois.
DELETE FROM public.pedidos
 WHERE b2bwave_order_id IS NOT NULL
   AND numero IN (1,2,3,4,2153,2287,2321,2576,2585,2612,2620,2634,
                  2648,2659,2671,2699,2720,2738);

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO impede que novos fantasmas aparecam. Enquanto o sync nao souber apagar
-- pedido que sumiu da origem, toda exclusao futura no B2BWave deixa outro aqui.
-- Esse conserto e de codigo e esta na fila — esta migration limpa o passado.
--
-- NAO toca no pedido 2659 que nasceu AQUI (o de `jessika.andrade@hotmail.com`,
-- com `b2bwave_order_id` nulo). Ele nao veio do B2BWave, entao nao e fantasma.
-- Se for teste, sai numa limpeza separada e consciente.
--
-- NAO libera reserva de estoque. Apagar o pedido apaga os itens em cascata, e o
-- gatilho de liberacao nao devolve reserva quando o pai ja sumiu (deliberado,
-- para nao devolver duas vezes). Estes 18 estao todos em `complete`/`recebido`,
-- cuja reserva ja foi baixada na conclusao — por isso nao ha o que devolver.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- NAO EXISTE. `DELETE` com `COMMIT` nao volta.
--
-- O unico caminho de volta e reimportar do B2BWave — e eles nao estao mais la,
-- que e justamente o motivo desta migration. Por isso o backup acima nao e
-- formalidade: e a unica copia.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Sumiram, e o nativo FICOU:
--   SELECT numero, b2bwave_order_id,
--          CASE WHEN b2bwave_order_id IS NULL THEN 'nasceu aqui' ELSE 'importado' END AS origem
--     FROM public.pedidos
--    WHERE numero IN (1,2,3,4,2153,2287,2321,2576,2585,2612,2620,2634,
--                     2648,2659,2671,2699,2720,2738)
--    ORDER BY numero;
--   -- ESPERADO: UMA linha, o 2659 com `b2bwave_order_id` NULO.
--   -- Se vier vazio, o pedido nativo foi junto — me avise.
--
-- 2) CONTROLE — nada mais foi levado:
--   SELECT count(*) FROM public.pedidos WHERE b2bwave_order_id IS NOT NULL;
--   -- ESPERADO: 1147 - 18 = 1129.
--   -- Numero diferente disso significa que o DELETE pegou o que nao devia, e
--   -- sem este teste isso so apareceria quando um cliente reclamasse.
--
-- 3) Rode a comparacao de pedidos de novo: `sobrando_aqui` tem que cair de 18
--    para 0.
-- ---------------------------------------------------------------------------
