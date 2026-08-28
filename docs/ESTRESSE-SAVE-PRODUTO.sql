-- ===========================================================================
-- TESTE DE ESTRESSE — o caminho de save do produto sob dois admins ao mesmo tempo
--
-- POR QUE ISTO EXISTE: validar codigo por leitura nao acha corrida entre duas
-- escritas. Este script reproduz, na ORDEM EXATA que duas sessoes simultaneas
-- produzem, o que o `saveSubData` faz — DELETE de tudo e INSERT do estado da tela,
-- sem transacao entre os blocos.
--
-- ---------------------------------------------------------------------------
-- SEGURANCA — leia antes de rodar
--
-- 1. TUDO acontece dentro de `BEGIN ... ROLLBACK`. Nada e gravado, nem se um passo
--    falhar no meio. E mais forte que criar-e-apagar: nao existe janela em que o
--    dado de teste esteja visivel para outra sessao nem para o portal.
-- 2. Todo dado de teste leva o prefixo `ZZSTRESS-` em `nome` E `sku`, e nasce com
--    `b2bwave_id IS NULL` e `ativo = false`. Tres condicoes, para que a limpeza do
--    fim NUNCA alcance dado da Jess nem dado vindo do B2BWave.
-- 3. Nao apaga, nao altera e nao desativa NENHUMA linha pre-existente. Todos os
--    UPDATE/DELETE filtram por `id` de linha criada aqui dentro.
--
-- HONESTIDADE SOBRE O QUE ISTO NAO COBRE: e um REPLAY DETERMINISTICO da corrida,
-- nao paralelismo real. Uma sessao so. `dblink` exigiria senha, e senha nao entra
-- aqui. Isto prova que a SEQUENCIA destroi dado; nao prova com que frequencia a
-- sequencia acontece, e nao exercita lock nem deadlock.
-- ===========================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE zz_resultado (
  ordem     int,
  teste     text,
  esperado  text,
  obtido    text,
  veredito  text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- PARTE 1 — A PAGINACAO ERA MESMO NECESSARIA? (so leitura)
--
-- As correcoes desta sessao trocaram leitura direta por paginada em cinco lugares.
-- Isto mede se as tabelas realmente passam (ou se aproximam) do corte de 1000 do
-- PostgREST. Numero, nao opiniao.
-- ---------------------------------------------------------------------------
INSERT INTO zz_resultado
SELECT 0, 'volume: ' || t, '< 1000 = ainda folgado', n::text,
       CASE WHEN n >= 1000 THEN 'JA ESTOURA — paginacao era obrigatoria'
            WHEN n >= 800  THEN 'perto do teto'
            ELSE 'folgado por enquanto' END
  FROM (VALUES
    ('produtos ativos',          (SELECT count(*) FROM public.produtos WHERE ativo)),
    ('clientes',                 (SELECT count(*) FROM public.clientes)),
    ('pedidos',                  (SELECT count(*) FROM public.pedidos)),
    ('cliente_privacy_groups',   (SELECT count(*) FROM public.cliente_privacy_groups)),
    ('tabela_preco_itens',       (SELECT count(*) FROM public.tabela_preco_itens)),
    ('produto_cliente_acesso',   (SELECT count(*) FROM public.produto_cliente_acesso)),
    ('produto_precos_cliente',   (SELECT count(*) FROM public.produto_precos_cliente))
  ) AS v(t, n);

-- ---------------------------------------------------------------------------
-- PARTE 2 — CENARIO. Um produto de teste e duas tabelas de preco de teste.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE zz_ids (chave text PRIMARY KEY, id uuid) ON COMMIT DROP;

WITH novo AS (
  INSERT INTO public.produtos (nome, sku, preco, ativo, estoque_total, quantidade_minima)
  VALUES ('ZZSTRESS-produto-corrida', 'ZZSTRESS-SKU-1', 10.00, false, 0, 1)
  RETURNING id
)
INSERT INTO zz_ids SELECT 'produto', id FROM novo;

WITH novo AS (
  INSERT INTO public.tabelas_preco (nome, ativo, is_default)
  VALUES ('ZZSTRESS-tabela-A', false, false) RETURNING id
)
INSERT INTO zz_ids SELECT 'tabelaA', id FROM novo;

WITH novo AS (
  INSERT INTO public.tabelas_preco (nome, ativo, is_default)
  VALUES ('ZZSTRESS-tabela-B', false, false) RETURNING id
)
INSERT INTO zz_ids SELECT 'tabelaB', id FROM novo;

-- ---------------------------------------------------------------------------
-- TESTE 1 — GALERIA: dois admins salvam o mesmo produto.
--
-- `saveSubData` faz `delOrFail("produto_imagens")` e depois insere o que esta na
-- tela. Admin A e B abrem a mesma ficha. A sobe 3 imagens e salva. B, com a tela
-- carregada ANTES, salva qualquer outra coisa.
-- ---------------------------------------------------------------------------
DO $$
DECLARE p uuid := (SELECT id FROM zz_ids WHERE chave = 'produto');
BEGIN
  -- Estado inicial: 2 imagens ja cadastradas (o que os dois veem ao abrir).
  INSERT INTO public.produto_imagens (produto_id, imagem_url, ordem)
  VALUES (p, 'inicial-1.jpg', 1), (p, 'inicial-2.jpg', 2);

  -- ADMIN A salva: apaga tudo e grava as 3 dele.
  DELETE FROM public.produto_imagens WHERE produto_id = p;
  INSERT INTO public.produto_imagens (produto_id, imagem_url, ordem)
  VALUES (p, 'A-1.jpg', 1), (p, 'A-2.jpg', 2), (p, 'A-3.jpg', 3);

  -- ADMIN B salva com o estado que ele carregou ANTES de A salvar: as 2 iniciais.
  -- A tela dele nunca soube das 3 de A.
  DELETE FROM public.produto_imagens WHERE produto_id = p;
  INSERT INTO public.produto_imagens (produto_id, imagem_url, ordem)
  VALUES (p, 'inicial-1.jpg', 1), (p, 'inicial-2.jpg', 2);
END $$;

INSERT INTO zz_resultado
SELECT 1, 'galeria: A sobe 3 imagens, B salva com tela velha',
       'as 3 imagens de A sobrevivem',
       'sobraram ' || count(*) || ' imagens, nenhuma de A: '
         || coalesce(string_agg(imagem_url, ', ' ORDER BY ordem), '(vazio)'),
       CASE WHEN count(*) FILTER (WHERE imagem_url LIKE 'A-%') = 0
            THEN 'PERDA CONFIRMADA — o trabalho de A sumiu e os dois viram "Product saved"'
            ELSE 'sobreviveu' END
  FROM public.produto_imagens
 WHERE produto_id = (SELECT id FROM zz_ids WHERE chave = 'produto');

-- ---------------------------------------------------------------------------
-- TESTE 2 — PRECO: o bloco que eu mexi nesta sessao.
--
-- O bloco de preco NAO e delete-tudo: ele apaga so o que saiu do snapshot e faz
-- upsert do que ficou "sujo". A corrida e outra — A REMOVE a tabela B da tela e
-- salva; enquanto isso o admin B ALTERA o preco da mesma tabela e salva.
-- ---------------------------------------------------------------------------
DO $$
DECLARE p uuid := (SELECT id FROM zz_ids WHERE chave = 'produto');
        tb uuid := (SELECT id FROM zz_ids WHERE chave = 'tabelaB');
BEGIN
  -- Estado inicial: produto precificado na tabela B.
  INSERT INTO public.tabela_preco_itens (produto_id, tabela_preco_id, preco, origem)
  VALUES (p, tb, 100.00, 'local');

  -- ADMIN A: tirou a linha da tela e salvou -> DELETE do que saiu do snapshot.
  DELETE FROM public.tabela_preco_itens WHERE produto_id = p AND tabela_preco_id = tb;

  -- ADMIN B: mudou o preco para 80 e salvou -> upsert da linha "suja".
  INSERT INTO public.tabela_preco_itens (produto_id, tabela_preco_id, preco, origem)
  VALUES (p, tb, 80.00, 'local')
  ON CONFLICT (tabela_preco_id, produto_id) DO UPDATE SET preco = EXCLUDED.preco;
END $$;

INSERT INTO zz_resultado
SELECT 2, 'preco: A remove a linha, B altera o preco da mesma linha',
       'a tela de A e o banco concordam',
       CASE WHEN count(*) = 0 THEN 'linha apagada'
            ELSE 'linha VIVA a ' || max(preco)::text END,
       CASE WHEN count(*) > 0
            THEN 'DIVERGENCIA — A ve o produto sem preco nessa tabela, o banco tem preco'
            ELSE 'sem divergencia' END
  FROM public.tabela_preco_itens
 WHERE produto_id = (SELECT id FROM zz_ids WHERE chave = 'produto')
   AND tabela_preco_id = (SELECT id FROM zz_ids WHERE chave = 'tabelaB');

-- ---------------------------------------------------------------------------
-- TESTE 3 — VARIANTE: o `.eq("produto_id", pid)` que eu adicionei.
--
-- Duas metades:
--   (a) a corrida — A cria a variante V; B, com a tela carregada antes, salva. V
--       nao esta no `idsNaTela` de B, entao o bloco de variantes a DELETA;
--   (b) a guarda nova — um UPDATE com id de variante de OUTRO produto tem que
--       atingir ZERO linhas em vez de gravar no produto errado.
-- ---------------------------------------------------------------------------
WITH novo AS (
  INSERT INTO public.produtos (nome, sku, preco, ativo, estoque_total, quantidade_minima)
  VALUES ('ZZSTRESS-produto-vizinho', 'ZZSTRESS-SKU-2', 20.00, false, 0, 1)
  RETURNING id
)
INSERT INTO zz_ids SELECT 'produto2', id FROM novo;

DO $$
DECLARE p  uuid := (SELECT id FROM zz_ids WHERE chave = 'produto');
        p2 uuid := (SELECT id FROM zz_ids WHERE chave = 'produto2');
        v_a uuid;
        v_vizinha uuid;
        n int;
BEGIN
  -- Variante do produto VIZINHO, para a metade (b).
  INSERT INTO public.produto_variantes (produto_id, codigo, quantidade)
  VALUES (p2, 'ZZSTRESS-VAR-VIZINHA', 50) RETURNING id INTO v_vizinha;

  -- (a) ADMIN A cria a variante V.
  INSERT INTO public.produto_variantes (produto_id, codigo, quantidade)
  VALUES (p, 'ZZSTRESS-VAR-A', 10) RETURNING id INTO v_a;

  -- ADMIN B salva com a tela carregada ANTES: para ele nao ha variante nenhuma,
  -- entao TUDO que existe no banco "sumiu da tela" e e apagado.
  DELETE FROM public.produto_variantes WHERE produto_id = p;

  -- (b) A GUARDA. Simula o UPDATE do save com um id que nao pertence a este
  -- produto. Com `.eq("produto_id", pid)` junto, tem que casar ZERO linhas.
  UPDATE public.produto_variantes
     SET quantidade = 999
   WHERE id = v_vizinha AND produto_id = p;   -- <- o par que eu adicionei
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO zz_resultado VALUES (
    4, 'guarda de variante: UPDATE com id de outro produto',
    '0 linhas atingidas',
    n || ' linha(s) atingida(s)',
    CASE WHEN n = 0 THEN 'GUARDA FUNCIONA — sem ela o UPDATE gravaria no produto vizinho'
         ELSE 'GUARDA FALHOU' END);

  -- Confirma que a variante do vizinho ficou intacta.
  INSERT INTO zz_resultado
  SELECT 5, 'variante do produto vizinho ficou intacta', 'quantidade = 50',
         'quantidade = ' || quantidade::text,
         CASE WHEN quantidade = 50 THEN 'intacta' ELSE 'ALTERADA — o par nao protegeu' END
    FROM public.produto_variantes WHERE id = v_vizinha;
END $$;

INSERT INTO zz_resultado
SELECT 3, 'variante: A cria a variante, B salva com tela velha',
       'a variante de A sobrevive',
       'sobraram ' || count(*) || ' variantes',
       CASE WHEN count(*) = 0
            THEN 'PERDA CONFIRMADA — a variante de A foi apagada por um save que nunca a viu'
            ELSE 'sobreviveu' END
  FROM public.produto_variantes
 WHERE produto_id = (SELECT id FROM zz_ids WHERE chave = 'produto');

-- ---------------------------------------------------------------------------
-- TESTE 6 — a RPC de preco preserva `origem = 'local'`? (regra do espelho)
-- ---------------------------------------------------------------------------
-- `EXCEPTION` aqui, e nao nos outros blocos: esta e a unica chamada que depende de
-- PERMISSAO (`sync_upsert_precos` e SECURITY DEFINER com EXECUTE so para
-- service_role). Se o editor rodar com outro papel, o erro viraria abort da
-- transacao inteira e voce perderia o relatorio dos outros cinco testes.
DO $$
DECLARE p uuid := (SELECT id FROM zz_ids WHERE chave = 'produto');
        ta uuid := (SELECT id FROM zz_ids WHERE chave = 'tabelaA');
BEGIN
  INSERT INTO public.tabela_preco_itens (produto_id, tabela_preco_id, preco, origem)
  VALUES (p, ta, 100.00, 'local');

  BEGIN
    PERFORM public.sync_upsert_precos(jsonb_build_array(jsonb_build_object(
      'produto_id', p::text, 'tabela_preco_id', ta::text, 'preco', '55.55')));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO zz_resultado VALUES (
      6, 'sync grava por cima de preco marcado como local',
      'preco 55.55 e origem ainda local',
      'nao consegui chamar a RPC: ' || SQLERRM,
      'NAO TESTADO — provavelmente papel sem EXECUTE, nao e defeito da regra');
    RETURN;
  END;

  INSERT INTO zz_resultado
  SELECT 6, 'sync grava por cima de preco marcado como local',
         'preco 55.55 (origem vence) e origem ainda local (carimbo humano sobrevive)',
         'preco ' || preco::text || ', origem ' || origem,
         CASE WHEN preco = 55.55 AND origem = 'local' THEN 'REGRA OK'
              ELSE 'REGRA QUEBRADA' END
    FROM public.tabela_preco_itens
   WHERE produto_id = p AND tabela_preco_id = ta;
END $$;

-- ---------------------------------------------------------------------------
-- RELATORIO
-- ---------------------------------------------------------------------------
SELECT ordem, teste, esperado, obtido, veredito
  FROM zz_resultado ORDER BY ordem, teste;

-- ===========================================================================
-- NADA E GRAVADO. Tudo acima morre aqui.
-- ===========================================================================
ROLLBACK;
