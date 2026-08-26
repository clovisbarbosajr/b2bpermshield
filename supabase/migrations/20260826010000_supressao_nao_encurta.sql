-- ============================================================================
-- A SUPRESSAO DE NOTIFICACAO PARA DE SER ENCURTADA POR QUEM NAO A LIGOU
--
-- Achado do cetico (26/ago), cenario E. Hoje `cron_orders` faz:
--
--     suprimirNotificacao(true, 20)   -- comeco
--     ...reconcilia pedidos...
--     finally { suprimirNotificacao(false) }   -- INCONDICIONAL
--
-- A tela do admin chama isso em LACO, e o pg_cron chama a MESMA acao a cada 15
-- minutos. Se um tick manual terminar no meio de um tick automatico, o `finally`
-- do manual DESLIGA a supressao do automatico — que segue reconciliando status
-- sem protecao nenhuma.
--
-- Hoje isso nao vaza porque `trg_order_status_notify` esta DESABILITADO. No
-- momento em que ele for religado, vaza. E religa-lo e justamente o que o dono
-- quer poder fazer com seguranca.
--
-- O CONSERTO: contagem de referencia. Cada lote INCREMENTA ao entrar e
-- DECREMENTA ao sair; a supressao vale enquanto houver lote vivo. Ninguem
-- desliga a protecao de ninguem.
--
-- Auto-cura: se um lote morrer sem decrementar, o contador vazaria e o sistema
-- ficaria mudo PARA SEMPRE. O reset olha TEMPO ABSOLUTO desde o primeiro
-- incremento (`desde`), com teto de 2 horas.
--
-- Nao adianta olhar a janela `ate`: o pg_cron roda a cada 15 minutos e cada tick
-- pede 20, entao a janela e empurrada para a frente indefinidamente e nunca
-- vence. Foi assim na primeira versao desta migration — o cetico pegou.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================
--
-- O QUE ESTA MIGRATION *NAO* FAZ, E POR QUE (registro de decisao)
--
-- A primeira versao tambem mudava `pausar_envios` para exigir admin logado ao
-- LIBERAR — fechando o furo de `auth.uid() IS NOT NULL AND NOT admin`, que
-- deixa passar quem chama com a service key.
--
-- Desisti, e o motivo importa: o dono acessa o banco pelo editor de SQL do
-- Lovable, onde `auth.uid()` e NULL. A torneira esta FECHADA desde
-- 20260825180000:388. Aquela regra teria trancado a unica porta de reabertura
-- que sempre funciona, para fechar um furo que HOJE nenhum codigo explora
-- (nenhum arquivo do repositorio chama `pausar_envios`).
--
-- Trocar um risco latente por um travamento certo e um mau negocio. Fica como
-- divida registrada; o caminho certo e a checagem distinguir "service key" de
-- "sessao sem papel", o que o PostgREST nao entrega hoje.
--
-- (A primeira versao tambem QUEBRAVA: `CREATE OR REPLACE FUNCTION` nao renomeia
--  parametro de entrada nem troca tipo de retorno — `pausar_envios(_pausar
--  boolean) RETURNS text` viraria `(_on boolean) RETURNS void`. Postgres devolve
--  42P13 e, como tudo esta num BEGIN/COMMIT, a transacao INTEIRA abortaria: nem
--  a contagem de referencia abaixo teria sido aplicada.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Estado atual da chave. Ela ganha o campo `n`; o resto do formato nao muda.
--
--   SELECT key, value FROM public.sync_state WHERE key = 'suppress_order_notify';
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.set_suppress_order_notify(_on boolean, _minutos integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ate   timestamptz;
  _desde timestamptz;
  _n     integer;
  _novo  integer;
  _min   integer;
BEGIN
  -- Quem pode: service_role (o sync, `auth.uid()` NULL) e staff logado (a
  -- ferramenta de lote da tela). LIGAR e sempre permitido para esses — ligar so
  -- protege. Cliente comum leva erro: o cadastro e ABERTO, e sem esta linha
  -- qualquer conta calaria as notificacoes do sistema inteiro.
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_role(auth.uid(), 'manager'::app_role)
              OR public.has_role(auth.uid(), 'warehouse'::app_role)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- TETO NA JANELA. Sem isto, `manager`/`warehouse` — que acabaram de ganhar
  -- EXECUTE — poderiam calar o gatilho por 100 anos com um numero grande, e a
  -- supressao nao aparece em tela nenhuma. Duas horas cobre qualquer lote real.
  _min := LEAST(GREATEST(COALESCE(_minutos, 30), 1), 120);

  -- `FOR UPDATE`: `SELECT` e depois `INSERT ... ON CONFLICT` NAO e atomico em
  -- READ COMMITTED. Dois lotes entrando junto liam `n = 0`, os dois calculavam
  -- 1, e um sobrescrevia o outro — o contador diria 1 com DOIS lotes vivos, e o
  -- primeiro a sair desligaria a protecao do outro. Seria o mesmo defeito que
  -- esta migration existe para consertar, so que mais dificil de ver.
  -- A linha PRECISA existir para o `FOR UPDATE` travar alguma coisa: em tabela
  -- sem a linha, `SELECT ... FOR UPDATE` nao trava nada e a corrida volta. Ela
  -- existe desde 20260825180000:28, mas uma limpeza de `sync_state` a levaria
  -- junto — e o modo de falha seria silencioso.
  INSERT INTO public.sync_state (key, value)
  VALUES ('suppress_order_notify', jsonb_build_object('on', false, 'ate', NULL, 'n', 0))
  ON CONFLICT (key) DO NOTHING;

  SELECT COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz),
         (value->>'desde')::timestamptz,
         COALESCE((value->>'n')::integer, 0)
    INTO _ate, _desde, _n
  FROM public.sync_state WHERE key = 'suppress_order_notify'
  FOR UPDATE;

  _ate := COALESCE(_ate, '-infinity'::timestamptz);
  _n   := COALESCE(_n, 0);

  IF _on THEN
    -- RESET POR TEMPO ABSOLUTO, nao pela janela.
    --
    -- A primeira versao resetava quando `ate <= now()`. Nao funcionava: o
    -- pg_cron roda `cron_orders` a cada 15 MINUTOS e cada tick pede janela de
    -- 20, entao o `GREATEST` empurrava `ate` para sempre a frente e a janela
    -- nunca vencia. Um contador orfao — lote que morreu sem decrementar —
    -- ficaria preso, `on = true` PARA SEMPRE, e toda mudanca de status sairia
    -- calada sem nada na tela. Exatamente o nao-envio invisivel que este
    -- projeto combate; eu ia introduzir um.
    --
    -- `desde` marca o PRIMEIRO incremento da sequencia. Nenhum tick posterior
    -- o empurra, entao o teto de 2 horas vale de verdade.
    -- SO o teto absoluto reseta. A versao anterior tinha `WHEN _ate <= now()`
    -- como primeiro ramo, e isso nao cobria so o caso orfao: disparava sempre
    -- que a maior janela pedida tivesse vencido, INCLUSIVE com lote vivo. Um
    -- lote que pede 10 minutos (b2bwave-sync usa 10 em dois pontos) e demora 14
    -- perdia a protecao no minuto 12, quando outro lote entrasse e zerasse o
    -- contador — o defeito que esta migration existe para consertar, voltando
    -- pela porta da janela curta.
    --
    -- Nao cria mudez permanente: `n = 0` sempre vem com `desde` nulo (o ramo
    -- ELSE zera os dois juntos), e contador orfao e pego pelo teto de 2 horas.
    --
    -- ATENCAO: por si so, `n` NAO protege nada. Quem decide e
    -- `fn_order_status_notify`, e ate 20260826080000 ele olhava apenas
    -- `ate > now()` — entao a supressao morria no fim da janela mesmo com lote
    -- vivo, e esta contagem toda era decorativa. E 20260826080000 que faz o
    -- leitor olhar `n` e `desde`. As duas andam juntas.
    _novo := CASE
               WHEN _desde IS NULL THEN 1                            -- linha legada, ou nenhum lote vivo
               WHEN now() - _desde > interval '120 minutes' THEN 1   -- auto-cura
               ELSE _n + 1
             END;

    INSERT INTO public.sync_state (key, value)
    VALUES ('suppress_order_notify',
            jsonb_build_object('on', true,
                               -- NUNCA encurta: se outro lote pediu janela
                               -- maior, ela vale.
                               'ate', GREATEST(_ate, now() + make_interval(mins => _min)),
                               'desde', CASE WHEN _novo = 1 THEN now() ELSE COALESCE(_desde, now()) END,
                               'n', _novo))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ELSE
    -- Sai UM lote. So desliga de verdade quando o ultimo sair.
    _novo := GREATEST(0, _n - 1);

    INSERT INTO public.sync_state (key, value)
    VALUES ('suppress_order_notify',
            jsonb_build_object('on', _novo > 0,
                               -- `ate` fica como esta: encurtar aqui e
                               -- exatamente o defeito que se esta consertando.
                               'ate', CASE WHEN _novo > 0 THEN _ate ELSE NULL END,
                               'desde', CASE WHEN _novo > 0 THEN _desde ELSE NULL END,
                               'n', _novo))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_suppress_order_notify(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_suppress_order_notify(boolean, integer) TO service_role;
-- NOVO: a ferramenta de update em massa da tela precisa suprimir antes de rodar,
-- e ela fala como usuario logado, nao com a service key. O papel e conferido
-- DENTRO da funcao (acima), porque `SECURITY DEFINER` ignora RLS.
GRANT EXECUTE ON FUNCTION public.set_suppress_order_notify(boolean, integer) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO religa gatilho nenhum. `trg_order_status_notify` e `trg_low_stock_notify`
-- continuam DESABILITADOS, e a torneira `envio_pausado` continua como esta.
--
-- NAO cobre o caso de a janela VENCER com lote ainda vivo: um lote que passe de
-- 120 minutos perde a protecao. Nenhum lote real chega perto disso, e o limite
-- existe para impedir supressao eterna.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Cole de volta o corpo de `set_suppress_order_notify` de
-- 20260825180000_teto_notificacao.sql (linha ~172) e refaca os GRANTs de la
-- (so `service_role`).
--
-- Reverter devolve: um lote podendo desligar a supressao de outro.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Contagem de referencia (rode em sequencia):
--   SELECT public.set_suppress_order_notify(true, 20);
--   SELECT public.set_suppress_order_notify(true, 20);
--   SELECT public.set_suppress_order_notify(false);
--   SELECT value FROM public.sync_state WHERE key = 'suppress_order_notify';
--   -- ESPERADO: {"n": 1, "on": true, "ate": ...}
--   --   Dois lotes entraram, UM saiu -> continua suprimido. Este e o defeito
--   --   consertado: antes o `on` ja teria virado false aqui.
--
-- 2) CONTROLE — sem ele o item 1 nao prova nada, porque uma funcao que NUNCA
--    desliga tambem passaria:
--   SELECT public.set_suppress_order_notify(false);
--   SELECT value FROM public.sync_state WHERE key = 'suppress_order_notify';
--   -- ESPERADO: {"n": 0, "on": false, "ate": null}
--   -- Se `on` continuar true, a supressao nao solta e a loja fica muda.
--
-- 3) A auto-cura funciona (o teste que a primeira versao NAO passava):
--   -- simula um contador orfao antigo:
--   UPDATE public.sync_state
--      SET value = jsonb_build_object('on', true, 'n', 3,
--                                     'ate',   now() + interval '20 minutes',
--                                     'desde', now() - interval '3 hours')
--    WHERE key = 'suppress_order_notify';
--   SELECT public.set_suppress_order_notify(true, 20);
--   SELECT value FROM public.sync_state WHERE key = 'suppress_order_notify';
--   -- ESPERADO: "n": 1  (nao 4). Sem isto, um lote que morresse deixaria a
--   -- loja muda para sempre, porque a janela e renovada pelo cron a cada 15min.
--   SELECT public.set_suppress_order_notify(false);
--
-- 4) O teto da janela pega:
--   SELECT public.set_suppress_order_notify(true, 999999);
--   SELECT value->>'ate' FROM public.sync_state WHERE key = 'suppress_order_notify';
--   -- ESPERADO: no maximo ~2 horas a frente, nao anos.
--   SELECT public.set_suppress_order_notify(false);
-- ---------------------------------------------------------------------------
