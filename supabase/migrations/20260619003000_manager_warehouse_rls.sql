-- ============================================================================
-- RLS para MANAGER e WAREHOUSE (antes a UI prometia acesso mas o banco bloqueava
-- tudo — só admin funcionava). Escopo decidido pelo dono:
--   • MANAGER = sub-admin: CRUD em pedidos/itens/clientes/enderecos/produtos.
--               NÃO mexe em usuários nem segredos (não tocado aqui).
--   • WAREHOUSE = logística: VÊ pedidos/itens/clientes/endereços/produtos;
--               muda STATUS de pedido (UPDATE pedidos) e AJUSTA ESTOQUE
--               (UPDATE produtos). SEM insert/delete, SEM settings/segredos.
-- Policies são ADITIVAS (OR com as existentes de admin/cliente) — nada é removido.
-- ============================================================================

-- Helper: operação interna (admin OU manager). SECURITY DEFINER + search_path fixo.
CREATE OR REPLACE FUNCTION public.is_ops_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager');
$$;

-- ───────── PEDIDOS ─────────
DROP POLICY IF EXISTS "Managers manage pedidos" ON public.pedidos;
CREATE POLICY "Managers manage pedidos" ON public.pedidos
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());

DROP POLICY IF EXISTS "Warehouse read pedidos" ON public.pedidos;
CREATE POLICY "Warehouse read pedidos" ON public.pedidos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

DROP POLICY IF EXISTS "Warehouse update pedidos" ON public.pedidos;
CREATE POLICY "Warehouse update pedidos" ON public.pedidos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'warehouse'))
  WITH CHECK (public.has_role(auth.uid(), 'warehouse'));

-- ───────── PEDIDO_ITENS ─────────
DROP POLICY IF EXISTS "Managers manage pedido_itens" ON public.pedido_itens;
CREATE POLICY "Managers manage pedido_itens" ON public.pedido_itens
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());

DROP POLICY IF EXISTS "Warehouse read pedido_itens" ON public.pedido_itens;
CREATE POLICY "Warehouse read pedido_itens" ON public.pedido_itens
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

-- ───────── CLIENTES ─────────
DROP POLICY IF EXISTS "Managers manage clientes" ON public.clientes;
CREATE POLICY "Managers manage clientes" ON public.clientes
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());

DROP POLICY IF EXISTS "Warehouse read clientes" ON public.clientes;
CREATE POLICY "Warehouse read clientes" ON public.clientes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

-- ───────── ENDERECOS (entrega — warehouse precisa ver p/ logística) ─────────
DROP POLICY IF EXISTS "Managers manage enderecos" ON public.enderecos;
CREATE POLICY "Managers manage enderecos" ON public.enderecos
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());

DROP POLICY IF EXISTS "Warehouse read enderecos" ON public.enderecos;
CREATE POLICY "Warehouse read enderecos" ON public.enderecos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

-- ───────── PRODUTOS (SELECT já é público; manager CRUD; warehouse só UPDATE p/ estoque) ─────────
DROP POLICY IF EXISTS "Managers manage produtos" ON public.produtos;
CREATE POLICY "Managers manage produtos" ON public.produtos
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());

DROP POLICY IF EXISTS "Warehouse update produtos" ON public.produtos;
CREATE POLICY "Warehouse update produtos" ON public.produtos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'warehouse'))
  WITH CHECK (public.has_role(auth.uid(), 'warehouse'));
