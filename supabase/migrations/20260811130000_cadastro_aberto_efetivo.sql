-- ============================================================================
-- "Allow open customer registration" era um controle MORTO.
--
-- `configuracoes.permite_cadastro_aberto` só era lido pelas 3 telas de admin que
-- desenham o próprio checkbox (Profile, SetupApp, Configuracoes). A tela pública
-- `/cadastro` chama `supabase.auth.signUp()` direto, e a edge `register-customer`
-- também não olhava a coluna: desmarcar não fechava nada.
--
-- A tela pública roda como `anon`, e `get_public_config` só é concedida a
-- `authenticated` — por isso esta RPC mínima, que devolve APENAS este booleano.
-- Não expõe mais nada de `configuracoes`.
--
-- FAIL-OPEN de propósito: sem linha de configuração, devolve TRUE (cadastro
-- aberto), que é o comportamento de hoje. Assim ligar esta trava nunca fecha o
-- cadastro por acidente — só fecha se o admin realmente desmarcou.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registration_is_open()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permite_cadastro_aberto FROM public.configuracoes LIMIT 1),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.registration_is_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_is_open() TO anon, authenticated;
