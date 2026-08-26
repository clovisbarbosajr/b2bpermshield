-- ---------------------------------------------------------------------------
-- O ALERTA DE ESTOQUE PASSA A TER TRAVA DE LOTE — E ALGUEM PASSA A LEVANTA-LA.
--
-- Esta migration anda JUNTO com mudancas em TRES arquivos:
--   supabase/functions/b2bwave-sync/index.ts   (handler `sync_products`)
--   src/pages/admin/InventoryAdjustment.tsx    (ajuste de inventario)
--   src/pages/admin/tools/ImportOrders.tsx     (importacao de pedidos)
--
-- *** ORDEM OBRIGATORIA: ESTE SQL PRIMEIRO, PUBLISH DEPOIS. ***
-- Nao e recomendacao. As duas telas acima chamam `set_suppress_stock_notify` e
-- ABORTAM se ela nao existir. Publicar antes do SQL faz o admin perder as duas
-- telas por inteiro — "Could not pause stock alerts", nada grava — e o
-- `sync_products` recusa rodar. A falha e alta e barulhenta, nao silenciosa, mas
-- e total enquanto durar.
--
-- Sozinha, esta migration nao conserta nada, e a primeira versao deste arquivo
-- dizia que consertava. Estava errada, e o erro merece ficar escrito:
--
--   A versao anterior afirmava no cabecalho que o `suprimirNotificacao(true)`
--   do sync "podia ser chamado que nao adiantaria nada, porque a funcao nao
--   olhava a chave". FALSO. O handler `sync_products` NUNCA chamou supressao
--   nenhuma — havia inclusive um comentario no proprio handler dizendo que a
--   ausencia era DELIBERADA. Eu descrevi um chamador cuidadoso sendo traido pelo
--   banco, quando o que existia era um chamador que nao chamava. Aplicar so o
--   SQL teria deixado o repositorio com um comentario afirmando protecao
--   inexistente, que e exatamente o defeito que o `20260826080000` foi escrito
--   para condenar.
--
-- NOTA SOBRE CITACOES: este arquivo NAO cita `arquivo:linha` de codigo que sobe
-- junto com ele. Cita `migration:linha`, que e seguro — migration e imutavel
-- depois do commit. A versao anterior citava quatro numeros de linha do
-- `b2bwave-sync/index.ts`, e os dois arquivos sobem JUNTOS: as quatro viravam
-- ponteiros para a versao anterior do codigo no instante do commit. Migration
-- que nasce citando o passado nasce invalida.
--
-- O RISCO REAL (esse continua valendo):
--   O handler `sync_products` grava `estoque_total` em lotes de 50 num unico
--   `upsert`. Todo produto que cruzar o limite PARA BAIXO naquele statement
--   dispara um `net.http_post`. O unico freio era o teto de 10/hora — que e por
--   HORA, nao por lote: uma recuperacao de 4 horas libera 40. E se a origem
--   devolver resposta parcial, o `parseInt(p.quantity || p.stock || "0") || 0`
--   que monta a linha zera o catalogo inteiro de uma vez e TODO produto acima do
--   limite cruza junto. E o formato do incidente de 25/ago trocando SMS por
--   alerta de estoque.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA CHAVE NOVA, E NAO A `suppress_order_notify`
--
-- A razao NAO e evitar falso positivo. E preciso dizer isso com clareza porque a
-- versao anterior deste paragrafo dizia o contrario e se contradizia tres linhas
-- adiante: como o gatilho le AS DUAS chaves com OR, um tick do `cron_orders`
-- continua calando o alerta de estoque exatamente como calaria se a chave fosse
-- uma so. Esse custo esta mantido por inteiro, e aparece no "CUSTO ACEITO (b)"
-- mais abaixo.
--
-- A razao verdadeira e a DIRECAO OPOSTA: uma chave so faria um lote de ESTOQUE
-- calar a notificacao de STATUS DE PEDIDO — que e a unica que fala com o
-- cliente. `sync_products` roda de hora em hora, e a tela de ajuste de
-- inventario levanta janela de 30 minutos: com chave compartilhada, uma contagem
-- fisica no deposito engoliria o aviso de "seu pedido foi enviado" de quem
-- comprou naquele intervalo. Silenciar alerta interno de estoque custa um
-- relatorio; silenciar aviso de pedido custa o cliente.
--
-- Entao: chave propria `suppress_stock_notify` para quem mexe em estoque, e o
-- gatilho de estoque le AS DUAS com OR — porque mudanca de status de pedido
-- TAMBEM mexe em estoque (`20260622170000:55-60`, `20260825320000:230`), e um
-- lote de pedidos precisa calar o estoque tambem. A assimetria e deliberada:
-- pedido cala estoque, estoque NAO cala pedido.
--
-- DUPLICACAO ASSUMIDA: `set_suppress_stock_notify` e copia fiel de
-- `set_suppress_order_notify` (20260826010000), trocando so a chave. Generalizar
-- as duas numa funcao parametrizada seria mais limpo, e foi descartado de
-- proposito HOJE: a de pedidos esta provada e em uso, e o dia de religar
-- notificacao depois de um incidente nao e o dia de mexer no que ja funciona.
-- Quando unificar, unifique as duas de uma vez e reteste a contagem de
-- referencia das duas.
--
-- O QUE NAO MUDA: o limite, o teto de 10/h, o formato do POST, os gatilhos e o
-- estado LIGADO/DESLIGADO deles, a torneira `envio_pausado`. Esta migration nao
-- religa NADA.
--
-- CUSTO ACEITO, dito por inteiro: alerta que cruzar o limite DENTRO de uma
-- janela de silencio se perde de vez. Quem levanta janela, lista completa:
--   (a) o handler `sync_products` do b2bwave-sync;
--   (b) os quatro handlers de sync de PEDIDOS (pela chave de pedido, que este
--       gatilho tambem le — mudanca de status mexe em estoque);
--   (c) a tela de ajuste de inventario (Inventory Adjustment);
--   (d) a importacao de pedidos por planilha (Import Orders — os `pedido_itens`
--       disparam o gatilho de reserva, que faz UPDATE em `estoque_reservado`);
--   (e) a atualizacao de pedidos em massa (Bulk Update Orders, pela chave de
--       pedido).
--
-- LACUNA CONHECIDA, registrada de proposito em vez de escondida: o endpoint REST
-- publico (`supabase/functions/api`) grava `produtos.estoque_total` e NAO levanta
-- chave nenhuma. E um produto por requisicao HTTP, entao nao ha rajada de lote —
-- mas um ERP percorrendo o catalogo faz N chamadas seguidas, e ai o unico freio
-- e o teto de 10/h, que e exatamente o argumento que este arquivo usa para
-- recusar "o teto basta". Fechar exige decidir se a API deve suprimir sozinha ou
-- se o cliente da API declara lote; nao entrou nesta leva.
--
-- QUANTO DURA a janela (voltando aos itens (a)-(e) acima; o endpoint REST do
-- paragrafo anterior nao levanta contador nenhum):
-- Normalmente dura o lote. Mas se um lote morrer sem decrementar (timeout de
-- edge, deploy no meio, aba fechada), o contador fica orfao — e ai quem
-- destrava e a EXPRESSAO DE LEITURA daqui de baixo (`desde > now() - interval
-- '120 minutes'`), nao a auto-cura do `set_suppress_*`: aquela so roda na
-- PROXIMA chamada com `_on = true`, e se ninguem chamar, nunca roda. Nesse
-- intervalo, inclusive cruzamento causado por checkout de cliente fica mudo.
-- Por isso o rastro abaixo CONTA quantos foram engolidos, e por isso a consulta
-- de quem esta abaixo do limite continua sendo a fonte de verdade:
--
--   SELECT p.nome, p.sku,
--          COALESCE(p.estoque_total,0) - COALESCE(p.estoque_reservado,0) AS disponivel
--     FROM public.produtos p,
--          LATERAL (SELECT COALESCE((extra->>'low_stock_threshold')::int, 5) t
--                     FROM public.notification_events WHERE id='low_stock') e
--    WHERE COALESCE(p.estoque_total,0) - COALESCE(p.estoque_reservado,0) <= e.t
--    ORDER BY 3;
--
-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde o retorno.
--
--   SELECT pg_get_functiondef('public.fn_low_stock_notify()'::regprocedure);
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.produtos'::regclass AND tgname = 'trg_low_stock_notify';
--   SELECT key, value FROM public.sync_state WHERE key LIKE 'suppress%';
--
-- ROLLBACK: reexecute a definicao devolvida pelo `pg_get_functiondef` acima, e
-- `DROP FUNCTION public.set_suppress_stock_notify(boolean, integer);`.
-- Reverter devolve: sync de produtos em lote podendo disparar alerta por produto.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A CHAVE NOVA E QUEM A LEVANTA.
--    Copia fiel de `set_suppress_order_notify` (20260826010000:67-173), trocando
--    apenas a chave. Os comentarios de la explicam cada trava; aqui ficam so os
--    que mudam de sentido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_suppress_stock_notify(_on boolean, _minutos integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ate   timestamptz;
  _desde timestamptz;
  _n     integer;
  _novo  integer;
  _min   integer;
BEGIN
  -- Quem pode: service_role (o sync, `auth.uid()` NULL) e staff logado — as
  -- telas Inventory Adjustment e Import Orders chamam esta funcao como usuario
  -- logado, nao com a service key. Cliente comum leva erro: o cadastro e ABERTO,
  -- e sem esta linha qualquer conta calaria o alerta de estoque do sistema.
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_role(auth.uid(), 'manager'::app_role)
              OR public.has_role(auth.uid(), 'warehouse'::app_role)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  _min := LEAST(GREATEST(COALESCE(_minutos, 30), 1), 120);

  -- A linha PRECISA existir antes do `FOR UPDATE`: em tabela sem a linha,
  -- `SELECT ... FOR UPDATE` nao trava nada e a corrida entre dois lotes volta.
  INSERT INTO public.sync_state (key, value)
  VALUES ('suppress_stock_notify', jsonb_build_object('on', false, 'ate', NULL, 'n', 0))
  ON CONFLICT (key) DO NOTHING;

  SELECT COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz),
         (value->>'desde')::timestamptz,
         COALESCE((value->>'n')::integer, 0)
    INTO _ate, _desde, _n
  FROM public.sync_state WHERE key = 'suppress_stock_notify'
  FOR UPDATE;

  _ate := COALESCE(_ate, '-infinity'::timestamptz);
  _n   := COALESCE(_n, 0);

  IF _on THEN
    -- `desde` marca o PRIMEIRO incremento da sequencia e nenhum tick posterior o
    -- empurra, entao o teto absoluto de 2 horas vale de verdade. Sem ele, um
    -- contador orfao deixaria o alerta de estoque mudo PARA SEMPRE.
    _novo := CASE
               WHEN _desde IS NULL THEN 1
               WHEN now() - _desde > interval '120 minutes' THEN 1   -- auto-cura
               ELSE _n + 1
             END;

    INSERT INTO public.sync_state (key, value)
    VALUES ('suppress_stock_notify',
            jsonb_build_object('on', true,
                               'ate', GREATEST(_ate, now() + make_interval(mins => _min)),
                               'desde', CASE WHEN _novo = 1 THEN now() ELSE COALESCE(_desde, now()) END,
                               'n', _novo))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ELSE
    -- Sai UM lote. So desliga de verdade quando o ultimo sair.
    _novo := GREATEST(0, _n - 1);

    INSERT INTO public.sync_state (key, value)
    VALUES ('suppress_stock_notify',
            jsonb_build_object('on', _novo > 0,
                               'ate', CASE WHEN _novo > 0 THEN _ate ELSE NULL END,
                               'desde', CASE WHEN _novo > 0 THEN _desde ELSE NULL END,
                               'n', _novo))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_suppress_stock_notify(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_suppress_stock_notify(boolean, integer) TO service_role;
-- As telas Inventory Adjustment e Import Orders falam como usuario logado, nao
-- com a service key. O papel e conferido DENTRO da funcao, porque
-- `SECURITY DEFINER` ignora RLS. Este GRANT tem chamador de verdade — a versao
-- anterior deste arquivo o justificava com uma tela que NAO chamava a funcao,
-- e o cetico pegou. Se um dia nenhum chamador sobrar, revogue.
GRANT EXECUTE ON FUNCTION public.set_suppress_stock_notify(boolean, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) O GATILHO PASSA A LER AS DUAS CHAVES.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_low_stock_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _evt        record;
  _threshold  int;
  _avail_new  int;
  _avail_old  int;
  _teto       int;
  _n          int;
  _suprimido  boolean;
BEGIN
  SELECT * INTO _evt FROM public.notification_events WHERE id = 'low_stock';
  IF _evt IS NULL OR _evt.enabled IS NOT TRUE THEN RETURN NEW; END IF;

  _threshold := COALESCE((_evt.extra->>'low_stock_threshold')::int, 5);
  _avail_new := COALESCE(NEW.estoque_total, 0) - COALESCE(NEW.estoque_reservado, 0);
  _avail_old := COALESCE(OLD.estoque_total, 0) - COALESCE(OLD.estoque_reservado, 0);

  -- Só ao CRUZAR o limite (evita repetir a cada update abaixo).
  IF _avail_old > _threshold AND _avail_new <= _threshold THEN

    -- TRAVA DE LOTE — a que faltava. Expressao IDENTICA a de
    -- `fn_order_status_notify` (20260826080000:134-142), aplicada as DUAS
    -- chaves: vale enquanto a JANELA (`ate`) nao venceu OU enquanto houver LOTE
    -- VIVO (`n > 0`), este ultimo com teto absoluto de 120 minutos contados do
    -- `desde` para que um lote que morra sem decrementar nao deixe o alerta mudo
    -- para sempre.
    --
    -- `bool_or` sobre as duas linhas: `suppress_stock_notify` (lote de estoque)
    -- e `suppress_order_notify` (lote de pedidos — mudanca de status MEXE em
    -- estoque, ver 20260622170000:55-60 e 20260825320000:230).
    --
    -- ANTES do contador de proposito: silenciado nao pode gastar cota, senao o
    -- primeiro alerta verdadeiro depois do lote morre por teto.
    --
    -- FALHA-ABERTO se a linha nao existir (`_suprimido` NULL -> false): correto,
    -- porque as duas funcoes `set_suppress_*` inserem a linha antes de qualquer
    -- coisa, entao "linha ausente" significa que ninguem jamais pediu supressao.
    -- E se alguem limpar `sync_state`, o `low_stock_counter` some junto e o
    -- `_n IS NULL` do teto abaixo barra tudo — o fail-CLOSED do teto cobre.
    SELECT bool_or(
             COALESCE((value->>'on')::boolean, false)
             AND (
               COALESCE((value->>'ate')::timestamptz, '-infinity'::timestamptz) > now()
               OR (COALESCE((value->>'n')::integer, 0) > 0
                   AND COALESCE((value->>'desde')::timestamptz, '-infinity'::timestamptz)
                       > now() - interval '120 minutes')
             ))
      INTO _suprimido
    FROM public.sync_state
    WHERE key IN ('suppress_stock_notify', 'suppress_order_notify');

    IF COALESCE(_suprimido, false) THEN
      -- Rastro que CONTA. Uma linha por hora — em lote, uma por produto seriam
      -- centenas e o log viraria a propria enxurrada que esta trava evita — mas
      -- com contador, senao o dono nao teria como saber QUANTOS avisos perdeu.
      -- Sem esta linha o caso vira nao-envio invisivel, que e o que este projeto
      -- mais combate.
      --
      -- MUDANCA DE REGIME DE LOCK, dita em voz alta: isto era um `SELECT`
      -- (`NOT EXISTS`) e virou um `UPDATE` numa linha unica e quente. Dentro de
      -- um chunk de 50 e tudo a MESMA transacao — locks reentrantes, sem espera.
      -- Entre dois lotes suprimidos concorrentes ha serializacao nessa linha, e
      -- um deadlock (40P01) e teoricamente possivel; ele cai no `EXCEPTION`
      -- abaixo e degrada para "a contagem perdeu 1". Nunca derruba o UPDATE do
      -- produto, que e a unica garantia que nao pode ser negociada aqui.
      BEGIN
        UPDATE public.notification_log
           SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{suprimidos}',
                         to_jsonb(COALESCE((payload->>'suprimidos')::int, 0) + 1)),
               error = format(
                 '%s alerta(s) de estoque baixo suprimidos por lote nesta hora — ultimo: %s',
                 COALESCE((payload->>'suprimidos')::int, 0) + 1, NEW.nome)
         WHERE id = (
           -- A linha MAIS RECENTE da hora, uma so: sem o LIMIT, duas linhas
           -- criadas numa corrida seriam ambas incrementadas e a contagem
           -- dobraria.
           SELECT id FROM public.notification_log
            WHERE event = 'low_stock_lote' AND created_at > now() - interval '1 hour'
            ORDER BY created_at DESC LIMIT 1);

        IF NOT FOUND THEN
          INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
          VALUES ('low_stock_lote', '-', '-', 'failed',
                  format('1 alerta(s) de estoque baixo suprimidos por lote nesta hora — ultimo: %s', NEW.nome),
                  jsonb_build_object('produto', NEW.nome, 'sku', COALESCE(NEW.sku, ''),
                                     'disponivel', _avail_new, 'limite', _threshold,
                                     'suprimidos', 1));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'marcador de lote low_stock falhou (ignorado): %', SQLERRM;
      END;
      RETURN NEW;
    END IF;

    SELECT COALESCE((value->>'n')::integer, 10) INTO _teto
    FROM public.sync_state WHERE key = 'low_stock_max_per_hour';

    _n := public.bump_notify_counter('low_stock_counter');
    IF _n IS NULL OR _n > COALESCE(_teto, 10) THEN
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.notification_log
          WHERE event = 'low_stock_teto' AND created_at > now() - interval '1 hour'
        ) THEN
          INSERT INTO public.notification_log (event, channel, recipient, status, error, payload)
          VALUES ('low_stock_teto', '-', '-', 'failed',
                  format('teto de %s/hora atingido — alertas de estoque suspensos ate virar a hora', _teto),
                  jsonb_build_object('produto', NEW.nome, 'sku', COALESCE(NEW.sku, ''), 'contador', _n));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'marcador de teto low_stock falhou (ignorado): %', SQLERRM;
      END;
      RETURN NEW;
    END IF;

    BEGIN
      PERFORM net.http_post(
        url := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/notify-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name='PROJECT_ANON_KEY'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
        ),
        body := jsonb_build_object(
          'event', 'low_stock',
          'vars', jsonb_build_object(
            'product_name', NEW.nome,
            'sku', COALESCE(NEW.sku, ''),
            'quantity', _avail_new,
            'threshold', _threshold,
            'stock', _avail_new
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'low_stock notify falhou (nao derruba o update): %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) INSPECAO DE TEXTO. Os numeros esperados foram CONTADOS no texto final, nao
--    chutados — uma conferencia que erra o esperado e pior que nenhuma: o
--    operador ou desfaz migration correta, ou aprende a ignorar a conferencia.
--
--   SELECT (SELECT count(*) FROM regexp_split_to_table(d, chr(10)) l
--            WHERE l LIKE '%suppress_stock_notify%')  AS chave_nova,
--          (SELECT count(*) FROM regexp_split_to_table(d, chr(10)) l
--            WHERE l LIKE '%suppress_order_notify%')  AS chave_pedido,
--          (SELECT count(*) FROM regexp_split_to_table(d, chr(10)) l
--            WHERE l LIKE '%120 minutes%')            AS teto_absoluto,
--          (SELECT count(*) FROM regexp_split_to_table(d, chr(10)) l
--            WHERE l LIKE '%low_stock_lote%')         AS rastro
--     FROM (SELECT pg_get_functiondef('public.fn_low_stock_notify()'::regprocedure) d) x;
--   -- ESPERADO: 2 | 2 | 1 | 2
--
-- 2) CONTAGEM DE REFERENCIA da chave nova (rode em sequencia):
--
--   SELECT public.set_suppress_stock_notify(true, 20);
--   SELECT public.set_suppress_stock_notify(true, 20);
--   SELECT public.set_suppress_stock_notify(false);
--   SELECT value FROM public.sync_state WHERE key = 'suppress_stock_notify';
--   -- ESPERADO: {"n": 1, "on": true, ...}  (dois entraram, um saiu)
--   SELECT public.set_suppress_stock_notify(false);
--   SELECT value FROM public.sync_state WHERE key = 'suppress_stock_notify';
--   -- ESPERADO: {"n": 0, "on": false, "ate": null, "desde": null}
--
-- 3) TESTE VIVO — os DOIS lados. Sem o lado (b), uma funcao que suprime SEMPRE
--    passaria por consertada e o estoque ficaria mudo em silencio. Requer o
--    gatilho LIGADO; faca depois de religar, e com a torneira ainda fechada.
--
--    PASSO 0 — PRE-CONDICOES. Sem isto, o teste (b) tem TRES motivos diferentes
--    para "nao apareceu nada" e voce nao sabe qual foi. Rode antes:
--
--      SELECT enabled, channels, notify_admin FROM public.notification_events
--       WHERE id = 'low_stock';
--      -- enabled tem que ser true e channels nao pode estar vazio. Se `enabled`
--      -- for false, a funcao retorna SEM ESCREVER LOG NENHUM — o (b) daria
--      -- "nada apareceu" sem ter nada a ver com esta migration.
--
--      SELECT count(*) FROM public.notification_recipients WHERE active;
--      -- Se for 0, o dispatch nao monta destinatario, o laco de envio nao roda,
--      -- e o log ganha "skip: no ACTIVE recipients" em vez da frase esperada.
--
--      SELECT id, enabled FROM public.notification_channels;
--      -- O interruptor MESTRE de cada canal. Se o canal estiver desligado, o
--      -- dispatch registra "skip: channel disabled" e NEM CHEGA a consultar a
--      -- torneira — a frase esperada no passo 4 nao aparece, e a migration esta
--      -- perfeita. Com a politica SMS-only e o pos-incidente, e cenario
--      -- provavel, nao teorico.
--
--    PASSO 0-bis — ESCOLHA DO PRODUTO. Pegue um com reserva ZERO:
--
--      SELECT id, nome, estoque_total, estoque_reservado FROM public.produtos
--       WHERE COALESCE(estoque_reservado,0) = 0 AND ativo LIMIT 5;
--
--      -- POR QUE: a funcao compara `estoque_total - estoque_reservado`, nao o
--      -- total. Num produto com 96+ reservados, o `UPDATE ... = 100` NAO deixa
--      -- o disponivel acima do limite, nao ha cruzamento, e os DOIS testes dao
--      -- falso negativo — o (a) vira "nao gerou rastro" e o (b) vira "esta
--      -- calando sempre". As duas conclusoes erradas, pelo mesmo motivo.
--      -- Guarde os DOIS valores originais para restaurar no fim.
--
--    (a) COM lote vivo — ESPERADO: NAO dispara, e aparece rastro contando.
--        Este lado e SINCRONO (o gatilho escreve o rastro direto, sem pg_net),
--        entao o resultado vale na hora.
--
--      SELECT public.set_suppress_stock_notify(true, 5);
--      UPDATE public.produtos SET estoque_total = 100, estoque_reservado = 0 WHERE id = '<id-de-teste>';
--      UPDATE public.produtos SET estoque_total = 0   WHERE id = '<id-de-teste>';
--      SELECT error, payload->>'suprimidos' FROM public.notification_log
--       WHERE event = 'low_stock_lote' ORDER BY created_at DESC LIMIT 1;
--      -- ESPERADO: uma linha, suprimidos = 1
--      SELECT public.set_suppress_stock_notify(false);
--
--    (b) SEM lote vivo — ESPERADO: DISPARA.
--        Este lado e ASSINCRONO: o gatilho so ENFILEIRA em
--        `net.http_request_queue`; quem entrega e o worker do pg_net, e so
--        depois a edge function grava o log. Ler o log no mesmo segundo da
--        "nada" mesmo quando esta tudo certo.
--
--      -- 1. Confirme que as duas chaves zeraram:
--      SELECT key, value FROM public.sync_state
--       WHERE key IN ('suppress_stock_notify','suppress_order_notify');
--      -- Tem que ser {"n":0,"on":false} nas duas. Se qualquer uma estiver
--      -- ligada, o (b) e invalido — nao conclua nada.
--
--      -- 2. O gatilho so dispara na TRANSICAO: SUBA antes de derrubar.
--      UPDATE public.produtos SET estoque_total = 100, estoque_reservado = 0 WHERE id = '<id-de-teste>';
--      UPDATE public.produtos SET estoque_total = 0   WHERE id = '<id-de-teste>';
--
--      -- 3. (OPCIONAL — se der erro de permissao, PULE para o 4.) Confirme que
--      -- o POST saiu do banco. Isto sozinho ja prova que a funcao nao calou:
--      SELECT id, status_code, created FROM net._http_response
--       WHERE created > now() - interval '5 minutes' ORDER BY created DESC;
--      -- `_http_response`, NAO `http_request_queue`: a fila e drenada pelo
--      -- worker em cerca de 1 segundo e a linha some, entao consultar a fila a
--      -- mao da 0 quase sempre, mesmo com tudo certo. A resposta fica guardada
--      -- por horas — e alem de provar que saiu, diz o que o destino respondeu.
--      -- 200 = o notify-dispatch aceitou. 401 = segredo do vault ausente ou
--      -- rotacionado (ver leitura 5 abaixo). 5xx = erro no dispatch.
--
--      -- 4. ESPERE cerca de 1 minuto e so entao leia o log:
--      SELECT event, status, error FROM public.notification_log
--       WHERE created_at > now() - interval '5 minutes' ORDER BY created_at DESC;
--      -- ESPERADO: uma linha `low_stock` com status `failed`. O MOTIVO pode ser
--      -- qualquer um destes tres, e os tres provam a mesma coisa — que o gatilho
--      -- disparou e o envio foi barrado:
--      --   "skip: envio pausado manualmente"        (torneira geral)
--      --   "skip: channel disabled"                 (interruptor mestre do canal)
--      --   "skip: ... no ACTIVE recipients ..."     (sem destinatario cadastrado)
--      -- Nao exija a primeira frase: exigir uma so era o defeito da versao
--      -- anterior deste roteiro.
--
--    COMO LER UM "NADA APARECEU" NO (b) — sao CINCO causas, e so a ultima
--    condena esta migration:
--      1. `low_stock` desabilitado, sem destinatario ativo, ou canal mestre
--         desligado -> passo 0.
--      2. produto com reserva alta, sem cruzamento de verdade -> passo 0-bis.
--      3. worker do pg_net ainda nao entregou -> espere e releia o passo 4.
--      4. o POST SAIU e voltou 401/5xx (segredo do vault ausente ou rotacionado,
--         erro no notify-dispatch) -> o `notification_log` so e escrito DEPOIS do
--         portao de autenticacao do dispatch, entao nao ha linha nenhuma. Isto
--         NAO e defeito desta migration: o passo 3 mostra a resposta. Conserte o
--         segredo e repita.
--      5. o passo 3 nao mostra resposta NENHUMA, E nao ha rastro `low_stock_lote`,
--         E nao ha linha no log: AI SIM a funcao esta calando sempre. NAO abra a
--         torneira; volte o rollback do cabecalho.
--
--    Restaure `estoque_total` E `estoque_reservado` do produto de teste no fim.
-- ---------------------------------------------------------------------------
