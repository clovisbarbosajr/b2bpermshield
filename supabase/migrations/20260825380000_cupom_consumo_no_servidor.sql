-- ============================================================================
-- LIMITE DE USO DO CUPOM DEIXA DE SER HONRA
--
-- Divida que eu declarei em 20260825260000 (a que consertou o desconto do cupom
-- vencido) e adiei de proposito. Volto a ela agora.
--
-- O PROBLEMA: quem consome o cupom e o NAVEGADOR.
-- `src/pages/portal/Checkout.tsx` chama `increment_coupon_usage(_coupon_id)`
-- depois de fechar o pedido. Um cliente que simplesmente NAO faca essa chamada
-- nunca incrementa `uso_atual` — e reusa um cupom de uso unico quantas vezes
-- quiser. O preco de cada pedido sai certo; o LIMITE e que nao existe.
--
-- POR QUE ESTAVA ASSIM: a chamada foi movida para o fim do fluxo por decisao
-- deliberada anterior — antes ela rodava no submit, e cartao recusado QUEIMAVA o
-- cupom sem venda nenhuma (cupom de uso unico morria a toa). Trazer o incremento
-- para o INSERT, sem mais nada, reintroduziria aquele bug.
--
-- O CONSERTO CERTO, que agora da para fazer: consumo IDEMPOTENTE marcado no
-- proprio pedido, com DEVOLUCAO quando o pedido morre.
--
--   INSERT do pedido com cupom  -> incrementa e marca `cupom_consumido`
--   pedido vira 'cancelled'     -> devolve e desmarca
--   pedido apagado              -> devolve
--   reativado (sai de cancelado)-> consome de novo
--
-- Assim o cartao recusado nao queima o cupom (o pedido vira 'cancelled' ou e
-- apagado pelo `pedido_rollback_checkout`, e a devolucao acontece), e o cliente
-- nao escolhe mais se conta ou nao.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- O tamanho do buraco ate aqui: pedidos com cupom versus o que o contador diz.
-- Se `uso_atual` estiver MENOR que o numero de pedidos vivos com aquele cupom,
-- a diferenca e o que deixou de ser contado.
--
--   SELECT cp.codigo, cp.uso_atual, cp.uso_maximo,
--          count(p.id) FILTER (WHERE p.status::text NOT IN ('cancelado','cancelled')) AS pedidos_vivos_com_o_cupom
--   FROM public.coupons cp
--   LEFT JOIN public.pedidos p ON p.coupon_id = cp.id
--   GROUP BY cp.id, cp.codigo, cp.uso_atual, cp.uso_maximo
--   HAVING count(p.id) FILTER (WHERE p.status::text NOT IN ('cancelado','cancelled')) <> COALESCE(cp.uso_atual, 0)
--   ORDER BY cp.codigo;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------- 1) A marca de consumo, no proprio pedido ----------
-- `NOT NULL DEFAULT false` nao reescreve a tabela no PG11+.
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cupom_consumido boolean NOT NULL DEFAULT false;

-- Backfill: pedido VIVO que ja tem cupom conta como consumido. Sem isto, o
-- primeiro cancelamento de um pedido antigo devolveria um uso que nunca foi
-- contado, e o contador ficaria NEGATIVO em relacao a realidade.
UPDATE public.pedidos
   SET cupom_consumido = true
 WHERE coupon_id IS NOT NULL
   AND status::text NOT IN ('cancelado','cancelled');

-- ---------- 2) Consome no servidor, uma vez so ----------
CREATE OR REPLACE FUNCTION public.fn_cupom_consome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.coupon_id IS NULL OR NEW.cupom_consumido THEN
    RETURN NULL;
  END IF;

  -- Pedido que ja nasce cancelado nao consome.
  IF NEW.status::text IN ('cancelado','cancelled') THEN
    RETURN NULL;
  END IF;

  -- `WHERE ... uso_atual < uso_maximo` de novo AQUI, e nao so na validacao:
  -- entre a tela aplicar o cupom e o pedido entrar, outro cliente pode ter
  -- gastado a ultima unidade. E o UPDATE condicional que resolve a corrida.
  UPDATE public.coupons
     SET uso_atual = COALESCE(uso_atual, 0) + 1
   WHERE id = NEW.coupon_id
     AND (uso_maximo IS NULL OR COALESCE(uso_atual, 0) < uso_maximo);

  -- Consumiu? Marca. Nao consumiu (esgotou na corrida)? NAO marca, e nao derruba
  -- o pedido: o desconto ja foi calculado pelo `fn_pedido_total_appside`, que
  -- validou a elegibilidade no INSERT. Recusar o pedido inteiro aqui seria pior
  -- para o cliente do que deixar passar um uso a mais num caso de corrida.
  IF FOUND THEN
    UPDATE public.pedidos SET cupom_consumido = true WHERE id = NEW.id;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cupom_consome ON public.pedidos;
CREATE TRIGGER trg_cupom_consome
  AFTER INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cupom_consome();

