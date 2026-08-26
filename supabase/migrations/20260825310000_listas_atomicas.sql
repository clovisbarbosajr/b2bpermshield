-- ============================================================================
-- "REGRAVA A LISTA INTEIRA" VIRA OPERACAO ATOMICA
--
-- O padrao `delete()` seguido de `insert()` aparece em varias telas de admin.
-- Feito pelo navegador, ele NAO e atomico: sao duas requisicoes. Se a segunda
-- falhar — rede, aba fechada, erro de validacao — a lista fica VAZIA.
--
-- Em quase todas as tabelas lista vazia significa "sem acesso", entao o estrago
-- e o cliente perder acesso (ruim, visivel, recuperavel). Em UMA delas o
-- significado e o oposto:
--
--   `user_locations` — a policy de `categorias` (20260619220000:43) diz
--   `OR NOT EXISTS (SELECT 1 FROM user_locations WHERE user_id = auth.uid())`.
--   LISTA VAZIA = VE TUDO. Se a aba morrer entre o delete e o insert, o
--   funcionario que estava restrito a uma localidade passa a ver TODAS, em
--   silencio, e a tela nem chegou a dizer que salvou.
--
-- A tela ja checa o erro do INSERT e avisa ("the user is now UNRESTRICTED") —
-- ou seja, alguem viu metade do problema. Mas nao ha aviso possivel para a aba
-- que morreu. So atomicidade resolve.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Quem esta restrito hoje (e, portanto, quem tinha o que perder):
--
--   SELECT ul.user_id, u.email, count(*) AS localidades
--   FROM public.user_locations ul
--   LEFT JOIN auth.users u ON u.id = ul.user_id
--   GROUP BY ul.user_id, u.email
--   ORDER BY u.email;
--
-- E os que estao IRRESTRITOS (veem tudo) — confira se e proposital:
--
--   SELECT ur.user_id, u.email, ur.role
--   FROM public.user_roles ur
--   LEFT JOIN auth.users u ON u.id = ur.user_id
--   WHERE ur.role IN ('warehouse','manager')
--     AND NOT EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = ur.user_id)
--   ORDER BY u.email;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.set_user_locations(
  _user_id uuid,
  _categoria_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  -- SECURITY DEFINER ignora RLS: a checagem de papel tem que estar AQUI DENTRO.
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  -- Tudo numa transacao (o corpo da funcao ja e uma). O `delete` e o `insert`
  -- passam juntos ou nenhum passa — nao existe mais o estado intermediario em
  -- que a lista fica vazia e o funcionario vira irrestrito.
  DELETE FROM public.user_locations WHERE user_id = _user_id;

  IF _categoria_ids IS NOT NULL AND array_length(_categoria_ids, 1) > 0 THEN
    INSERT INTO public.user_locations (user_id, categoria_id)
    SELECT _user_id, x
    FROM unnest(_categoria_ids) AS x
    -- `DISTINCT` porque a tela manda um Set, mas a RPC e chamavel direto.
    GROUP BY x;
  END IF;

  SELECT count(*) INTO _n FROM public.user_locations WHERE user_id = _user_id;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_locations(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_locations(uuid, uuid[]) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- POR QUE `GRANT ... TO authenticated` E ACEITAVEL AQUI
--
-- O cadastro deste sistema e ABERTO, entao `authenticated` e qualquer pessoa.
-- Ja errei nisso hoje. A diferenca: a PRIMEIRA instrucao do corpo e
-- `IF NOT has_role(auth.uid(),'admin') THEN RAISE`. Quem nao e admin nao passa
-- da linha 1, e nem descobre se o `_user_id` existe.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.set_user_locations(uuid, uuid[]);
--
-- A tela volta a fazer delete+insert direto (o codigo antigo esta no historico
-- do git). Reabre a janela de "funcionario vira irrestrito".
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao existe e e admin-only:
--   SELECT proname, prosecdef, prosrc LIKE '%NOT_ALLOWED%' AS tem_checagem
--   FROM pg_proc WHERE proname = 'set_user_locations';
--   -- esperado: 1 linha, prosecdef = true, tem_checagem = true
--
-- 2) CONTROLE — abra um usuario de staff no admin, marque duas localidades,
--    salve, e confira que as duas aparecem ao reabrir. Depois desmarque todas e
--    confira que ele volta a ficar irrestrito (que e o comportamento esperado
--    de lista vazia neste sistema).
-- ---------------------------------------------------------------------------
