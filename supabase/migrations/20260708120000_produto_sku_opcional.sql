-- ============================================================================
-- CÓDIGO DE PRODUTO OPCIONAL (igual ao B2BWave original).
-- produtos.sku era NOT NULL UNIQUE — por isso a tela exigia "Code" e o
-- sync/import inventava códigos únicos ("b2b-123", sufixos "-87") pra
-- satisfazer a constraint. Agora o código pode ficar VAZIO (NULL).
--
-- A UNIQUE fica: Postgres permite VÁRIOS NULLs numa unique — códigos, quando
-- preenchidos, continuam não podendo repetir (igual B2BWave).
--
-- ATENÇÃO (limpeza dos códigos gerados): o sync diferencial do B2BWave casa
-- produtos por SKU (upsert onConflict "sku"). NÃO limpar os códigos existentes
-- enquanto o sync ainda for rodar — limpar antes do sync final DUPLICARIA os
-- produtos. Depois do corte (B2BWave desligado), rodar a limpeza:
--   UPDATE public.produtos SET sku = NULL WHERE sku LIKE 'b2b-%';
-- (e, se quiserem zerar também os demais códigos herdados, avaliar caso a caso.)
-- ============================================================================

ALTER TABLE public.produtos ALTER COLUMN sku DROP NOT NULL;
