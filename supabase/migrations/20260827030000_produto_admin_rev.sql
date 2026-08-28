-- ---------------------------------------------------------------------------
-- `produtos.admin_rev` — o token do bloqueio otimista da tela de produto.
--
-- O QUE ELE IMPEDE, medido contra o banco em 27/ago/2026
-- (`docs/ESTRESSE-SAVE-PRODUTO.sql`, testes 1, 2 e 3): dois admins com a mesma
-- ficha aberta, o segundo a salvar APAGA o trabalho do primeiro. O `saveSubData`
-- toca onze tabelas filhas e em NOVE delas faz DELETE + INSERT a partir do estado
-- da TELA, entao quem salva por ultimo regrava essas nove com um retrato velho.
--
-- As outras duas ja tinham sido tiradas desse padrao por destruirem dado, e NAO
-- devem voltar a ele: `tabela_preco_itens` (apaga so o que saiu do snapshot e faz
-- upsert, para nao lavar `origem`) e `produto_variantes` (casa por `id`, para nao
-- zerar `pedido_itens.variante_id` a cada save). As duas perdem dado pela corrida
-- assim mesmo, por outro caminho — a variante nova do colega cai em `varObsoletas`
-- e e apagada (levando `pedido_itens.variante_id` junto, por cascata), e o preco
-- apagado reaparece quando o segundo admin editou o valor.
--
-- Nos onze casos os dois admins leem "Product saved".
--
-- COMO: o save manda `.eq("admin_rev", <valor que a tela carregou>)` junto do
-- `.eq("id", ...)` e incrementa a coluna. Se alguem gravou no meio, o UPDATE casa
-- ZERO linhas e a tela recusa ANTES do `saveSubData` — que e quem destroi.
--
-- ---------------------------------------------------------------------------
-- POR QUE COLUNA NOVA E NAO `updated_at`, QUE JA EXISTE
--
-- Tentei `updated_at` primeiro. Nao serve, por dois motivos que so aparecem
-- quando se olha quem mais escreve nela:
--
--   1. FALSO POSITIVO. O trigger `update_produtos_updated_at` nao tem lista de
--      coluna e carimba em QUALQUER escrita — inclusive
--      `UPDATE produtos SET estoque_reservado = ...`, que roda a cada item de
--      pedido. Um cliente comprando o produto enquanto o admin edita faria o save
--      do admin ser recusado com "alguem salvou antes de voce". Mentira, e
--      frequente numa loja viva: `estoque_reservado` nem esta no payload da tela.
--
--   2. FALSO NEGATIVO, e este e pior. Tentei consertar (1) fazendo o trigger
--      comparar a linha e so carimbar quando o dado mudasse. Isso DESLIGA o
--      bloqueio justamente no caso que ele existe para cobrir: save que so mexe em
--      galeria, variante ou preco nao altera nenhuma coluna de `produtos`, o
--      carimbo nao anda, o token do outro admin continua casando, e a perda dos
--      testes 1/2/3 volta inteira.
--
-- `admin_rev` nao tem nenhum dos dois porque significa UMA coisa so: "a tela do
-- admin gravou este produto". Nenhum outro escritor toca nela.
--
-- E NAO E CONTORNO PARA O SYNC. O sync do B2BWave e temporario e vai sair do
-- menu; esta coluna continua correta depois disso. Ela sobrevive ao sync por
-- consequencia, nao por desenho: o upsert do PostgREST so grava as colunas que
-- envia, e o sync nunca vai enviar esta.
--
-- ---------------------------------------------------------------------------
-- CUSTO: `ADD COLUMN ... NOT NULL DEFAULT` e O(1) desde o PG11 (`attmissingval`):
-- nao reescreve a tabela, nao trava a leitura. Nenhuma linha e alterada.
--
-- DIAGNOSTICO — rode ANTES:
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produtos'
--      AND column_name = 'admin_rev';
--   -- Esperado: 0. Se vier 1, esta migration ja rodou.
--
-- ORDEM: ESTE SQL PRIMEIRO, PUBLISH DEPOIS. Invertido, a tela de produto para de
-- salvar por completo — e NAO com o erro que se esperaria:
--
--   ficha existente: o `fetchProduct` le `admin_rev` como `undefined`, o token
--   nasce `null` e o `handleSave` sai na guarda de token ausente. O
--   `.eq("admin_rev", ...)` nunca chega a ser enviado, entao nao ha `PGRST204` no
--   log — so o toast "this product's version is unknown", mandando recarregar num
--   laco que nao resolve;
--   ficha nova: quebra no `.select("id, admin_rev")` do INSERT.
--
-- Fica escrito porque quem for depurar a ordem invertida vai procurar um codigo de
-- erro que nao existe.
--
-- ROLLBACK:
--   ALTER TABLE public.produtos DROP COLUMN IF EXISTS admin_rev;
--   Exige voltar o front junto: sem a coluna, a tela para de salvar como descrito
--   na secao ORDEM.
--   Reverter devolve a perda por escrita concorrente que os testes mediram.
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS admin_rev integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.produtos.admin_rev IS
  'Bloqueio otimista da tela de produto. So o save do admin incrementa; o sync, a '
  'reserva de estoque e qualquer outro escritor NAO tocam. Ver '
  'supabase/migrations/20260827030000_produto_admin_rev.sql';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A coluna existe, e NOT NULL e comeca em 0 para todo mundo:
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produtos'
--      AND column_name = 'admin_rev';
--   -- ESPERADO: integer, NO, 0.
--
--   SELECT count(*) AS fora_do_zero FROM public.produtos WHERE admin_rev <> 0;
--   -- ESPERADO: 0.
--
-- 2) A GUARDA MORDE — as duas metades. Sem a segunda, uma coluna que nunca
--    incrementa passaria por instalada e o bloqueio nao existiria.
--
--    A LINHA DE TESTE NASCE AQUI DENTRO, nao e sorteada do catalogo. O `ROLLBACK`
--    ja protegeria, mas so enquanto ele acontecer: uma sessao derrubada no meio
--    deixaria `estoque_reservado` de um produto REAL somado de 1 — estoque
--    corrompido em silencio, e ninguem saberia qual produto foi. Criando a linha,
--    o pior caso e um produto inativo com prefixo visivel, facil de achar e apagar.
--
--   BEGIN;
--     CREATE TEMP TABLE alvo AS
--     WITH novo AS (
--       INSERT INTO public.produtos (nome, sku, preco, ativo, estoque_total, quantidade_minima)
--       VALUES ('ZZVERIF-admin-rev', 'ZZVERIF-SKU', 1.00, false, 0, 1)
--       RETURNING id, admin_rev
--     ) SELECT id, admin_rev FROM novo;
--
--     -- (a) token em dia grava
--     UPDATE public.produtos p SET admin_rev = p.admin_rev + 1
--       FROM alvo a WHERE p.id = a.id AND p.admin_rev = a.admin_rev;
--     -- ESPERADO: UPDATE 1.
--
--     -- (b) token velho (o mesmo de antes) e recusado
--     UPDATE public.produtos p SET admin_rev = p.admin_rev + 1
--       FROM alvo a WHERE p.id = a.id AND p.admin_rev = a.admin_rev;
--     -- ESPERADO: UPDATE 0.
--
--     -- (c) reserva de estoque NAO mexe no token — e o falso positivo que este
--     --     desenho existe para nao ter
--     UPDATE public.produtos p SET estoque_reservado = p.estoque_reservado + 1
--       FROM alvo a WHERE p.id = a.id;
--     SELECT (p.admin_rev = a.admin_rev + 1) AS reserva_nao_mexeu_no_token
--       FROM public.produtos p JOIN alvo a ON a.id = p.id;
--     -- ESPERADO: true (continua no valor que o passo (a) deixou).
--   ROLLBACK;
-- ---------------------------------------------------------------------------
