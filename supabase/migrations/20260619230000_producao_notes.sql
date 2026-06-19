-- Notes por item de produção (anotações sobre o container/pedido).
ALTER TABLE public.producao_pedidos ADD COLUMN IF NOT EXISTS notes text;
