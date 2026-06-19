-- ===== 20260618233000_fix_anon_enderecos_privacy =====
DROP POLICY IF EXISTS "Anon can insert enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can update enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can delete enderecos" ON public.enderecos;
DROP POLICY IF EXISTS "Anon can read enderecos"   ON public.enderecos;
DROP POLICY IF EXISTS "Anon can insert cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can update cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can delete cliente_privacy_groups" ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Anon can read cliente_privacy_groups"   ON public.cliente_privacy_groups;
DROP POLICY IF EXISTS "Clients read own privacy groups" ON public.cliente_privacy_groups;
CREATE POLICY "Clients read own privacy groups" ON public.cliente_privacy_groups
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = cliente_privacy_groups.cliente_id
      AND c.user_id = auth.uid()
  ));

-- ===== 20260618234500_atomic_stock_reserve  (será sobrescrita por 20260619002000) =====
-- ===== 20260619000000_claim_customer_record =====
CREATE OR REPLACE FUNCTION public.claim_customer_record()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _cid   uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;
  IF _cid IS NULL AND _email <> '' THEN
    SELECT id INTO _cid FROM public.clientes
      WHERE lower(email) = _email ORDER BY created_at ASC LIMIT 1;
    IF _cid IS NOT NULL THEN
      UPDATE public.clientes SET user_id = _uid WHERE id = _cid;
    END IF;
  END IF;
  IF _cid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT _uid, 'cliente'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid);
  END IF;
  RETURN _cid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_customer_record() TO authenticated;

-- ===== 20260619001000_notif_dedup_email =====
UPDATE public.notification_events
SET channels = array_remove(channels, 'email')
WHERE id IN ('new_order', 'order_status', 'new_customer', 'account_approved');

-- ===== 20260619002000_fix_preorder_status_match (versão final do trigger) =====
CREATE OR REPLACE FUNCTION public.fn_reserve_stock_on_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _backorder boolean;
  _status    text;
  _enforce   boolean;
  _updated   int;
BEGIN
  SELECT permitir_backorder, status_produto
    INTO _backorder, _status
  FROM produtos WHERE id = NEW.produto_id;

  _enforce :=
        auth.role() = 'authenticated'
    AND NOT public.has_role(auth.uid(), 'admin')
    AND _backorder IS NOT TRUE
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%venda%'
    AND lower(coalesce(_status, '')) NOT LIKE '%pre%order%'
    AND lower(coalesce(_status, '')) NOT LIKE '%encomenda%';

  IF _enforce THEN
    UPDATE produtos
    SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id
      AND (estoque_total - estoque_reservado) >= NEW.quantidade;
    GET DIAGNOSTICS _updated = ROW_COUNT;
    IF _updated = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK'
        USING ERRCODE = 'check_violation',
              MESSAGE = 'Insufficient stock for product ' || NEW.produto_id;
    END IF;
  ELSE
    UPDATE produtos
    SET estoque_reservado = estoque_reservado + NEW.quantidade
    WHERE id = NEW.produto_id;
  END IF;

  INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
  SELECT
    NEW.produto_id,
    p.estoque_total - (p.estoque_reservado - NEW.quantidade),
    p.estoque_total - p.estoque_reservado,
    'Order item reserved (order ' || NEW.pedido_id || ')'
  FROM produtos p WHERE p.id = NEW.produto_id;

  RETURN NEW;
END;
$$;

-- ===== 20260619003000_manager_warehouse_rls =====
CREATE OR REPLACE FUNCTION public.is_ops_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager');
$$;

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

DROP POLICY IF EXISTS "Managers manage pedido_itens" ON public.pedido_itens;
CREATE POLICY "Managers manage pedido_itens" ON public.pedido_itens
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());
DROP POLICY IF EXISTS "Warehouse read pedido_itens" ON public.pedido_itens;
CREATE POLICY "Warehouse read pedido_itens" ON public.pedido_itens
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

DROP POLICY IF EXISTS "Managers manage clientes" ON public.clientes;
CREATE POLICY "Managers manage clientes" ON public.clientes
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());
DROP POLICY IF EXISTS "Warehouse read clientes" ON public.clientes;
CREATE POLICY "Warehouse read clientes" ON public.clientes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

DROP POLICY IF EXISTS "Managers manage enderecos" ON public.enderecos;
CREATE POLICY "Managers manage enderecos" ON public.enderecos
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());
DROP POLICY IF EXISTS "Warehouse read enderecos" ON public.enderecos;
CREATE POLICY "Warehouse read enderecos" ON public.enderecos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'warehouse'));

DROP POLICY IF EXISTS "Managers manage produtos" ON public.produtos;
CREATE POLICY "Managers manage produtos" ON public.produtos
  FOR ALL TO authenticated
  USING (public.is_ops_manager()) WITH CHECK (public.is_ops_manager());
DROP POLICY IF EXISTS "Warehouse update produtos" ON public.produtos;
CREATE POLICY "Warehouse update produtos" ON public.produtos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'warehouse'))
  WITH CHECK (public.has_role(auth.uid(), 'warehouse'));