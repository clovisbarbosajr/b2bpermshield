-- ============================================================================
-- SQL da varredura de 25/ago (reports + ActivityLogs + edge functions).
-- Rodar no PermShield. Os dois blocos sao INDEPENDENTES — pode rodar so um.
-- Nenhum dos dois e obrigatorio para o codigo funcionar: a tela detecta a
-- ausencia e usa um caminho alternativo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) RPC do filtro "User" do Activity Log.   [RECOMENDADO]
--
-- O dropdown precisa da lista de quem JA registrou acao. Antes ele lia
-- `.limit(2000)`, que o PostgREST corta em 1000 — usuario antigo sumia do filtro
-- e as acoes dele ficavam inauditaveis, piorando sozinho conforme a tabela
-- cresce. Varrer a tabela inteira do navegador seria pior (a tela travaria), so
-- o banco resolve isso barato, com DISTINCT.
--
-- Sem esta RPC a tela usa um fallback: le os 6.000 logs mais recentes. Funciona,
-- so nao garante a lista completa.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activity_log_users()
RETURNS TABLE (user_email text, user_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (l.user_email) l.user_email, l.user_name
  FROM public.activity_logs l
  WHERE l.user_email IS NOT NULL AND l.user_email <> ''
  ORDER BY l.user_email, l.created_at DESC;   -- o nome mais recente de cada email
$$;

REVOKE ALL ON FUNCTION public.activity_log_users() FROM PUBLIC;
-- So staff ve o Activity Log; a tela ja e protegida por papel.
GRANT EXECUTE ON FUNCTION public.activity_log_users() TO authenticated, service_role;

-- Deixa o DISTINCT ON barato.
CREATE INDEX IF NOT EXISTS activity_logs_user_email_created_idx
  ON public.activity_logs (user_email, created_at DESC);


-- ----------------------------------------------------------------------------
-- 2) Backfill de `is_paid` no historico importado.   [DECISAO SUA]
--
-- O relatorio Payment Activity chamava de "Paid" tudo com status `complete` —
-- ou seja, contava como RECEBIDO um pedido apenas ENTREGUE. Corrigi para usar
-- `is_paid`, que e o campo real (o admin marca em Order Detail, o checkout
-- define, a tela de Pedidos filtra por ele).
--
-- Efeito colateral: o `b2bwave-sync` NUNCA escreve `is_paid`. Entao todo pedido
-- migrado do B2BWave — o grosso do historico — fica com `is_paid` nulo e passa a
-- aparecer como "Pending", mesmo se foi pago la atras.
--
-- Este UPDATE assume o que o relatorio antigo ja assumia: pedido concluido e
-- pedido pago. Se essa premissa NAO vale para o seu historico, NAO rode — e
-- prefira marcar na mao os que realmente foram pagos.
--
-- Confira ANTES quantos serao afetados:
--
--   SELECT count(*) FROM public.pedidos
--   WHERE b2bwave_order_id IS NOT NULL AND is_paid IS DISTINCT FROM true
--     AND status IN ('complete', 'concluido');
--
-- Depois, se concordar:

-- UPDATE public.pedidos
-- SET is_paid = true
-- WHERE b2bwave_order_id IS NOT NULL
--   AND is_paid IS DISTINCT FROM true
--   AND status IN ('complete', 'concluido');
