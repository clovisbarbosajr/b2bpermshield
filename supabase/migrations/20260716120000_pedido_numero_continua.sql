-- ============================================================================
-- NUMERAÇÃO DE PEDIDOS DO PORTAL: continuar a sequência do B2BWave.
-- Problema real (pedido #29, 2026-07-16): `numero` é SERIAL, mas os pedidos do
-- sync entram com numero explícito (id do B2BWave, ~2636) e NÃO avançam a
-- sequência — pedido nativo do portal saía com número baixo (29).
-- Fix: trigger BEFORE INSERT — pedido NATIVO (sem b2bwave_order_id) sempre
-- recebe MAX(numero)+1. Autossustentável: dispensa o setval no dia do corte.
-- Pedido cancelado permanece na tabela, então o número dele nunca é reusado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pedido_numero_continua()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.b2bwave_order_id IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero FROM public.pedidos;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pedido_numero_continua ON public.pedidos;
CREATE TRIGGER trg_pedido_numero_continua BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_numero_continua();

-- Conserta o pedido de teste #29 (nativo) pra próxima posição da sequência real.
UPDATE public.pedidos SET numero = (SELECT MAX(numero) + 1 FROM public.pedidos)
WHERE numero = 29 AND b2bwave_order_id IS NULL;
