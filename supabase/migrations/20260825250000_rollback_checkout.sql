-- ============================================================================
-- CONSERTA O DESFAZER DO CHECKOUT (hoje e codigo morto)
--
-- `src/pages/portal/Checkout.tsx` tenta desfazer o pedido em TRES pontos:
--
--   - apos falha no insert dos itens: `.delete().eq("id", pedido.id)`
--   - apos falha ao criar o payment intent: `.update({ status: "cancelled" })`
--   - apos `confirmCardPayment` recusar: idem
-- (sem numero de linha de proposito: o arquivo muda, e citacao de linha velha
--  faz o revisor conferir a linha errada)
--
-- Nenhum dos tres funciona. O cliente NAO tem policy de DELETE nem de UPDATE em
-- `pedidos` — conferidas as 10 policies vivas: `Clients can read own`
-- (SELECT), `Clients can insert` (INSERT), `Contacts read/insert company`,
-- `Sub-customer reads parent history`, `Parent reads sub-customer orders`,
-- `Warehouse read` (SELECT), `Warehouse update` (UPDATE, papel warehouse),
-- `Managers manage` (ALL), `Admins can manage` (ALL). A `Anon can read` foi
-- derrubada em 20260618000000.
--
-- E o supabase-js NAO levanta erro quando a RLS filtra tudo: o delete/update
-- simplesmente afeta zero linhas e volta sem `error`. Falha em silencio.
--
-- CONSEQUENCIA: toda falha no insert dos itens deixa um PEDIDO ORFAO — zero
-- linhas de item, mas com o `subtotal`/`total` que o NAVEGADOR mandou (o
-- recalculo e AFTER INSERT em `pedido_itens`, que nunca rodou). Ele aparece no
-- historico do cliente e na lista do admin como pedido de verdade, com valor.
--
-- E acabou de ficar mais provavel: `trg_item_exige_variante` (20260825220000)
-- passou a RECUSAR item sem variante — carrinho velho do localStorage, re-order
-- de pedido importado. Cada recusa vira um orfao.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — quantos orfaos ja existem hoje.
--
--   SELECT p.id, p.numero, p.status, p.total, p.created_at
--   FROM public.pedidos p
--   WHERE NOT EXISTS (SELECT 1 FROM public.pedido_itens i WHERE i.pedido_id = p.id)
--   ORDER BY p.created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

-- PORTAO: depende de `notificavel` (20260825200000).
--
-- HOJE o `trg_order_status_notify` esta DESLIGADO (`DISABLE TRIGGER` em
-- 20260825180000:382) e os envios estao pausados, entao nada sairia de qualquer
-- forma. Eu tinha escrito aqui que "mandaria SMS/e-mail" — falso no estado
-- atual. A dependencia continua valendo para quando o gatilho for religado: sem
-- `notificavel`, o UPDATE de status desta RPC avisaria o cliente que esta parado
-- na tela de erro que o pedido dele foi cancelado.
DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos'
      AND column_name = 'notificavel'
  ) THEN
    RAISE EXCEPTION 'Rode 20260825200000_pedido_notificavel.sql ANTES desta migration (falta pedidos.notificavel).';
  END IF;
END $gate$;

