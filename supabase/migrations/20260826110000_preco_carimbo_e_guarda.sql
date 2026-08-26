-- ---------------------------------------------------------------------------
-- O SYNC PASSA A CARIMBAR `b2bwave` — E A NAO PISAR NO `local`.
--
-- Cumpre de uma vez os PRE-REQUISITOS 5 e 6 de
-- `20260826100000_preco_com_procedencia.sql`, que criou a coluna `origem` e
-- deixou escrito o que faltava.
--
-- O PROBLEMA QUE ELA RESOLVE, e por que precisa ser no BANCO:
--
--   O sync grava preco com `.upsert(chunk, { onConflict: ... })` — um upsert
--   CEGO. Se ele simplesmente passar a mandar `origem: 'b2bwave'`, o ciclo
--   seguinte regrava `b2bwave` por cima de toda linha que uma pessoa marcou como
--   `local`, e o carimbo humano dura no maximo uma hora. E o `.upsert()` do
--   PostgREST NAO consegue expressar `DO UPDATE ... WHERE origem <> 'local'`.
--
--   Sem carimbar, pior ainda: a coluna nunca sai de `desconhecido` e a triagem
--   nunca converge. Carimbar e proteger tem que acontecer no MESMO statement, e
--   o unico lugar onde isso e possivel e aqui.
--
-- A REGRA, em uma frase: o PRECO da origem sempre vence (regra do espelho); a
-- PROCEDENCIA `local` nunca e revertida por maquina.
--
-- ---------------------------------------------------------------------------
-- POR QUE RPC E NAO TRIGGER
--
-- O outro caminho era um `BEFORE UPDATE` preservando `origem` quando o valor
-- antigo fosse `local`. Funciona, mas transforma `local` em estado ABSORVENTE:
--   * `UPDATE ... SET origem = 'b2bwave'` numa linha `local` vira no-op
--     SILENCIOSO — responde "UPDATE 1" e nao muda nada. Marcar uma linha errada
--     na triagem so se desfaz com DELETE ou desligando o trigger;
--   * vale para TODO escritor, inclusive a mao no SQL editor.
-- A RPC limita o efeito a quem escreve por ela — o sync — e deixa o admin livre
-- para corrigir um carimbo errado com um UPDATE comum. Custa a cobertura de
-- escritores futuros; em troca, nao cria caminho onde um comando responde
-- sucesso sem ter feito nada.
--
-- ---------------------------------------------------------------------------
-- ORDEM: ESTE SQL PRIMEIRO, DEPLOY DA EDGE FUNCTION DEPOIS.
--
-- Invertido, o `b2bwave-sync` chama uma funcao que nao existe e o PostgREST
-- devolve `PGRST202` em TODOS os lotes (sao ~11 para 1015 linhas). O handler NAO
-- para: ele conta os erros, grava rastro, e segue para variantes, relacionados e
-- o bloco de produtos sumidos. O efeito e "nenhum preco atualiza ate o SQL
-- rodar", mas nao ha aborto — dizer que aborta sugeriria uma parada que nao
-- acontece.
--
-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
--   SELECT origem, count(*) FROM public.tabela_preco_itens GROUP BY 1;
--   -- Esperado hoje: uma linha, `desconhecido`.
--
--   SELECT count(*) FROM pg_proc WHERE proname = 'sync_upsert_precos';
--   -- Esperado: 0. Se vier 1, esta migration ja rodou.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sync_upsert_precos(jsonb);
--   Reverter exige tambem voltar a edge function para a versao com `.upsert()`,
--   senao o sync para de gravar preco.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_upsert_precos(_itens jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  -- Lote vazio devolve 0 em vez de estourar. O laco do sync (`i += 100` com
  -- `slice`) NUNCA produz fatia vazia, entao hoje isto nao e alcancavel pelo
  -- chamador — e defesa para o proximo, nao descricao do atual. Uma versao
  -- anterior deste comentario dizia que "o ultimo pode vir vazio", o que era
  -- invencao.
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RETURN 0;
  END IF;

  -- `AS t` NAO e enfeite: sem apelidar o alvo, `t.origem` no CASE da
  -- "missing FROM-clause entry for table t".
  --
  -- `EXCLUDED.preco` no SET e o valor que veio da origem — o preco DELA vence
  -- sempre, inclusive na linha `local`. O que `local` protege e a PROCEDENCIA,
  -- nao o numero: se a origem precifica o par, o numero de la e a verdade.
  --
  -- Na linha NOVA o `origem` vem do INSERT (`'b2bwave'`), nao do CASE — o CASE so
  -- roda no caminho `DO UPDATE`. Por isso o INSERT precisa carimbar explicito.
  INSERT INTO public.tabela_preco_itens AS t (produto_id, tabela_preco_id, preco, origem)
  SELECT (i->>'produto_id')::uuid,
         (i->>'tabela_preco_id')::uuid,
         (i->>'preco')::numeric,
         'b2bwave'
    FROM jsonb_array_elements(_itens) AS i
  ON CONFLICT (tabela_preco_id, produto_id) DO UPDATE
     SET preco  = EXCLUDED.preco,
         origem = CASE WHEN t.origem = 'local' THEN 'local' ELSE 'b2bwave' END;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- So o sync. A tela do admin continua escrevendo direto na tabela (e carimbando
-- `local` por conta propria) — se ela pudesse chamar isto, um clique errado
-- marcaria preco humano como sendo da origem.
REVOKE ALL ON FUNCTION public.sync_upsert_precos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_upsert_precos(jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao existe e so o service_role executa:
--
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'sync_upsert_precos';
--   -- ESPERADO: uma linha, prosecdef = true.
--
--   SELECT has_function_privilege('authenticated',
--            'public.sync_upsert_precos(jsonb)', 'EXECUTE') AS authenticated_pode;
--   -- ESPERADO: false.
--
-- 2) TESTE VIVO, com ROLLBACK — prova as duas metades da regra numa transacao
--    que nao deixa rastro. Troque <PAR_ID> pelo id de uma linha qualquer.
--
--   BEGIN;
--     -- marca uma linha como humana e guarda o preco atual
--     UPDATE public.tabela_preco_itens SET origem = 'local' WHERE id = '<PAR_ID>';
--
--     -- o sync manda um preco novo para esse mesmo par
--     SELECT public.sync_upsert_precos(
--       jsonb_build_array(jsonb_build_object(
--         'produto_id',      (SELECT produto_id::text      FROM public.tabela_preco_itens WHERE id = '<PAR_ID>'),
--         'tabela_preco_id', (SELECT tabela_preco_id::text FROM public.tabela_preco_itens WHERE id = '<PAR_ID>'),
--         'preco',           '999.99')));
--
--     SELECT preco, origem FROM public.tabela_preco_itens WHERE id = '<PAR_ID>';
--     -- ESPERADO: preco = 999.99 (o da origem venceu) E origem = 'local'
--     --           (a procedencia humana sobreviveu). Se `origem` virou
--     --           'b2bwave', a guarda NAO entrou.
--   ROLLBACK;
--
-- 3) O outro lado — linha que NAO e `local` tem que virar `b2bwave`:
--
--   BEGIN;
--     SELECT public.sync_upsert_precos(
--       jsonb_build_array(jsonb_build_object(
--         'produto_id',      (SELECT produto_id::text      FROM public.tabela_preco_itens WHERE id = '<PAR_ID>'),
--         'tabela_preco_id', (SELECT tabela_preco_id::text FROM public.tabela_preco_itens WHERE id = '<PAR_ID>'),
--         'preco',           '888.88')));
--     SELECT preco, origem FROM public.tabela_preco_itens WHERE id = '<PAR_ID>';
--     -- ESPERADO: preco = 888.88 e origem = 'b2bwave'.
--     -- Sem o teste (3), uma funcao que preservasse SEMPRE passaria por
--     -- consertada, e a coluna nunca sairia de `desconhecido`.
--   ROLLBACK;
-- ---------------------------------------------------------------------------
