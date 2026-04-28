-- Add pdf_order_template column to configuracoes for customizable PDF layout
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS pdf_order_template TEXT;
