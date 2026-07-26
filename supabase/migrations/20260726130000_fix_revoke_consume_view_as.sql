-- ============================================================================
-- CORREÇÃO da migration 20260726120000 (mesma rodada).
--
-- Lá o REVOKE foi escrito como `... FROM anon`, que é INÓCUO: o Postgres concede
-- EXECUTE a PUBLIC por padrão em CREATE FUNCTION, e CREATE OR REPLACE preserva
-- os grants — revogar de `anon` não remove o privilégio herdado de PUBLIC.
-- Comprovado em teste: com a chave anônima a função ainda EXECUTAVA (respondia
-- "Invalid or expired token" em vez de "permission denied").
--
-- Sem impacto de segurança real, porque o gate principal já barra: a busca exige
-- `admin_user_id = auth.uid()` e o anônimo não tem uid. Isto aqui é a defesa em
-- profundidade que ficou faltando — nem chega a executar a função.
--
-- Padrão idêntico ao já usado no projeto (20260703130000_revoke_visivel_para_exec).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) FROM PUBLIC, anon;

-- O fluxo legítimo é feito pelo ADMIN logado (papel `authenticated`) — precisa
-- do grant explícito, já que o REVOKE de PUBLIC tirou o privilégio de todos.
GRANT EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) TO authenticated;

-- Mesma lógica para create_view_as_token: anônimo não tem nada a fazer aqui
-- (a função já exige has_role admin, isto só evita a execução).
REVOKE EXECUTE ON FUNCTION public.create_view_as_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_view_as_token(UUID) TO authenticated;
