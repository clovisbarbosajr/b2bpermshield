-- ============================================================================
-- RLS das tabelas de referência do CHECKOUT. Estavam só `TO anon` (ou só admin),
-- então:
--   (a) cliente LOGADO (role authenticated) não lia payment/shipping options,
--       atribuições nem tabelas de imposto -> checkout quebrado p/ logado
--       (sem opção de pagamento/frete, imposto 0).
--   (b) a leitura anon de payment/shipping ignorava `privado`/`show_to_customers`
--       -> qualquer um com a anon key via opções PRIVADAS (Pay Later/Zelle/wire
--       restritos). O dono quer o cliente vendo só o que é dele.
-- Correção: visibilidade imposta na RLS (não só no JS), com herança sub-user->pai.
-- ============================================================================

-- Helper: a opção (pagamento) está atribuída à CONTA do usuário logado (própria ou do pai)?
CREATE OR REPLACE FUNCTION public.cliente_ve_payment_option(_opt uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cliente_payment_options cpo
    WHERE cpo.payment_option_id = _opt
      AND cpo.cliente_id = (SELECT COALESCE(parent_customer_id, id)
                            FROM public.clientes WHERE user_id = auth.uid() LIMIT 1)
  );
$$;
CREATE OR REPLACE FUNCTION public.cliente_ve_shipping_option(_opt uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cliente_shipping_options cso
    WHERE cso.shipping_option_id = _opt
      AND cso.cliente_id = (SELECT COALESCE(parent_customer_id, id)
                            FROM public.clientes WHERE user_id = auth.uid() LIMIT 1)
  );
$$;

-- payment_options: visível se ativo E (pública OU atribuída à conta). Anon só públicas.
DROP POLICY IF EXISTS "Anon can read payment_options" ON public.payment_options;
DROP POLICY IF EXISTS "Read visible payment_options" ON public.payment_options;
CREATE POLICY "Read visible payment_options" ON public.payment_options
  FOR SELECT TO authenticated, anon
  USING (ativo = true AND (privado IS NOT TRUE OR public.cliente_ve_payment_option(id)));

-- shipping_options: idem + respeita show_to_customers.
DROP POLICY IF EXISTS "Anon can read shipping_options" ON public.shipping_options;
DROP POLICY IF EXISTS "Read visible shipping_options" ON public.shipping_options;
CREATE POLICY "Read visible shipping_options" ON public.shipping_options
  FOR SELECT TO authenticated, anon
  USING (ativo = true AND show_to_customers IS NOT FALSE
         AND (privado IS NOT TRUE OR public.cliente_ve_shipping_option(id)));

-- Atribuições: o cliente lê as DELE (própria conta ou do pai). Antes: só admin.
DROP POLICY IF EXISTS "Customer reads own payment option assignments" ON public.cliente_payment_options;
CREATE POLICY "Customer reads own payment option assignments" ON public.cliente_payment_options
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clientes c WHERE c.user_id = auth.uid()
                 AND (c.id = cliente_payment_options.cliente_id
                      OR c.parent_customer_id = cliente_payment_options.cliente_id)));
DROP POLICY IF EXISTS "Customer reads own shipping option assignments" ON public.cliente_shipping_options;
CREATE POLICY "Customer reads own shipping option assignments" ON public.cliente_shipping_options
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clientes c WHERE c.user_id = auth.uid()
                 AND (c.id = cliente_shipping_options.cliente_id
                      OR c.parent_customer_id = cliente_shipping_options.cliente_id)));

-- Imposto: cliente logado precisa ler pra calcular (valores não são sensíveis).
DROP POLICY IF EXISTS "Authenticated read tax_classes" ON public.tax_classes;
CREATE POLICY "Authenticated read tax_classes" ON public.tax_classes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read tax_rates" ON public.tax_rates;
CREATE POLICY "Authenticated read tax_rates" ON public.tax_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read tax_customer_groups" ON public.tax_customer_groups;
CREATE POLICY "Authenticated read tax_customer_groups" ON public.tax_customer_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read tax_rules" ON public.tax_rules;
CREATE POLICY "Authenticated read tax_rules" ON public.tax_rules FOR SELECT TO authenticated USING (true);

-- Cupom: cliente logado precisa validar o código no checkout.
DROP POLICY IF EXISTS "Authenticated read active coupons" ON public.coupons;
CREATE POLICY "Authenticated read active coupons" ON public.coupons FOR SELECT TO authenticated USING (ativo = true);
