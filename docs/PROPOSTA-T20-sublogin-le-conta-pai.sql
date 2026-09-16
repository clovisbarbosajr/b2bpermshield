-- PROPOSTA (NAO APLICADA) — T20: sub-login precisa ler a linha da EMPRESA em
-- `clientes` para o front resolver a tabela de preco herdada.
--
-- Hoje: `preco_autoritativo` (SECURITY DEFINER) usa
-- `_tpid := COALESCE(cliente.tabela_preco_id, conta.tabela_preco_id)`; o front
-- (`src/lib/pricing.ts`) pede a mesma linha do pai, mas a RLS de `clientes` so
-- deixa o cliente ler a PROPRIA linha ("Clients can read own data",
-- 20260317043654:181). A policy que liberava a conta da empresa ("Contacts read
-- company cliente", 20260618193846:48) caiu junto com
-- `DROP FUNCTION is_company_contact CASCADE` (20260622000000:154).
--
-- Efeito: sub-login SEM tabela propria, cujo pai TEM tabela, ve preco BASE na
-- tela enquanto o banco cobra o preco de tabela (tela mais cara que a cobranca;
-- a guarda do checkout nao barra). Preco combinado do pai NAO e afetado
-- (`produto_precos_cliente` ja libera via `is_subcustomer_of`).
--
-- Urgencia: baixa enquanto nao houver sub-login na base. Conferir antes:
--   SELECT count(*) FROM public.clientes WHERE parent_customer_id IS NOT NULL;
--
-- RESSALVA: esta policy expoe a linha INTEIRA do pai ao sub-login (e-mail,
-- telefone, endereco, status). Se isso nao for aceitavel, a alternativa e uma
-- RPC SECURITY DEFINER devolvendo so o `tabela_preco_id` efetivo.

DROP POLICY IF EXISTS "Sub-customer reads parent cliente" ON public.clientes;
CREATE POLICY "Sub-customer reads parent cliente" ON public.clientes
  FOR SELECT TO authenticated
  USING (public.is_subcustomer_of(id));

-- VERIFICACAO
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'clientes' ORDER BY 1;
-- ROLLBACK
-- DROP POLICY IF EXISTS "Sub-customer reads parent cliente" ON public.clientes;
