-- ============================================================================
-- Hardening da varredura 2026-06-23 (parte SQL):
--  Q1: pedido_itens sem CHECK(quantidade>0) -> cliente podia POSTar quantidade
--      negativa via PostgREST e gerar subtotal NEGATIVO (pedido quase de graça).
--  Q2: preco_autoritativo / _resolve_desconto tinham EXECUTE público -> um cliente
--      podia chamar com o _cliente_id de OUTRO e descobrir o preço negociado alheio
--      (vaza price list). Só os triggers (SECURITY DEFINER) precisam executar.
--  Q3: increment_coupon_usage podia ser chamado em loop p/ QUALQUER cupom (griefing
--      de promo). Agora só incrementa se o cupom está num pedido do próprio chamador.
--  Q4: _schedule_b2bwave_job (SECURITY DEFINER) sem SET search_path.
-- ============================================================================

-- Q1: bloqueia quantidade <= 0 em novos itens (NOT VALID: não falha em dados antigos).
ALTER TABLE public.pedido_itens DROP CONSTRAINT IF EXISTS pedido_itens_qtd_pos;
ALTER TABLE public.pedido_itens ADD CONSTRAINT pedido_itens_qtd_pos CHECK (quantidade > 0) NOT VALID;

-- Q2: tira o EXECUTE direto das funções de preço (triggers chamam internamente).
REVOKE EXECUTE ON FUNCTION public.preco_autoritativo(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_desconto(uuid, uuid, integer, numeric) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.preco_autoritativo(uuid, uuid, integer) FROM authenticated, anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._resolve_desconto(uuid, uuid, integer, numeric) FROM authenticated, anon';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Q3: incremento de cupom só se o cupom está num pedido do próprio chamador.
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(_coupon_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pedidos p JOIN public.clientes c ON c.id = p.cliente_id
    WHERE p.coupon_id = _coupon_id AND c.user_id = auth.uid()
  ) THEN
    RETURN; -- chamador não tem pedido com esse cupom: ignora (anti-griefing)
  END IF;
  UPDATE public.coupons SET uso_atual = COALESCE(uso_atual, 0) + 1
  WHERE id = _coupon_id AND (uso_maximo IS NULL OR COALESCE(uso_atual, 0) < uso_maximo);
END; $$;

-- Q4: pina o search_path do job scheduler (defensivo; hoje sem GRANT público).
-- Assinatura real: _schedule_b2bwave_job(_jobname text, _cron text, _action text).
DO $$ BEGIN
  EXECUTE 'ALTER FUNCTION public._schedule_b2bwave_job(text, text, text) SET search_path = public, cron, net, vault, pg_catalog';
EXCEPTION WHEN OTHERS THEN NULL; END $$;
