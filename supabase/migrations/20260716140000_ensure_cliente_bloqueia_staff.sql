-- ============================================================================
-- FECHA DEFINITIVAMENTE o caso "Nextgen Flooring": STAFF nunca pode ganhar nem
-- reivindicar (claim por email) uma linha de `clientes`. Era a porta que deixou
-- o login admin da jess atrelado a um registro de cliente — daí todo view-as
-- dela resolvia pra empresa errada. O frontend já evita, mas a RPC é executável
-- por qualquer authenticated — a trava precisa ser no servidor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ensure_my_cliente_record(_nome text DEFAULT '', _empresa text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid   uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _cid   uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;

  -- STAFF (admin/manager/warehouse) NÃO é cliente: nunca cria nem vincula.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin','manager','warehouse')
  ) THEN
    RETURN NULL;
  END IF;

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

  -- cliente novo: cria SEMPRE com defaults seguros.
  INSERT INTO public.clientes (user_id, nome, email, empresa, status, can_confirm_order, parent_customer_id, tabela_preco_id)
  VALUES (_uid, COALESCE(NULLIF(_nome, ''), NULLIF(_email, ''), 'Cliente'), _email, COALESCE(_empresa, ''),
          'pendente', false, NULL, NULL)
  RETURNING id INTO _cid;
  RETURN _cid;
END; $$;
