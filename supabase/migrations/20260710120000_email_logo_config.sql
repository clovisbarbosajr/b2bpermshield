-- ============================================================================
-- Logo do email de confirmação de pedido: upload dedicado + posição no
-- cabeçalho (left/center/right). Usado pelo editor rico da aba
-- "Order Confirmation Email" (EmailTemplates.tsx) e, depois, pelo send-email.
-- ============================================================================
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_logo_url text,
  ADD COLUMN IF NOT EXISTS email_logo_position text NOT NULL DEFAULT 'left'
    CHECK (email_logo_position IN ('left', 'center', 'right'));
