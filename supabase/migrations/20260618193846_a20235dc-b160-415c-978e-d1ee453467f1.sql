-- A1: remove anon
DROP POLICY IF EXISTS "Anon can read clientes"            ON public.clientes;
DROP POLICY IF EXISTS "Anon can read pedidos"             ON public.pedidos;
DROP POLICY IF EXISTS "Anon can read pedido_itens"        ON public.pedido_itens;
DROP POLICY IF EXISTS "Anon can read tabelas_preco"       ON public.tabelas_preco;
DROP POLICY IF EXISTS "Anon can read tabela_preco_itens"  ON public.tabela_preco_itens;
DROP POLICY IF EXISTS "Anon can read produto_precos_cliente" ON public.produto_precos_cliente;
DROP POLICY IF EXISTS "Anon can read representantes"      ON public.representantes;
DROP POLICY IF EXISTS "Anon can insert clientes"          ON public.clientes;
DROP POLICY IF EXISTS "Anon can update clientes"          ON public.clientes;
DROP POLICY IF EXISTS "Anon can delete clientes"          ON public.clientes;

-- A2: configuracoes restrita a staff
DROP POLICY IF EXISTS "Authenticated can read configuracoes" ON public.configuracoes;
CREATE POLICY "Staff can read configuracoes" ON public.configuracoes
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );

CREATE OR REPLACE FUNCTION public.get_public_config()
RETURNS TABLE (stripe_enabled boolean, stripe_publishable_key text, catalog_pdf_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT false::boolean, NULL::text, catalog_pdf_url FROM public.configuracoes LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_config() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_config() TO authenticated;

-- B3: company_contacts helpers + policies
CREATE OR REPLACE FUNCTION public.is_company_contact(_cliente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_contacts cc
    WHERE cc.user_id = auth.uid() AND cc.cliente_id = _cliente_id AND cc.ativo = true)
$$;

CREATE OR REPLACE FUNCTION public.is_company_buyer(_cliente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_contacts cc
    WHERE cc.user_id = auth.uid() AND cc.cliente_id = _cliente_id AND cc.ativo = true
      AND cc.role IN ('buyer','manager'))
$$;

DROP POLICY IF EXISTS "Contacts read company cliente" ON public.clientes;
CREATE POLICY "Contacts read company cliente" ON public.clientes
  FOR SELECT USING (public.is_company_contact(id));

DROP POLICY IF EXISTS "Contacts read company enderecos" ON public.enderecos;
CREATE POLICY "Contacts read company enderecos" ON public.enderecos
  FOR SELECT USING (public.is_company_contact(cliente_id));

DROP POLICY IF EXISTS "Contacts read company pedidos" ON public.pedidos;
CREATE POLICY "Contacts read company pedidos" ON public.pedidos
  FOR SELECT USING (public.is_company_contact(cliente_id));
DROP POLICY IF EXISTS "Contacts insert company pedidos" ON public.pedidos;
CREATE POLICY "Contacts insert company pedidos" ON public.pedidos
  FOR INSERT WITH CHECK (public.is_company_buyer(cliente_id));

DROP POLICY IF EXISTS "Contacts read company pedido_itens" ON public.pedido_itens;
CREATE POLICY "Contacts read company pedido_itens" ON public.pedido_itens
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.pedidos p
    WHERE p.id = pedido_itens.pedido_id AND public.is_company_contact(p.cliente_id)));
DROP POLICY IF EXISTS "Contacts insert company pedido_itens" ON public.pedido_itens;
CREATE POLICY "Contacts insert company pedido_itens" ON public.pedido_itens
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p
    WHERE p.id = pedido_itens.pedido_id AND public.is_company_buyer(p.cliente_id)));

-- sync_state
CREATE TABLE IF NOT EXISTS public.sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_state TO authenticated;
GRANT ALL ON public.sync_state TO service_role;
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage sync_state" ON public.sync_state;
CREATE POLICY "Admins manage sync_state" ON public.sync_state
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS pedidos_numero_idx ON public.pedidos (numero);

CREATE OR REPLACE FUNCTION public._schedule_b2bwave_job(_jobname text, _cron text, _action text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = _jobname) THEN
    PERFORM cron.unschedule(_jobname);
  END IF;
  PERFORM cron.schedule(_jobname, _cron, format($job$
      select net.http_post(
        url := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/b2bwave-sync',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='PROJECT_ANON_KEY'),
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
        ),
        body := jsonb_build_object('action', %L)
      );
    $job$, _action));
END;
$$;

DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-orders',     '*/15 * * * *', 'cron_orders');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-customers',  '5-59/15 * * * *', 'sync_customers');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-products',   '10 * * * *',  'sync_products');
  PERFORM public._schedule_b2bwave_job('b2bwave-cron-pricelists', '20 * * * *',  'sync_price_lists');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'b2bwave cron setup pulado: %', SQLERRM;
END
$outer$;