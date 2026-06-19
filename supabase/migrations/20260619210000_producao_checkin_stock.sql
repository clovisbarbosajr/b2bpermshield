-- ============================================================================
-- Check-in da produção → ENTRA NO INVENTÁRIO (atômico, exatamente uma vez).
-- Quando uma linha de produção é marcada como recebida (status 'delivered' e
-- recebido_em passa de NULL para preenchido), soma a quantidade RECEBIDA
-- (quantidade_recebida, que pode ser menor que a pedida — ex.: pediu 10, chegou 8)
-- ao estoque do PRODUTO. O produto já é "do local" pela categoria, então isso
-- atualiza o estoque da localização correta. Registra em estoque_log.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_producao_checkin_stock()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _qtd integer;
BEGIN
  -- Dispara SÓ na transição para recebido (evita somar de novo em edições futuras).
  IF NEW.status = 'delivered' AND NEW.recebido_em IS NOT NULL AND OLD.recebido_em IS NULL THEN
    _qtd := COALESCE(NEW.quantidade_recebida, NEW.quantidade);
    IF _qtd > 0 THEN
      UPDATE public.produtos
        SET estoque_total = estoque_total + _qtd
        WHERE id = NEW.produto_id;
      INSERT INTO public.estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
      SELECT NEW.produto_id, p.estoque_total - _qtd, p.estoque_total,
        'Production received (item ' || NEW.id || ', container ' || COALESCE(NEW.numero_container, '-') || ')'
      FROM public.produtos p WHERE p.id = NEW.produto_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producao_checkin_stock ON public.producao_pedidos;
CREATE TRIGGER trg_producao_checkin_stock
  AFTER UPDATE ON public.producao_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_producao_checkin_stock();
