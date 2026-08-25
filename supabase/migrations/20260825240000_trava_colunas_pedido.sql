-- ============================================================================
-- TRAVA: colunas de PEDIDO que so o servidor pode definir no INSERT
--
-- Irma da 20260825230000. Aquela fechou `b2bwave_order_id`; o cacador achou que
-- o mesmo furo vale para OUTRAS colunas — e duas delas sao piores.
--
-- A policy de INSERT do cliente e SO "o pedido e meu":
--
--   CREATE POLICY "Clients can insert pedidos" ON public.pedidos
--     FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM clientes
--       WHERE id = pedidos.cliente_id AND user_id = auth.uid()));
--
-- Ela nao diz NADA sobre quais colunas. O Checkout manda um conjunto educado,
-- mas um POST cru na API manda o que quiser.
--
--   `is_paid`  -> PEDIDO NASCE PAGO. Nenhum trigger le ou escreve essa coluna
--                 (procurado nas 158 migrations). O admin ve "pago" na tela e o
--                 Stripe nunca foi chamado. Pior: `stripe-checkout` e idempotente
--                 por `.eq("is_paid", false)`, entao o webhook legitimo vira
--                 no-op — nem da para reconciliar depois.
--
--   `status`   -> PEDIDO NASCE 'complete'. E `fn_adjust_stock_on_order_status` e
--                 AFTER **UPDATE**: nascer completo nunca dispara a baixa. A
--                 reserva feita por `trg_reserve_stock_on_order_item` fica presa
--                 PARA SEMPRE. Pedido concluido, sem pagamento, com estoque
--                 travado.
--
-- As revisoes anteriores olharam o caminho de UPDATE dessas colunas e
-- concluiram "a RLS bloqueia" — e bloqueia mesmo: o cliente nao tem policy de
-- UPDATE nem de DELETE em `pedidos`. Ninguem olhou o INSERT, que e exatamente
-- onde o cliente escreve.
--
-- EXEMPT: `service_role` (sync), conexao direta (SQL editor), e admin/manager —
-- a tela de admin cria pedido com `status: "submitted"` de proposito
-- (`src/pages/admin/OrderDetail.tsx:406`), e travar isso quebraria o pedido
-- manual. O Checkout do cliente NAO manda `status` nem `is_paid`
-- (`src/pages/portal/Checkout.tsx`, bloco do insert do pedido), entao o portal
-- so muda no que este arquivo forca de proposito.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Pedido do portal que nasceu pago ou fora do status inicial e sinal de abuso.
-- (`b2bwave_order_id IS NULL` exclui os importados, que legitimamente chegam
-- pagos e em qualquer status.)
--
--   SELECT id, numero, status, is_paid, payment_intent_id, total, created_at
--   FROM public.pedidos
--   WHERE b2bwave_order_id IS NULL
--     AND (is_paid IS TRUE OR payment_intent_id IS NOT NULL
--          OR status <> 'submitted')
--   ORDER BY created_at DESC;
-- ---------------------------------------------------------------------------

BEGIN;

-- PORTAO: esta migration depende de `notificavel` e `data_origem`, criadas em
-- 20260825200000_pedido_notificavel.sql. Se elas nao existirem, o plpgsql so
-- falharia na PRIMEIRA execucao do trigger — ou seja, no primeiro pedido de um
-- cliente de verdade. Prefiro falhar aqui, agora, com a instrucao do conserto.
DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedidos'
      AND column_name IN ('notificavel', 'data_origem')
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Rode 20260825200000_pedido_notificavel.sql ANTES desta migration (faltam pedidos.notificavel/data_origem).';
  END IF;
END $gate$;

