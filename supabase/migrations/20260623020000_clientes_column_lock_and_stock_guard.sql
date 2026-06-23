-- ============================================================================
-- BUG HUNT round 4 — SEGURANÇA (cliente) + consistência de estoque.
--  C1 (CRÍTICO): a policy "Clients can update own data" deixa o cliente atualizar
--     QUALQUER coluna da própria linha (USING/WITH CHECK só checam user_id). Um
--     cliente/sub-user podia: trocar tabela_preco_id p/ a de outro (ver price list
--     alheia), pôr can_confirm_order=true (auto-aprovar compra), mudar
--     parent_customer_id (herdar visibilidade de outra conta), reativar status/
--     is_active. WITH CHECK não compara com OLD -> precisa de trigger.
--  H2: pedido podia ser criado por conta pendente/inativa (só barrava no front).
--  S:  fn_adjust_stock_on_order_status não pulava pedido sincronizado -> mudança
--     de status vinda do B2BWave mexia no estoque local (B2BWave já é a fonte).
-- ============================================================================

-- C1) Trava colunas privilegiadas quando o PRÓPRIO cliente edita a linha.
--     Staff (admin/manager) e service_role (edge company-member) passam livres.
CREATE OR REPLACE FUNCTION public.fn_lock_privileged_cliente_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;
  -- cliente mexendo na própria linha: restaura as colunas sensíveis ao valor antigo
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
    NEW.user_id               := OLD.user_id;
    NEW.tabela_preco_id       := OLD.tabela_preco_id;
    NEW.representante_id      := OLD.representante_id;
    NEW.parent_customer_id    := OLD.parent_customer_id;
    NEW.can_confirm_order     := OLD.can_confirm_order;
    NEW.can_view_full_history := OLD.can_view_full_history;
    NEW.status                := OLD.status;
    NEW.is_active             := OLD.is_active;
    NEW.disable_ordering      := OLD.disable_ordering;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_lock_privileged_cliente_cols ON public.clientes;
CREATE TRIGGER trg_lock_privileged_cliente_cols BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_privileged_cliente_cols();

-- H2) Bloqueia criação de pedido por conta inativa/pendente (pedido do app, via
--     cliente). Sync (b2bwave_order_id) e staff passam. Denylist conservadora
--     (status desconhecido NÃO bloqueia -> não quebra cliente legítimo).
CREATE OR REPLACE FUNCTION public.fn_block_order_inactive_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st text; _act boolean;
BEGIN
  IF NEW.b2bwave_order_id IS NOT NULL
     OR auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;
  SELECT status::text, is_active INTO _st, _act FROM public.clientes WHERE id = NEW.cliente_id;
  IF _act IS FALSE
     OR lower(coalesce(_st,'')) IN ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked') THEN
    RAISE EXCEPTION 'This account is not active yet. Please wait for approval.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_block_order_inactive_customer ON public.pedidos;
CREATE TRIGGER trg_block_order_inactive_customer BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_order_inactive_customer();

-- S) Ajuste de estoque por status pula pedido SINCRONIZADO (B2BWave é a fonte;
--    o sync de produtos já traz quantity/quantity_reserved).
CREATE OR REPLACE FUNCTION public.fn_adjust_stock_on_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_cancel boolean := NEW.status::text IN ('cancelado','cancelled');
  _old_cancel boolean := OLD.status::text IN ('cancelado','cancelled');
  _new_done   boolean := NEW.status::text IN ('concluido','complete');
  _old_done   boolean := OLD.status::text IN ('concluido','complete');
BEGIN
  IF NEW.b2bwave_order_id IS NOT NULL THEN RETURN NEW; END IF;  -- pedido do sync: não mexe local
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF _new_cancel AND NOT _old_cancel THEN
    UPDATE produtos p SET estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;
    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id, p.estoque_total - (p.estoque_reservado + pi.quantidade),
           p.estoque_total - p.estoque_reservado, 'Stock returned - order cancelled (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id WHERE pi.pedido_id = NEW.id;
  END IF;

  IF _new_done AND NOT _old_done THEN
    UPDATE produtos p SET estoque_total = GREATEST(0, p.estoque_total - pi.quantidade),
           estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
    FROM pedido_itens pi WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;
    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id, p.estoque_total + pi.quantidade, p.estoque_total,
           'Stock deducted - order completed (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id WHERE pi.pedido_id = NEW.id;
  END IF;

  IF _old_cancel AND NOT _new_cancel THEN
    UPDATE produtos p SET estoque_reservado = p.estoque_reservado + pi.quantidade
    FROM pedido_itens pi WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;
    INSERT INTO estoque_log (produto_id, quantidade_anterior, quantidade_nova, motivo)
    SELECT pi.produto_id, p.estoque_total - (p.estoque_reservado - pi.quantidade),
           p.estoque_total - p.estoque_reservado, 'Stock re-reserved - order reactivated (' || NEW.id || ')'
    FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id WHERE pi.pedido_id = NEW.id;
  END IF;

  RETURN NEW;
END; $$;
