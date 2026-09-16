-- ============================================================================
-- MINHA CONTA — o sub-login le a linha da EMPRESA (so as colunas que precisa)
--
-- ORDEM: 1o rodar ESTE SQL, 2o publicar o front (`src/lib/contaDaEmpresa.ts`).
-- Ao contrario, o front novo chama `minha_conta` antes dela existir e o preco do
-- sub-login passa a LANCAR em vez de mostrar preco errado.
--
-- POR QUE. Sub-login (`clientes.parent_customer_id` preenchido) nao consegue ler
-- a ficha da empresa: a RLS de `clientes` so libera `auth.uid() = user_id`. A
-- policy que liberava (`Contacts read company cliente`) caiu junto com
-- `is_company_contact`, dropada com CASCADE em 20260622000000. `pricing.ts` lia o
-- pai com `.maybeSingle()` e recebia `null` SEM erro, entao a `tabela_preco_id`
-- da empresa nunca chegava: a tela mostrava preco BASE e o banco
-- (`preco_autoritativo`, SECURITY DEFINER, `COALESCE(sub, conta)`) cobrava LISTA.
--
-- POR QUE RPC E NAO POLICY. Uma policy de SELECT devolveria a linha INTEIRA do
-- pai (credito, status, notas...). A funcao devolve 7 colunas e NAO recebe
-- parametro: responde so sobre QUEM CHAMA (`auth.uid()`), entao nao vira oraculo
-- para perguntar pela conta de outra pessoa — mesmo desenho de
-- `minha_conta_liberada` (20260825280000).
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- DIAGNOSTICO — quantos sub-logins sao afetados hoje:
--
--   SELECT count(*) AS sub_logins,
--          count(*) FILTER (WHERE s.tabela_preco_id IS NULL
--                             AND p.tabela_preco_id IS NOT NULL) AS viam_preco_base
--     FROM clientes s JOIN clientes p ON p.id = s.parent_customer_id;
-- ---------------------------------------------------------------------------

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.minha_conta()
RETURNS TABLE (id uuid, tabela_preco_id uuid, endereco text, endereco2 text, cidade text, estado text, cep text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dono.id, dono.tabela_preco_id, dono.endereco::text, dono.endereco2::text,
         dono.cidade::text, dono.estado::text, dono.cep::text
  FROM public.clientes me
  JOIN public.clientes dono ON dono.id = COALESCE(me.parent_customer_id, me.id)
  WHERE me.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.minha_conta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_conta() TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- 1o reverter o front (senao o preco do sub-login lanca), 2o:
--   DROP FUNCTION IF EXISTS public.minha_conta();
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- Rapida — a funcao existe:
--   SELECT count(*) FROM pg_proc WHERE proname = 'minha_conta';   -- 1
--
-- Completa — nao grava nada (ROLLBACK). Um sub-login ve a tabela da empresa:
--   BEGIN;
--   WITH pai AS (INSERT INTO clientes (nome, email, user_id, cidade)
--                VALUES ('ZZVERIF-pai', 'zzverif-pai@example.invalid', gen_random_uuid(), 'ZZVERIF-cidade')
--                RETURNING id)
--   INSERT INTO clientes (nome, email, user_id, parent_customer_id)
--   SELECT 'ZZVERIF-sub', 'zzverif-sub@example.invalid', gen_random_uuid(), pai.id FROM pai;
--   SELECT set_config('request.jwt.claim.sub',
--          (SELECT user_id::text FROM clientes WHERE nome = 'ZZVERIF-sub'), true);
--   SELECT id = (SELECT id FROM clientes WHERE nome = 'ZZVERIF-pai') AS e_o_pai,
--          cidade = 'ZZVERIF-cidade' AS cidade_ok
--     FROM public.minha_conta();                                   -- true, true
--   ROLLBACK;
--
-- (Se algum gatilho de `clientes` recusar a ficha de teste, usar a rapida.)
-- ---------------------------------------------------------------------------
