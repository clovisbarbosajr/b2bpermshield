-- ============================================================================
-- GATILHO REAL de low_stock. Até agora o evento existia (linha em
-- notification_events + UI + limite), mas NADA disparava — só o botão de teste.
-- Agora um trigger no `produtos` detecta quando o estoque disponível CRUZA o
-- limite (estava acima, ficou <=) e chama o notify-dispatch (evento low_stock).
--
-- Dedup natural: só dispara na TRANSIÇÃO (acima→abaixo). Enquanto continuar
-- abaixo, não repete; só volta a alertar se recuperar e cair de novo. Assim o
-- sync (que mexe no estoque toda hora) não spama.
--
-- Assíncrono (net.http_post enfileira) e à prova de falha (EXCEPTION) — uma
-- falha de notificação NUNCA derruba a atualização de estoque.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_low_stock_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _evt        record;
  _threshold  int;
  _avail_new  int;
  _avail_old  int;
BEGIN
  SELECT * INTO _evt FROM public.notification_events WHERE id = 'low_stock';
  IF _evt IS NULL OR _evt.enabled IS NOT TRUE THEN RETURN NEW; END IF;

  _threshold := COALESCE((_evt.extra->>'low_stock_threshold')::int, 5);
  _avail_new := COALESCE(NEW.estoque_total, 0) - COALESCE(NEW.estoque_reservado, 0);
  _avail_old := COALESCE(OLD.estoque_total, 0) - COALESCE(OLD.estoque_reservado, 0);

  -- Só ao CRUZAR o limite (evita repetir a cada update abaixo).
  IF _avail_old > _threshold AND _avail_new <= _threshold THEN
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

DROP TRIGGER IF EXISTS trg_low_stock_notify ON public.produtos;
CREATE TRIGGER trg_low_stock_notify
  AFTER UPDATE OF estoque_total, estoque_reservado ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_low_stock_notify();
