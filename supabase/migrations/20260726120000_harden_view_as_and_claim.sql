-- ============================================================================
-- Duas falhas de segurança achadas na varredura de 26/jul/2026.
--
-- (1) consume_view_as_token não checava NADA sobre quem chama. O token viaja na
--     QUERY STRING de /view-as?token=... (fica em histórico, Referer, logs) e a
--     RPC é executável por qualquer um com a anon key (que é pública no site).
--     Quem obtivesse a string resgatava id/user_id/empresa/nome/email/price list
--     de outro cliente. Agora só o ADMIN QUE CRIOU o token consegue consumi-lo.
--     Isso NÃO muda o fluxo real: a aba nova do "View as" roda na mesma sessão
--     de admin que gerou o token.
--
-- (2) claim_customer_record ficou de fora do endurecimento de 16/07
--     (20260716140000), que fechou o caso "Nextgen Flooring" apenas na função
--     irmã ensure_my_cliente_record. A claim continuava: sem bloqueio de STAFF
--     (um login admin/manager podia se atrelar a uma ficha de `clientes` — o
--     próprio bug que a migration alegou ter fechado) e SOBRESCREVENDO o
--     user_id de uma ficha que já pertencia a outro login (tomada de conta:
--     junto vão pedidos, endereços, price list e preços por cliente).
-- ============================================================================

-- (1) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_view_as_token(_token TEXT)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  empresa TEXT,
  nome TEXT,
  email TEXT,
  tabela_preco_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _token_row public.view_as_tokens%ROWTYPE;
BEGIN
  -- Só o admin que criou o token pode consumi-lo.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  SELECT * INTO _token_row
  FROM public.view_as_tokens
  WHERE token = _token
    AND used_at IS NULL
    AND expires_at > now()
    AND admin_user_id = auth.uid()
  LIMIT 1;

  -- Mensagem genérica de propósito: não revela se o token existe.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  UPDATE public.view_as_tokens
  SET used_at = now()
  WHERE id = _token_row.id;

  RETURN QUERY
  SELECT c.id, c.user_id, c.empresa, c.nome, c.email, c.tabela_preco_id
  FROM public.clientes c
  WHERE c.id = _token_row.customer_id;
END;
$$;

-- Anônimo não tem o que fazer aqui (o fluxo exige sessão de admin).
REVOKE EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) FROM anon;

-- (2) ─────────────────────────────────────────────────────────────────────────
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

  -- STAFF (admin/manager/warehouse) NÃO é cliente: nunca vincula nem cria.
  -- Mesma trava de ensure_my_cliente_record (20260716140000).
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin','manager','warehouse')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _cid FROM public.clientes WHERE user_id = _uid LIMIT 1;

  IF _cid IS NULL AND _email <> '' THEN
    -- `user_id IS NULL`: só adota ficha LIVRE (ex.: vinda do sync). Sem isto,
    -- a RPC roubava a ficha de um cliente que já tinha login.
    SELECT id INTO _cid FROM public.clientes
      WHERE lower(email) = _email AND user_id IS NULL
      ORDER BY created_at ASC LIMIT 1;
    IF _cid IS NOT NULL THEN
      UPDATE public.clientes SET user_id = _uid WHERE id = _cid AND user_id IS NULL;
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
