-- ============================================================================
-- Estoque em TEMPO REAL: habilita realtime na tabela produtos para o admin
-- (Estoque/InventoryControl) e o catálogo do cliente verem estoque mudar ao vivo
-- conforme os itens são comprados (sem refresh manual).
-- ============================================================================
ALTER TABLE public.produtos REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.produtos;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- já está na publicação
  WHEN undefined_object THEN NULL;  -- publicação não existe neste ambiente
END $$;
