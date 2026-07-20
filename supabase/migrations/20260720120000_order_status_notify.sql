-- ============================================================================
-- order_status SMS/notificação via TRIGGER (padrão do low_stock, que provou
-- funcionar no log). O disparo do frontend não estava chegando ao notify-dispatch;
-- o trigger no banco é confiável e independe de sessão/deploy do frontend.
-- Dispara em QUALQUER mudança real de status (admin, sync, etc.).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_order_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cli record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT nome, empresa, email, telefone INTO _cli FROM public.clientes WHERE id = NEW.cliente_id;
    BEGIN
      PERFORM net.http_post(
        url := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/notify-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name='PROJECT_ANON_KEY'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
        ),
        body := jsonb_build_object(
          'event', 'order_status',
          'vars', jsonb_build_object(
            'order_id', COALESCE(NEW.numero, 0),
            'status', NEW.status,
            'total', COALESCE(NEW.total, 0),
            'customer_name', COALESCE(_cli.nome, ''),
            'customer_company', COALESCE(_cli.empresa, ''),
            'customer_email', COALESCE(_cli.email, ''),
            'customer_phone', COALESCE(_cli.telefone, '')
          ),
          'customer', jsonb_build_object(
            'email', _cli.email, 'phone', _cli.telefone, 'whatsapp', _cli.telefone
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'order_status notify falhou (nao derruba o update): %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_status_notify ON public.pedidos;
CREATE TRIGGER trg_order_status_notify
  AFTER UPDATE OF status ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_order_status_notify();
