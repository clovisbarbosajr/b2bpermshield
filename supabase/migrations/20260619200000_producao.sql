-- ============================================================================
-- Módulo PRODUÇÃO (produtos em produção / mercadoria a caminho).
-- Cada linha = um produto solicitado p/ produção. NÃO entra no estoque ao criar;
-- só entra no INVENTÁRIO quando recebido (check-in), somando ao estoque do produto
-- (que já é "do local" pela categoria). Status: solicitado → a_caminho → delivered.
-- Localização = a categoria do produto (regra B2BWave).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.producao_pedidos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id          uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  quantidade          integer NOT NULL CHECK (quantidade > 0),
  est_entrega         date,                 -- estimativa (nem sempre há)
  numero_ordem        text,                 -- opcional
  numero_container    text,                 -- opcional
  status              text NOT NULL DEFAULT 'solicitado'
                        CHECK (status IN ('solicitado', 'a_caminho', 'delivered')),
  tracking            text,                 -- nº de rastreamento (ao pôr → a_caminho)
  quantidade_recebida integer,              -- preenchido no check-in (pode diferir do pedido)
  recebido_em         timestamptz,          -- quando deu check-in (entrou no estoque)
  recebido_por        uuid,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producao_pedidos_status_idx  ON public.producao_pedidos (status);
CREATE INDEX IF NOT EXISTS producao_pedidos_produto_idx ON public.producao_pedidos (produto_id);

ALTER TABLE public.producao_pedidos ENABLE ROW LEVEL SECURITY;

-- Staff interno (admin/manager/warehouse) gerencia a produção.
DROP POLICY IF EXISTS "Staff manage producao" ON public.producao_pedidos;
CREATE POLICY "Staff manage producao" ON public.producao_pedidos
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
  );

CREATE TRIGGER set_updated_at_producao BEFORE UPDATE ON public.producao_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
