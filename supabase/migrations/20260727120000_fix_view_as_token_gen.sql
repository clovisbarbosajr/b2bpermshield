-- ============================================================================
-- BUG: "Failed to start View as: function gen_random_bytes(integer) does not exist".
--
-- create_view_as_token gerava o token com encode(gen_random_bytes(24),'hex').
-- `gen_random_bytes` pertence a extensao pgcrypto, que no Supabase fica no schema
-- `extensions`. Como a funcao tem `SET search_path = public`, esse schema nao
-- esta no path e a chamada falha em runtime. (A linha existe desde a migration
-- original 20260319215104 com o mesmo search_path; provavelmente passou a
-- falhar quando o pgcrypto foi movido para `extensions`.)
--
-- CORRECAO: gerar o token com gen_random_uuid() — funcao NATIVA do Postgres
-- (pg_catalog, sempre no path), sem depender de extensao. Dois UUIDs sem hifen
-- = 64 chars hex, mais que os 48 de antes. Mantem o gate admin-only e o
-- search_path restrito.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_view_as_token(_customer_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _token TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create view-as tokens';
  END IF;

  -- Token = dois UUIDs aleatorios concatenados, sem hifens (64 chars hex).
  _token := replace(gen_random_uuid()::text, '-', '')
         || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.view_as_tokens (token, admin_user_id, customer_id)
  VALUES (_token, auth.uid(), _customer_id);

  RETURN _token;
END;
$$;

-- Preserva os grants ajustados na 20260726130000.
REVOKE EXECUTE ON FUNCTION public.create_view_as_token(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_view_as_token(UUID) TO authenticated;