-- ---------- 3) Devolve quando o pedido morre ----------
CREATE OR REPLACE FUNCTION public.fn_cupom_devolve_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_cancel boolean := NEW.status::text IN ('cancelado','cancelled');
  _old_cancel boolean := OLD.status::text IN ('cancelado','cancelled');
BEGIN
  IF NEW.coupon_id IS NULL OR OLD.status = NEW.status THEN
    RETURN NULL;
  END IF;

  -- CANCELADO: devolve o uso. E o caso do cartao recusado, que era a razao de a
  -- contagem ter sido movida para o fim do fluxo.
  IF _new_cancel AND NOT _old_cancel AND NEW.cupom_consumido THEN
    UPDATE public.coupons
       SET uso_atual = GREATEST(0, COALESCE(uso_atual, 0) - 1)
     WHERE id = NEW.coupon_id;
    UPDATE public.pedidos SET cupom_consumido = false WHERE id = NEW.id;
  END IF;

  -- REATIVADO: consome de novo, se houver saldo.
  IF _old_cancel AND NOT _new_cancel AND NOT NEW.cupom_consumido THEN
    UPDATE public.coupons
       SET uso_atual = COALESCE(uso_atual, 0) + 1
     WHERE id = NEW.coupon_id
       AND (uso_maximo IS NULL OR COALESCE(uso_atual, 0) < uso_maximo);
    IF FOUND THEN
      UPDATE public.pedidos SET cupom_consumido = true WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cupom_devolve_status ON public.pedidos;
CREATE TRIGGER trg_cupom_devolve_status
  AFTER UPDATE OF status ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cupom_devolve_status();

CREATE OR REPLACE FUNCTION public.fn_cupom_devolve_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- `pedido_rollback_checkout` APAGA o pedido vazio. Sem isto, o cupom ficaria
  -- consumido por um pedido que nao existe mais.
  IF OLD.coupon_id IS NOT NULL AND OLD.cupom_consumido THEN
    UPDATE public.coupons
       SET uso_atual = GREATEST(0, COALESCE(uso_atual, 0) - 1)
     WHERE id = OLD.coupon_id;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_cupom_devolve_delete ON public.pedidos;
CREATE TRIGGER trg_cupom_devolve_delete
  AFTER DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cupom_devolve_delete();

-- ---------- 4) A RPC do navegador vira no-op ----------
-- NAO e dropada: o front ainda a chama, e um erro de "funcao nao existe"
-- apareceria na tela do cliente no meio do fechamento. Ela passa a nao fazer
-- nada e a dizer por que — quem consome agora e o gatilho.
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(_coupon_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sem efeito desde 20260825380000. O consumo passou para
  -- `trg_cupom_consome` (AFTER INSERT em `pedidos`), que e idempotente e
  -- devolve o uso quando o pedido e cancelado ou apagado.
  --
  -- Mantida como no-op de proposito: o Checkout ainda chama, e remover a funcao
  -- faria a chamada falhar na tela do cliente. Some quando o front parar de
  -- chamar.
  RETURN;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO recusa o pedido quando o cupom esgota NA CORRIDA (entre a tela aplicar e o
-- pedido entrar). O desconto ja foi calculado e validado no INSERT pelo
-- `fn_pedido_total_appside`; derrubar o pedido inteiro por um uso a mais num
-- caso de corrida seria pior para o cliente do que absorver.
--
-- NAO conta pedido do B2BWave: cupom de la e do outro sistema.
-- (O gatilho nao filtra `b2bwave_order_id` porque pedido importado nunca chega
--  com `coupon_id` — o sync nao mapeia cupom. Se um dia mapear, e preciso
--  adicionar o filtro.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_cupom_consome        ON public.pedidos;
--   DROP TRIGGER IF EXISTS trg_cupom_devolve_status ON public.pedidos;
--   DROP TRIGGER IF EXISTS trg_cupom_devolve_delete ON public.pedidos;
--
--   -- e devolver a RPC o comportamento antigo (cole o corpo de
--   -- 20260623070000_hardening_qty_grants_coupon.sql)
--
-- A coluna `cupom_consumido` pode ficar; sem os gatilhos ela nao e lida.
-- Reverter devolve ao cliente a escolha de contar ou nao o proprio uso.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Os tres gatilhos existem:
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--     AND tgname LIKE 'trg_cupom%' ORDER BY tgname;
--
-- 2) CONTROLE — feche um pedido de teste COM cupom pelo portal e confira que
--    `coupons.uso_atual` subiu 1 e que o pedido esta com `cupom_consumido = true`.
--    Depois cancele esse pedido e confira que o contador VOLTOU.
--    Sem o segundo teste, um gatilho que so soma passaria como "consertado" — e
--    cupom de uso unico morreria a cada carrinho abandonado.
--
-- 3) Rode de novo a consulta do BACKUP: ela nao pode ganhar linha nova.
-- ---------------------------------------------------------------------------
