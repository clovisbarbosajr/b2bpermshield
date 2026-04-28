CREATE TABLE IF NOT EXISTS public.view_as_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  admin_user_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.view_as_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_view_as_tokens_token ON public.view_as_tokens(token);
CREATE INDEX IF NOT EXISTS idx_view_as_tokens_customer_id ON public.view_as_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_view_as_tokens_expires_at ON public.view_as_tokens(expires_at);

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

  _token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.view_as_tokens (token, admin_user_id, customer_id)
  VALUES (_token, auth.uid(), _customer_id);

  RETURN _token;
END;
$$;

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
  SELECT * INTO _token_row
  FROM public.view_as_tokens
  WHERE token = _token
    AND used_at IS NULL
    AND expires_at > now()
  LIMIT 1;

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