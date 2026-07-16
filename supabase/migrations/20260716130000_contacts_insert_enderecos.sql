-- ============================================================================
-- Checkout: sub-usuário (company contact buyer/manager) pode ADICIONAR endereço
-- de entrega da empresa. O titular já podia ("Clients can manage own enderecos");
-- contatos só tinham SELECT — o form novo do checkout falharia pra eles.
-- ============================================================================
DROP POLICY IF EXISTS "Contacts insert company enderecos" ON public.enderecos;
CREATE POLICY "Contacts insert company enderecos" ON public.enderecos
  FOR INSERT WITH CHECK (public.is_company_buyer(cliente_id));
