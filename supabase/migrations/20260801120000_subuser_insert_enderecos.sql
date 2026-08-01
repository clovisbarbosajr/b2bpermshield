-- ============================================================================
-- BUG: sub-usuário NÃO CONSEGUE salvar endereço de entrega no checkout.
--
-- Como o portal funciona: o endereço vem da conta da EMPRESA. O Checkout grava
-- com `cliente_id = parent_customer_id` (Checkout.tsx:122 `addressClienteId`),
-- tanto no "Add address" (`saveNewAddress`) quanto no default "__company__"
-- (`resolveEnderecoEntregaId`).
--
-- O que a RLS de `enderecos` permite hoje:
--   * "Clients can manage own enderecos" — FOR ALL USING (clientes.user_id = auth.uid()).
--     Numa policy FOR ALL sem WITH CHECK, o Postgres reusa o USING como WITH CHECK
--     no INSERT → o sub-usuário só grava com o PRÓPRIO cliente_id, nunca com o do pai.
--   * "Sub-customer reads parent addresses" — só SELECT.
--   * "Contacts insert company enderecos" (20260716130000) — nasceu morta: o bloco
--     `DO $$ ... IF EXISTS company_contacts` rodou DEPOIS de 20260622000000, que faz
--     `DROP TABLE company_contacts CASCADE` + `DROP FUNCTION is_company_buyer`.
--     A tabela não existia mais → caiu no ELSE (RAISE NOTICE) e nada foi criado.
--
-- Resultado: sub-usuário sem endereço já cadastrado pelo pai não fecha pedido.
-- O app avisa direito (o erro não é mais silencioso), mas não há como prosseguir.
--
-- Correção: INSERT de endereço da empresa liberado para o sub-usuário. UPDATE e
-- DELETE continuam só do titular/admin de propósito — funcionário adiciona local
-- de entrega, não mexe nos endereços já cadastrados da empresa.
-- ============================================================================

DROP POLICY IF EXISTS "Sub-customer inserts parent addresses" ON public.enderecos;
CREATE POLICY "Sub-customer inserts parent addresses" ON public.enderecos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_subcustomer_of(enderecos.cliente_id));

-- Limpa a policy natimorta, se por acaso ela existir em algum ambiente onde
-- `company_contacts` ainda estava de pé quando 20260716130000 rodou (ela chama
-- `is_company_buyer`, que foi dropada — a policy só daria erro no INSERT).
DROP POLICY IF EXISTS "Contacts insert company enderecos" ON public.enderecos;

COMMENT ON POLICY "Sub-customer inserts parent addresses" ON public.enderecos IS
  'Sub-usuário (clientes.parent_customer_id) adiciona endereço de entrega da empresa no checkout. Editar/remover continua com o titular.';
