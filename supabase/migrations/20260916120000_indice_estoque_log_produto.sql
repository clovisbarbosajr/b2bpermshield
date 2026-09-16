-- Indice em `estoque_log (produto_id, created_at)`.
--
-- `estoque_log.produto_id` nasceu (20260317043654:145-152) como FK
-- `ON DELETE CASCADE` SEM indice — o Postgres nao cria indice em FK sozinho.
-- Com ~1 milhao de linhas de historico, tudo que filtra por produto vira
-- varredura completa da tabela:
--   * `/admin/products` -> Delete: o confirm conta `estoque_log` por produto
--     (Produtos.tsx, `contar("estoque_log")`) e estoura o statement_timeout
--     antes de perguntar. A guarda fail-closed recusa — certo — e o admin
--     fica sem conseguir apagar.
--   * o proprio CASCADE do DELETE varre a tabela de novo (o trigger de RI faz
--     `SELECT ... WHERE produto_id = $1` e depois `DELETE ... WHERE produto_id = $1`).
--   * `/admin/inventory` (Estoque.tsx) le os 10 ultimos movimentos por produto
--     com `eq(produto_id) + order(created_at desc) limit 10` — mesma varredura.
--
-- `(produto_id, created_at)` e nao so `(produto_id)`: mesmo custo de criacao,
-- serve igual ao count e ao CASCADE (produto_id e a coluna lider) e ainda
-- atende o top-10 por data sem ordenar. Sem DESC: b-tree anda para tras.
--
-- SEM `CONCURRENTLY`: o editor SQL do Lovable roda o script numa transacao
-- unica e `CREATE INDEX CONCURRENTLY` nao pode rodar dentro de transacao.
-- O `CREATE INDEX` normal segura INSERT/UPDATE/DELETE em `estoque_log`
-- durante a construcao (segundos para 1M linhas); os triggers de estoque
-- esperam, nao falham. Rodar fora do horario de pico.

SET LOCAL statement_timeout = 0;

CREATE INDEX IF NOT EXISTS estoque_log_produto_id_idx
  ON public.estoque_log (produto_id, created_at);

-- VERIFICACAO. `indice_ok` tem que ser 1.
SELECT count(*) AS indice_ok
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'estoque_log_produto_id_idx';

-- ROLLBACK
-- DROP INDEX IF EXISTS public.estoque_log_produto_id_idx;
