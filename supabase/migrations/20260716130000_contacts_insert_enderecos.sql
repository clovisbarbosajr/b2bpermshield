-- ============================================================================
-- Checkout: sub-usuário (company contact buyer/manager) pode ADICIONAR endereço
-- de entrega da empresa. O titular já podia ("Clients can manage own enderecos");
-- contatos só tinham SELECT — o form novo do checkout falharia pra eles.
-- Autossuficiente: is_company_buyer não existia no banco (migração 20260618000001
-- nunca aplicada) — cria a função se a tabela company_contacts existir; sem a
-- tabela não há sub-usuários e a policy é desnecessária (no-op com NOTICE).
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='company_contacts') THEN
    CREATE OR REPLACE FUNCTION public.is_company_buyer(_cliente_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $f$
      SELECT EXISTS (SELECT 1 FROM public.company_contacts cc
        WHERE cc.user_id = auth.uid() AND cc.cliente_id = _cliente_id AND cc.ativo = true
          AND cc.role IN ('buyer','manager'))
    $f$;
    DROP POLICY IF EXISTS "Contacts insert company enderecos" ON public.enderecos;
    CREATE POLICY "Contacts insert company enderecos" ON public.enderecos
      FOR INSERT WITH CHECK (public.is_company_buyer(cliente_id));
    RAISE NOTICE 'policy criada';
  ELSE
    RAISE NOTICE 'company_contacts nao existe - sem sub-usuarios, policy desnecessaria';
  END IF;
END $$;
