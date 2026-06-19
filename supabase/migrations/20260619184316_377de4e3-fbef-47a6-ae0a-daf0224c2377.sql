CREATE TABLE IF NOT EXISTS public.producao_pedidos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id          uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  quantidade          integer NOT NULL CHECK (quantidade > 0),
  est_entrega         date,
  numero_ordem        text,
  numero_container    text,
  status              text NOT NULL DEFAULT 'solicitado'
                        CHECK (status IN ('solicitado', 'a_caminho', 'delivered')),
  tracking            text,
  quantidade_recebida integer,
  recebido_em         timestamptz,
  recebido_por        uuid,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.producao_pedidos TO authenticated;
GRANT ALL ON public.producao_pedidos TO service_role;

CREATE INDEX IF NOT EXISTS producao_pedidos_status_idx  ON public.producao_pedidos (status);
CREATE INDEX IF NOT EXISTS producao_pedidos_produto_idx ON public.producao_pedidos (produto_id);

ALTER TABLE public.producao_pedidos ENABLE ROW LEVEL SECURITY;

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

DROP TRIGGER IF EXISTS set_updated_at_producao ON public.producao_pedidos;
CREATE TRIGGER set_updated_at_producao BEFORE UPDATE ON public.producao_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();