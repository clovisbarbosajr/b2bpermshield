-- ---------------------------------------------------------------------------
-- CATEGORIA DUPLICADA: junta as copias e impede que voltem.
--
-- O QUE ACONTECEU: `sync_categories` casa a categoria local com a da origem por
-- `b2bwave_id`. O banco devolve essa coluna como NUMERO (`integer`), a API manda
-- o `id` como TEXTO — e em JavaScript `map.get("11")` nao acha `map.set(11)`.
-- Nenhum match, entao TODA rodada inseria o catalogo de categorias inteiro de
-- novo. O `sync_products` deste mesmo arquivo ja normalizava com `String()`; o de
-- categorias nao. Medido: `b2bwave_id` 11 com 4 linhas, 30 com 4, 5 com 4.
--
-- DUAS METADES, e a segunda e a que importa: o conserto no codigo (`String()` nos
-- dois lados) para de criar novas, mas so o indice UNICO daqui torna a classe
-- inteira impossivel — inclusive para o proximo escritor que ninguem previu.
-- Sem o indice, um erro de tipo silencioso volta a duplicar sem ninguem ver.
--
-- ORDEM: este SQL PRIMEIRO. Com o indice no ar e o codigo velho, o sync passa a
-- ERRAR alto (`23505`) em vez de duplicar calado — que ja e melhor. Com o codigo
-- novo e sem o indice, para de duplicar mas nada garante isso amanha.
--
-- ---------------------------------------------------------------------------
-- BACKUP — rode ANTES. As tres linhas juntas: `CREATE TABLE AS` nao herda RLS
-- nem grant, e tabela nova em `public` e servida pelo PostgREST.
--
--   CREATE TABLE IF NOT EXISTS public.backup_categorias_20260827 AS
--     SELECT * FROM public.categorias;
--   ALTER TABLE public.backup_categorias_20260827 ENABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON public.backup_categorias_20260827 FROM anon, authenticated;
--   SELECT count(*) FROM public.backup_categorias_20260827;
--
-- DIAGNOSTICO — guarde:
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE b2bwave_id IS NOT NULL) AS com_id,
--          count(DISTINCT b2bwave_id) AS ids_distintos
--     FROM public.categorias;
--   -- `com_id` muito maior que `ids_distintos` = a duplicacao medida.
--
-- ROLLBACK: nao ha. Isto APAGA linhas duplicadas depois de repontar as
-- referencias. O backup acima e a unica volta, e restaurar exige decidir o que
-- fazer com os produtos ja repontados. Por isso o backup nao e opcional.
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) Quem fica: a linha MAIS ANTIGA de cada `b2bwave_id`. E a que os produtos
--    provavelmente ja apontam, entao repontar mexe no menor numero de linhas.
CREATE TEMP TABLE cat_canonica ON COMMIT DROP AS
SELECT DISTINCT ON (b2bwave_id) b2bwave_id, id AS id_bom
  FROM public.categorias
 WHERE b2bwave_id IS NOT NULL
 ORDER BY b2bwave_id, created_at, id;

CREATE TEMP TABLE cat_troca ON COMMIT DROP AS
SELECT c.id AS id_ruim, k.id_bom
  FROM public.categorias c
  JOIN cat_canonica k ON k.b2bwave_id = c.b2bwave_id
 WHERE c.id <> k.id_bom;

-- 2) Reponta TODAS as referencias, descobrindo-as no catalogo em vez de manter
--    uma lista a mao. Sao pelo menos sete tabelas hoje (`produtos`, o
--    `parent_id` da propria `categorias`, locais de usuario, privacidade...) e
--    uma lista escrita a mao envelhece calada: a tabela que alguem criar amanha
--    ficaria de fora, e as linhas dela apontariam para uma categoria apagada.
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tabela, a.attname AS coluna
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.categorias'::regclass
       AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'UPDATE %s t SET %I = x.id_bom FROM cat_troca x WHERE t.%I = x.id_ruim',
      r.tabela, r.coluna, r.coluna);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE 'repontado: %.% -> % linhas', r.tabela, r.coluna, n;
  END LOOP;
  RAISE NOTICE 'total repontado: % linhas', total;
END $$;

-- 3) Agora as duplicadas nao sao mais referenciadas por ninguem.
DELETE FROM public.categorias c USING cat_troca x WHERE c.id = x.id_ruim;

-- 4) A trava. PARCIAL porque categoria nativa do app (sem `b2bwave_id`) e
--    legitima e pode existir varias vezes — o UNICO que precisa ser unico e o
--    espelho da origem.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_b2bwave_id_unico
  ON public.categorias (b2bwave_id)
  WHERE b2bwave_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Nao sobrou duplicata, e o indice existe:
--
--   SELECT count(*) AS total,
--          count(DISTINCT b2bwave_id) FILTER (WHERE b2bwave_id IS NOT NULL) AS ids_distintos,
--          count(*) FILTER (WHERE b2bwave_id IS NOT NULL) AS com_id
--     FROM public.categorias;
--   -- ESPERADO: `com_id` = `ids_distintos`.
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'categorias' AND indexname = 'idx_categorias_b2bwave_id_unico';
--   -- ESPERADO: uma linha.
--
-- 2) Nenhum produto ficou orfao (a FK e `ON DELETE SET NULL`, entao um repoint
--    que falhasse apareceria como categoria nula onde antes havia uma):
--
--   SELECT count(*) AS produtos_sem_categoria
--     FROM public.produtos WHERE categoria_id IS NULL AND ativo;
--   -- Compare com o numero de ANTES. Se subiu, o repoint deixou algo para tras.
--
-- 3) A trava morde de verdade — sem isto, um indice que nao entrou passaria por
--    instalado:
--
--   BEGIN;
--     INSERT INTO public.categorias (nome, b2bwave_id)
--     SELECT 'teste duplicata', b2bwave_id FROM public.categorias
--      WHERE b2bwave_id IS NOT NULL LIMIT 1;
--   ROLLBACK;
--   -- ESPERADO: erro 23505. Se inserir, o indice NAO entrou.
-- ---------------------------------------------------------------------------
