-- ============================================================================
-- Colunas de segredo do Stripe que faltavam em `configuracoes`.
-- A migração 20260618000003 adicionou stripe_enabled + stripe_publishable_key,
-- mas NÃO criou stripe_secret_key nem stripe_webhook_secret — embora a edge
-- function `stripe-checkout` e a tela de Configurações já as usem. Sem elas o
-- Stripe não liga (erro: column "stripe_secret_key" does not exist).
--
-- A secreta fica só nesta tabela (RLS: só staff lê; cliente nunca vê — o
-- get_public_config só devolve a publicável). Lida pela edge via service role.
-- ============================================================================
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS stripe_secret_key     text;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS stripe_webhook_secret text;
