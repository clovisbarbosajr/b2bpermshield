-- ============================================================================
-- BUG: "Could not open View as: column reference "id" is ambiguous".
--
-- `consume_view_as_token` declara RETURNS TABLE (id UUID, user_id UUID, ...).
-- Em plpgsql, cada coluna do RETURNS TABLE vira uma VARIÁVEL de saída visível
-- no corpo. Então neste UPDATE:
--
--     UPDATE public.view_as_tokens SET used_at = now() WHERE id = _token_row.id;
--
-- o `id` do WHERE casa com DOIS nomes: a coluna `view_as_tokens.id` e a
-- variável de saída `id`. O Postgres não escolhe — aborta com 42702.
--
-- Só apareceu agora porque antes o fluxo morria ANTES, na criação do token
-- (`gen_random_bytes` fora do search_path, corrigido em 20260727120000).
-- Com a criação funcionando, o consumo passou a rodar e bateu neste erro.
--
-- CORREÇÃO: dar um alias à tabela no UPDATE (`t`) e qualificar `t.id`, que
-- resolve para a coluna sem ambiguidade. O SELECT inicial não precisa: nenhuma
-- das colunas que ele filtra (token, used_at, expires_at, admin_user_id) tem
-- nome igual a uma variável de saída. Mesmo assim ficou qualificado, para não
-- reabrir o problema se o RETURNS TABLE mudar.
--
-- Nada de comportamento muda: continua uso único, continua exigindo
-- `admin_user_id = auth.uid()`, e a mensagem de erro continua genérica.
-- ============================================================================
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

  SELECT t.* INTO _token_row
  FROM public.view_as_tokens t
  WHERE t.token = _token
    AND t.used_at IS NULL
    AND t.expires_at > now()
    AND t.admin_user_id = auth.uid()
  LIMIT 1;

  -- Mensagem genérica de propósito: não revela se o token existe.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  -- Alias obrigatório: sem ele, `id` colide com a variável de saída `id`.
  UPDATE public.view_as_tokens t
  SET used_at = now()
  WHERE t.id = _token_row.id;

  RETURN QUERY
  SELECT c.id, c.user_id, c.empresa, c.nome, c.email, c.tabela_preco_id
  FROM public.clientes c
  WHERE c.id = _token_row.customer_id;
END;
$$;

-- Preserva os grants da 20260726130000 (CREATE OR REPLACE mantém, mas fica
-- explícito para o caso de a função ser recriada do zero).
REVOKE EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) TO authenticated;
