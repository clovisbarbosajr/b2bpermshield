-- ============================================================================
-- Liga o usuário autenticado ao seu registro em `clientes`.
-- Problema: o sync do B2BWave cria `clientes` com `user_id` ALEATÓRIO
-- (crypto.randomUUID), não vinculado a nenhum login real. Quando o cliente
-- sincronizado de fato loga, `clientes.user_id` != `auth.uid()` → o Checkout
-- não acha o registro ("Client not found") e/ou cria um duplicado vazio.
--
-- Solução: RPC SECURITY DEFINER que pega o email do JWT (não falsificável) e
-- vincula o registro de mesmo email a este login. Contorna o RLS com segurança
-- (o cliente não conseguiria fazer esse UPDATE sozinho, pois a linha ainda não é
-- dele). Idempotente: se já estiver linkado, só retorna o id.
-- ============================================================================
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

  -- Já vinculado a este login?
  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;

  -- Senão, vincula o registro de MESMO email (o mais antigo = o vindo do sync).
  IF _cid IS NULL AND _email <> '' THEN
    SELECT id INTO _cid FROM public.clientes
      WHERE lower(email) = _email ORDER BY created_at ASC LIMIT 1;
    IF _cid IS NOT NULL THEN
      UPDATE public.clientes SET user_id = _uid WHERE id = _cid;
    END IF;
  END IF;

  -- Tem registro de cliente → garante o papel 'cliente' p/ acessar o portal.
  -- Só insere se o usuário NÃO tem papel (nunca sobrescreve admin/manager/warehouse).
  IF _cid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT _uid, 'cliente'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid);
  END IF;

  RETURN _cid; -- NULL = cliente novo de verdade (o app cria um registro pendente).
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_customer_record() TO authenticated;
