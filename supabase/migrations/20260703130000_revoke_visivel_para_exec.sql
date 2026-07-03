-- ============================================================================
-- SEC FIX (Bug 3 da auditoria 2026-07-03): categoria_visivel_para e
-- produto_visivel_para recebem o cliente-ALVO como PARÂMETRO e não têm gate
-- interno de staff (o gate fica nas RPCs *_visiveis_cliente). Como CREATE
-- FUNCTION concede EXECUTE a PUBLIC por padrão e nenhuma migração revogou,
-- QUALQUER usuário (authenticated e até anon) podia chamá-las direto via
-- PostgREST (/rest/v1/rpc/...) e sondar a visibilidade de OUTROS clientes
-- (information disclosure da configuração de privacidade).
--
-- Fix mínimo: revoga EXECUTE dos roles de API. As RPCs staff-gated são
-- SECURITY DEFINER (executam como o dono) e continuam funcionando igual.
-- Nenhum código do front chama essas funções diretamente — só as RPCs.
-- (cliente_pode_ver_* ficam como estão: usam auth.uid(), só revelam a
-- visibilidade do PRÓPRIO chamador.)
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.categoria_visivel_para(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.produto_visivel_para(uuid, uuid) FROM PUBLIC, anon, authenticated;