CREATE OR REPLACE FUNCTION public.pedido_rollback_checkout(_pedido_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dono    boolean;
  v_idade   interval;
  v_itens   integer;
BEGIN
  -- 1) E do proprio chamador? Sem isto, qualquer cliente com um UUID de pedido
  --    alheio cancelaria o pedido do vizinho.
  SELECT EXISTS (
    SELECT 1
    FROM public.pedidos p
    JOIN public.clientes c ON c.id = p.cliente_id
    WHERE p.id = _pedido_id
      -- SO o dono da ficha. Eu tinha posto `OR is_subcustomer_of(c.id)` aqui;
      -- isso deixaria um sub-usuario desfazer pedido do PAI, poder que o
      -- desfazer-de-checkout nao precisa e que nem e simetrico (o pai nao
      -- desfaria o do filho). O Checkout cria o pedido com a ficha PROPRIA
      -- (`cliente_id = clienteId`), entao `user_id = auth.uid()` cobre 100% do
      -- caso de uso.
      AND c.user_id = auth.uid()
  ) INTO v_dono;

  IF NOT v_dono THEN
    RAISE EXCEPTION 'ROLLBACK_DENIED';
  END IF;

  -- 2) Recem-criado? Isto e um desfazer de checkout, nao um cancelamento de
  --    pedido. Pedido de ontem nao se apaga por aqui.
  SELECT now() - created_at, (SELECT count(*) FROM public.pedido_itens i WHERE i.pedido_id = p.id)
    INTO v_idade, v_itens
  FROM public.pedidos p WHERE p.id = _pedido_id;

  IF v_idade > interval '30 minutes' THEN
    RAISE EXCEPTION 'ROLLBACK_TOO_OLD';
  END IF;

  -- 2b) JA PAGO nunca se desfaz por aqui.
  --
  -- Faltava, e o buraco era real: se o `confirmCardPayment` devolvesse erro de
  -- REDE depois de a cobranca ter passado, o Checkout chamaria esta RPC e o
  -- pedido pago viraria 'cancelled' — e `trg_adjust_stock_on_order_status`
  -- devolveria a reserva de estoque de um pedido que foi cobrado. O cliente
  -- tambem podia chamar a RPC direto no proprio pedido pago de menos de 30min.
  --
  -- Cancelar pedido pago e operacao de ATENDIMENTO, com estorno. Nao e desfazer
  -- de checkout.
  --
  -- ISTO FECHA (desde 25/ago, a correcao veio junto).
  --
  -- Eu tinha escrito aqui que isto era so MITIGACAO, porque no caminho de erro de
  -- rede o front nunca chegava a gravar `payment_intent_id` — quem carimbava era
  -- o webhook, entao o guard virava corrida.
  --
  -- Consertado do outro lado: `stripe-checkout` agora carimba
  -- `payment_intent_id` no pedido no INSTANTE em que cria a intencao de
  -- cobranca, nao quando ela confirma. O banco passa a ter sinal de "ha cobranca
  -- em curso" desde o comeco, e este guard vale a partir dali.
  IF EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE id = _pedido_id
      AND (is_paid IS TRUE OR payment_intent_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_PAID';
  END IF;

  -- 2c) STATUS JA AVANCADO nunca se desfaz por aqui.
  --
  -- O UPDATE la embaixo forca 'cancelled' sem olhar o status atual. Se o pedido
  -- tiver menos de 30 min e o admin ja o tiver movido para 'complete',
  -- `fn_adjust_stock_on_order_status` cai no ramo "saiu de concluido" e DEVOLVE
  -- `estoque_total` — desfaz a baixa de mercadoria que pode ja ter saido do
  -- deposito. Janela estreita (30 min E o admin agindo dentro dela), mas real.
  --
  -- Desfazer de checkout so alcanca pedido que ainda esta no estado inicial.
  IF EXISTS (
    SELECT 1 FROM public.pedidos
    WHERE id = _pedido_id
      AND (status <> 'submitted'::public.pedido_status
           OR tracking_number IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_ADVANCED';
  END IF;

  -- 3) Pedido VAZIO nunca existiu de verdade: apaga. Deixa-lo como 'cancelled'
  --    poluiria o historico do cliente com um pedido de valor fantasma (o total
  --    que o navegador mandou, sem nenhum item por tras).
  IF v_itens = 0 THEN
    DELETE FROM public.pedidos WHERE id = _pedido_id;
    RETURN 'deleted';
  END IF;

  -- 4) Ja tem item (falhou depois, no pagamento): preserva para o admin ver,
  --    mas marca cancelado.
  --
  --    `notificavel = false` NO MESMO UPDATE: `trg_order_status_notify` e AFTER
  --    UPDATE OF status e le `NEW.notificavel` (TRAVA A1 de 20260825200000).
  --    Sem isto o cliente que esta OLHANDO a tela de erro receberia um SMS
  --    dizendo que o pedido foi cancelado.
  UPDATE public.pedidos
     SET status = 'cancelled'::public.pedido_status,
         notificavel = false
   WHERE id = _pedido_id;

  RETURN 'cancelled';
END $$;

REVOKE ALL ON FUNCTION public.pedido_rollback_checkout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedido_rollback_checkout(uuid) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- POR QUE `GRANT ... TO authenticated` AQUI E ACEITAVEL
--
-- Este sistema tem CADASTRO ABERTO, entao `authenticated` = qualquer pessoa.
-- Ja errei nisso hoje (dei EXECUTE de `pausar_envios` para `authenticated`, o
-- que deixaria qualquer um silenciar todas as notificacoes do sistema).
--
-- A diferenca: esta funcao nao tem NENHUM efeito que o chamador ja nao possa
-- causar. Ela so alcanca pedido DELE (checagem 1), com menos de 30 minutos
-- (checagem 2), e o unico caminho destrutivo exige zero itens (checagem 3).
-- O pior que um estranho faz e apagar o proprio pedido vazio.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.pedido_rollback_checkout(uuid);
--
-- Reverter volta ao estado atual: o desfazer do checkout nao faz nada e os
-- orfaos voltam a se acumular. Nao quebra o checkout — o front trata a falha
-- da RPC como "nao deu para desfazer" e segue.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'pedido_rollback_checkout';
--   -- 1 linha, prosecdef = true
--
-- E depois de um checkout que falhe por item invalido: a consulta de orfaos do
-- topo deste arquivo NAO pode ganhar linha nova.
-- ---------------------------------------------------------------------------
