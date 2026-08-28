-- ---------------------------------------------------------------------------
-- O REALTIME PARA DE ENTREGAR O CUSTO DO PRODUTO AO CLIENTE.
--
-- O QUE VAZAVA: `produtos` entrou na publicacao `supabase_realtime` SEM lista de
-- coluna (`20260623080000_realtime_produtos.sql`), entao todo UPDATE mandava a
-- LINHA INTEIRA para quem estivesse inscrito — incluindo `custo`. RLS filtra
-- LINHA, nao COLUNA, e o cliente nao tem como restringir o payload.
--
-- O caminho principal (o `select("*")` do catalogo e da ficha) ja foi fechado no
-- commit `be76212`. Este e a outra metade: sem ele, basta um produto ser
-- atualizado com o catalogo aberto para a margem sair na rede de novo.
--
-- ---------------------------------------------------------------------------
-- POR QUE PRECISA TROCAR O `REPLICA IDENTITY` JUNTO
--
-- A migration original tambem fez `ALTER TABLE produtos REPLICA IDENTITY FULL`.
-- Com FULL, TODA coluna vira identidade de replica, e o Postgres exige que a lista
-- de colunas da publicacao contenha todas as colunas de identidade. Ou seja: a
-- lista de tres colunas seria RECUSADA enquanto o FULL estiver de pe. Os dois
-- comandos andam juntos ou nenhum funciona.
--
-- `DEFAULT` usa a chave primaria, e `produtos.id` e PK.
--
-- ---------------------------------------------------------------------------
-- POR QUE E SEGURO AQUI — verificado, nao presumido
--
-- 1. `produtos` e a UNICA tabela da publicacao (medido em 28/ago/2026). Por isso
--    o `SET TABLE`, que SUBSTITUI a lista inteira, nao derruba realtime de mais
--    ninguem. Em outro banco esse mesmo comando seria destrutivo — confira antes
--    de reaproveitar:
--      SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
--
-- 2. NENHUM handler usa o registro ANTIGO (`payload.old`), que e o que o FULL
--    existe para fornecer. Sao quatro inscricoes, todas em `src/`:
--      `admin/Estoque.tsx:50`      -> `() => fetchData()`, ignora o payload
--      `portal/Carrinho.tsx:178`   -> `() => check()`, ignora o payload
--      `portal/Checkout.tsx:559`   -> `() => check()`, ignora o payload
--      `portal/Catalogo.tsx:238`   -> le so `id`, `estoque_total`, `estoque_reservado`
--    As tres colunas que o catalogo usa sao exatamente as que ficam na lista.
--
-- 3. Os dois `filter: id=in.(...)` filtram por `id`, que e a PK — continuam
--    funcionando com identidade DEFAULT. Filtro por coluna FORA da identidade e o
--    que quebraria, e nao ha nenhum.
--
-- ---------------------------------------------------------------------------
-- NAO APAGA NADA e nao reescreve tabela. Muda metadado de replicacao.
--
-- DIAGNOSTICO — rode ANTES e guarde:
--
--   SELECT pt.tablename, c.relreplident
--     FROM pg_publication_tables pt
--     JOIN pg_class c ON c.relname = pt.tablename
--    WHERE pt.pubname = 'supabase_realtime';
--   -- Esperado ANTES: uma linha, `produtos`, `f` (FULL).
--
-- ROLLBACK — devolve o vazamento, mas restaura o estado exato de antes:
--   ALTER PUBLICATION supabase_realtime SET TABLE public.produtos;
--   ALTER TABLE public.produtos REPLICA IDENTITY FULL;
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Ordem importa: o FULL sai primeiro, senao a lista de colunas e recusada.
ALTER TABLE public.produtos REPLICA IDENTITY DEFAULT;

ALTER PUBLICATION supabase_realtime
  SET TABLE public.produtos (id, estoque_total, estoque_reservado);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A publicacao tem a lista de colunas, e so ela:
--
--   SELECT pt.tablename, pt.attnames, c.relreplident
--     FROM pg_publication_tables pt
--     JOIN pg_class c ON c.relname = pt.tablename
--    WHERE pt.pubname = 'supabase_realtime';
--   -- ESPERADO: `produtos`, {id,estoque_total,estoque_reservado}, `d`.
--   -- Se `attnames` vier com a tabela inteira, o SET TABLE nao pegou a lista.
--
-- 2) O custo NAO esta na lista — a pergunta que motivou tudo:
--
--   SELECT 'custo' = ANY(attnames) AS custo_ainda_vaza
--     FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'produtos';
--   -- ESPERADO: false.
--
-- 3) O estoque ao vivo continua funcionando — teste na TELA, nao em SQL: abra
--    `/admin/inventory` (ou o catalogo do portal) numa aba, altere o estoque de um
--    produto em outra, e veja o numero mudar sozinho. E o unico jeito de provar
--    que a inscricao ainda recebe evento; o catalogo do sistema so mostra o que
--    foi configurado, nao o que chega no navegador.
-- ---------------------------------------------------------------------------