CREATE OR REPLACE FUNCTION public.fn_lock_pedido_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Chamador NAO identificado = `service_role` (a service key nao carrega `sub`,
  -- entao `auth.uid()` e NULL) ou conexao DIRETA ao banco (SQL editor do
  -- Lovable, psql), que nem passa por PostgREST.
  --
  -- Testar `auth.uid()` e nao `auth.role()` de proposito: e a forma que a outra
  -- trava do repo usa (`fn_lock_privileged_cliente_cols`,
  -- 20260801130000:167-170) — escopa a restricao a quem FOI identificado, em vez
  -- de isentar por ausencia de um claim. Nao depende de nenhuma afirmacao minha
  -- sobre o que o PostgREST garante no JWT.
  --
  -- Mesmo criterio da 20260825230000.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;

  -- Dinheiro. Quem marca pago e o webhook do Stripe, com service role.
  NEW.is_paid          := false;
  NEW.payment_intent_id := NULL;

  -- Maquina de estado. Todo pedido do portal comeca no inicio.
  --
  -- 'submitted', NAO 'recebido'. Eu tinha escrito 'recebido' — que e valor
  -- LEGADO, migrado para fora em 20260622170000:15-18 (`SET DEFAULT 'submitted'`
  -- + `UPDATE ... WHERE status='recebido'`). Ele so sobrevive no mapa LEGACY de
  -- `src/lib/orderStatuses.ts:22`, para exibir pedido antigo.
  --
  -- O estrago seria silencioso: `src/pages/portal/Pedidos.tsx:91` e `:238`
  -- filtram com `.eq("status", ...)` nos valores canonicos, entao o CLIENTE
  -- filtrando "Submitted" nao veria nenhum pedido novo dele. E
  -- `supabase/functions/api/index.ts:127-129` filtra a coluna crua, entao a
  -- integracao externa tambem perderia os pedidos do portal. O admin escaparia
  -- por sorte, porque normaliza com `canonicalStatus` antes de exibir — ou seja,
  -- o dado ficaria errado e a tela esconderia.
  NEW.status := 'submitted'::public.pedido_status;

  -- Marcas do incidente dos SMS (20260825200000). Deixar o cliente escrever
  -- `data_origem` seria devolver a ele o controle do "nada retroativo".
  NEW.notificavel  := true;
  NEW.data_origem  := NULL;

  -- Campos de staff. `admin_notes` e lido por humano e decide operacao.
  NEW.tracking_number := NULL;
  NEW.admin_notes     := NULL;

  -- `created_at` alimenta a barreira de idade de `fn_order_status_notify`.
  -- Data no passado = pedido "velho" que a barreira deixaria passar calado;
  -- data no futuro = pedido que nunca envelhece.
  NEW.created_at := now();

  RETURN NEW;
END $$;

-- Prefixo `a_` pela mesma razao da 20260825230000: precisa rodar ANTES dos
-- demais BEFORE, que leem estas colunas para decidir.
--
-- Entre os dois gatilhos `a_` a ordem e `a_trg_lock_pedido_cols` PRIMEIRO
-- (`...l...` < `...p...`), e isso NAO importa: nenhum le a coluna do outro —
-- este mexe em is_paid/status/datas, o outro so em `b2bwave_order_id`. O que
-- importa e que os dois venham antes de `trg_pedido_total_appside`,
-- `trg_pedido_numero_continua` e da familia de recalculo, e vem.
DROP TRIGGER IF EXISTS a_trg_lock_pedido_cols ON public.pedidos;
CREATE TRIGGER a_trg_lock_pedido_cols
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_pedido_cols();

COMMIT;

-- ---------------------------------------------------------------------------
-- NAO cobre, de proposito
--
-- `subtotal`, `total`, `desconto`, `sales_tax`, `shipping_costs`, `coupon_id`:
-- ja sao reescritos por `fn_pedido_total_appside`. RESSALVA: o `subtotal` so e
-- recalculado pelo AFTER INSERT em `pedido_itens`. Pedido criado SEM item
-- nenhum guarda o valor que o navegador mandou. E o "pedido orfao" — anotado
-- na fila, o conserto e no rollback do Checkout, nao aqui.
--
-- `numero`: ja sobrescrito por `trg_pedido_numero_continua`.
-- `cliente_id`: preso pela propria policy de INSERT.
--
-- UPDATE: o cliente nao tem policy de UPDATE nem DELETE em `pedidos` (11
-- policies conferidas). Por isso este trigger e so BEFORE INSERT.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS a_trg_lock_pedido_cols ON public.pedidos;
--
-- ATENCAO: reverter reabre "pedido nasce pago" e "pedido nasce concluido".
-- Se o portal parar de criar pedido, me avise ANTES de reverter.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Os dois gatilhos novos, nesta ordem, no topo da lista:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--   ORDER BY tgname;
--   -- esperado: a_trg_lock_pedido_cols, a_trg_pedido_b2bwave_id_so_servidor, ...
--   -- (ordem alfabetica da listagem; a EXECUCAO segue a mesma ordem)
--
-- 2) O portal continua criando pedido: feche um pedido de teste pelo site e
--    confira que ele nasce `status = 'submitted'`, `is_paid = false`.
--
-- 3) O admin continua criando pedido manual com `status = 'submitted'`.
-- ---------------------------------------------------------------------------
