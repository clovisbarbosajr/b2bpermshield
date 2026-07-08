-- ============================================================================
-- CÓDIGO DE PRODUTO REPETÍVEL (igual ao B2BWave) + base p/ RESTAURAR os códigos.
--
-- Descoberta: no B2BWave original, VÁRIOS produtos compartilham o mesmo código
-- ("Lite - Green Box" em dezenas de itens). O import antigo acrescentava "-87"
-- só pra satisfazer a UNIQUE local. Pra manter 1:1 com o original, a UNIQUE cai.
-- (O casamento do sync já NÃO usa sku — usa b2bwave_id, índice único abaixo.)
--
-- RESTAURAÇÃO dos códigos zerados por engano: rodar o sync de PRODUTOS depois
-- do redeploy — ele repõe o código REAL do B2BWave (sem sufixo) em cada produto.
-- ============================================================================

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_sku_key;
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_sku_unique;
DROP INDEX IF EXISTS public.produtos_sku_key;
DROP INDEX IF EXISTS public.produtos_sku_unique;

-- Garante o índice do casamento por b2bwave_id (caso o passo anterior não tenha rodado).
CREATE UNIQUE INDEX IF NOT EXISTS produtos_b2bwave_id_uidx
  ON public.produtos (b2bwave_id);
