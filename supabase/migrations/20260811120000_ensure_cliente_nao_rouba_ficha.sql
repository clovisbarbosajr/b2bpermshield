-- ============================================================================
-- `ensure_my_cliente_record` podia TOMAR a ficha de um cliente que já tem dono.
--
-- A vinculação por e-mail era `UPDATE clientes SET user_id = _uid WHERE id = _cid`,
-- sem nenhuma condição sobre o dono atual. A migration 20260726120000 descreve
-- exatamente esse risco ("tomada de conta: junto vão pedidos, endereços, price
-- list e preços por cliente") e aplicou a trava — mas em `claim_customer_record`,
-- que é CÓDIGO MORTO: não é chamada em lugar nenhum do app. Quem roda em TODO
-- login é esta função (`AuthContext.tsx`, via `ensureClienteRecord`).
--
-- POR QUE NÃO DÁ PRA USAR `AND user_id IS NULL`:
-- o sync do B2BWave insere cliente migrado com `user_id: crypto.randomUUID()`
-- (b2bwave-sync/index.ts) — um UUID que NÃO existe em `auth.users`, já que a FK
-- para `auth.users` foi removida em 20260319152251. Com o `IS NULL` puro, TODO
-- cliente migrado deixaria de reivindicar a própria ficha: cairia no INSERT do
-- final e ganharia uma ficha nova `pendente`, perdendo pedidos, endereços e
-- tabela de preço. Seria pior que o problema.
--
-- Predicado correto: vincula quando a ficha NÃO tem dono real — ou `user_id`
-- nulo, ou apontando para um usuário que não existe (o caso dos migrados).
-- Ficha de um login DE VERDADE fica intocável.
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

  -- Ficha com este e-mail e SEM DONO REAL (nula ou órfã do sync) -> vincula.
  -- Uma ficha que já pertence a um login existente NÃO é tocada.
  IF _email <> '' THEN
    SELECT c.id INTO _cid
    FROM public.clientes c
    WHERE lower(c.email) = _email
      AND (
        c.user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id)
      )
    ORDER BY c.created_at ASC
    LIMIT 1;

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

-- `claim_customer_record` era a versão endurecida da mesma lógica, mas nunca foi
-- chamada. Fica registrado aqui para quem for procurar: NÃO usar, a função viva
-- é a de cima. (Não removida para não quebrar nada que a referencie externamente.)
COMMENT ON FUNCTION public.claim_customer_record() IS
  'CODIGO MORTO: nao e chamada pelo app. A vinculacao real acontece em ensure_my_cliente_record.';
