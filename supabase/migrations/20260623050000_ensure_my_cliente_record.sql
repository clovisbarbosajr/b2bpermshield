-- ============================================================================
-- Signup de cliente NOVO estava quebrado: o front fazia INSERT direto em `clientes`,
-- mas não há policy de INSERT para authenticated (a anon foi removida) -> RLS bloqueia
-- e a conta nunca ganha registro em `clientes`. Não dá pra abrir um INSERT policy
-- simples, senão o cliente insere já com tabela_preco_id/can_confirm_order/parent
-- forjados (o trava-colunas só roda em UPDATE). Esta RPC cria com defaults SEGUROS
-- forçados (e também vincula um registro vindo do sync pelo email, igual claim).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ensure_my_cliente_record(_nome text DEFAULT '', _empresa text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid   uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _cid   uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;

  -- já tem registro pelo user_id?
  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;
  IF _cid IS NOT NULL THEN RETURN _cid; END IF;

  -- existe um registro (ex.: vindo do sync) com este email? vincula a este login.
  IF _email <> '' THEN
    SELECT id INTO _cid FROM public.clientes WHERE lower(email) = _email ORDER BY created_at ASC LIMIT 1;
    IF _cid IS NOT NULL THEN
      UPDATE public.clientes SET user_id = _uid WHERE id = _cid;
      RETURN _cid;
    END IF;
  END IF;

  -- cliente novo: cria SEMPRE com defaults seguros (cliente não escolhe price list,
  -- aprovação de pedido, parent nem status).
  INSERT INTO public.clientes (user_id, nome, email, empresa, status, can_confirm_order, parent_customer_id, tabela_preco_id)
  VALUES (_uid, COALESCE(NULLIF(_nome, ''), NULLIF(_email, ''), 'Cliente'), _email, COALESCE(_empresa, ''),
          'pendente', false, NULL, NULL)
  RETURNING id INTO _cid;
  RETURN _cid;
END; $$;
GRANT EXECUTE ON FUNCTION public.ensure_my_cliente_record(text, text) TO authenticated;
