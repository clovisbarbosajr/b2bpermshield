-- Produção: campo "Est Ready" (estimativa de quando fica PRONTO, antes do ETA/entrega).
-- est_entrega passa a ser exibido como "ETA" no front (coluna mantida).
ALTER TABLE public.producao_pedidos ADD COLUMN IF NOT EXISTS est_ready date;
