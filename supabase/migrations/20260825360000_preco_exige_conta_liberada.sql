-- ============================================================================
-- CLIENTE SUSPENSO PARA DE LER A REGUA DE PRECO
--
-- Buraco residual apontado pelo cetico na revisao de 20260825280000 (a que fez
-- conta pendente nao ver catalogo).
--
-- As policies de preco escopam por TABELA DE PRECO:
--
--   EXISTS (SELECT 1 FROM clientes c
--           WHERE c.tabela_preco_id = <tabela>.tabela_preco_id
--             AND (c.user_id = auth.uid() OR is_subcustomer_of(c.id)))
--
-- Nenhuma delas olha a SITUACAO da conta. `cliente_conta_liberada()` existe
-- desde 20260825280000 e e usada pelas funcoes de visibilidade de produto e
-- categoria — mas nao chegou aqui.
--
-- HOJE NAO VAZA, e vaza por ACIDENTE: `ensure_my_cliente_record` cria a ficha com
-- `tabela_preco_id = NULL`, e `NULL = x` e NULL, entao conta nova nao casa
-- nenhuma linha. A protecao e um efeito colateral, nao uma regra.
--
-- ONDE APARECE DE VERDADE: voce atribui uma tabela de preco a um cliente e
-- DEPOIS o suspende (inadimplencia, fim de contrato, troca de distribuidor). A
-- ficha continua com `tabela_preco_id` preenchido. Ele perde o catalogo — mas
-- continua lendo `tabela_preco_itens`, `variante_precos` e `produto_descontos`
-- INTEIROS daquela tabela: produto_id -> preco, a regua de desconto por volume, a
-- politica comercial. Sem o nome do produto (a tabela `produtos` fecha), mas com
-- o preco de tudo.
--
-- Ou seja: e a MESMA inteligencia comercial que 20260825210000 fechou, por outra
-- porta, para quem voce acabou de tirar de casa.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Quem PERDE acesso a regua de preco no instante em que isto rodar: conta
-- bloqueada que ainda tem tabela de preco atribuida. Se houver cliente que voce
-- pretende reativar, isso e esperado — ele volta ao normal quando a conta voltar.
--
--   SELECT c.id, c.nome, c.empresa, c.email, c.status, c.is_active,
--          t.nome AS tabela_de_preco
--   FROM public.clientes c
--   LEFT JOIN public.tabelas_preco t ON t.id = c.tabela_preco_id
--   WHERE c.tabela_preco_id IS NOT NULL
--     AND (c.is_active IS FALSE
--          OR lower(coalesce(c.status::text,'')) IN
--             ('pendente','inativo','rejeitado','suspenso',
--              'pending','inactive','rejected','suspended','blocked'))
--   ORDER BY c.nome;
-- ---------------------------------------------------------------------------

BEGIN;

-- O padrao e sempre o mesmo: `AND public.cliente_conta_liberada()` no ramo do
-- CLIENTE. Staff nao e tocado — `cliente_conta_liberada()` ja devolve `true` para
-- os tres papeis, mas manter a checagem FORA do ramo de staff deixa explicito que
-- ela nao os afeta.

DROP POLICY IF EXISTS "Read tabela_preco_itens scoped" ON public.tabela_preco_itens;
CREATE POLICY "Read tabela_preco_itens scoped" ON public.tabela_preco_itens
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'warehouse')
    OR (public.cliente_conta_liberada()
        AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.tabela_preco_id = tabela_preco_itens.tabela_preco_id
                    AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id)))));

DROP POLICY IF EXISTS "Read tabelas_preco scoped" ON public.tabelas_preco;
CREATE POLICY "Read tabelas_preco scoped" ON public.tabelas_preco
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'warehouse')
    OR (public.cliente_conta_liberada()
        AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.tabela_preco_id = tabelas_preco.id
                    AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id)))));

DROP POLICY IF EXISTS "Read variante_precos scoped" ON public.variante_precos;
CREATE POLICY "Read variante_precos scoped" ON public.variante_precos
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'warehouse')
    OR (public.cliente_conta_liberada()
        AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.tabela_preco_id = variante_precos.tabela_preco_id
                    AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id)))));

DROP POLICY IF EXISTS "Clients read own custom prices" ON public.produto_precos_cliente;
CREATE POLICY "Clients read own custom prices" ON public.produto_precos_cliente
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')
    OR (public.cliente_conta_liberada()
        AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = produto_precos_cliente.cliente_id
                    AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id)))));

-- `produto_descontos` foi escopada em 20260825210000 pelo mesmo predicado de
-- tabela de preco, e tem o mesmo buraco.
DROP POLICY IF EXISTS "Read produto_descontos scoped" ON public.produto_descontos;
CREATE POLICY "Read produto_descontos scoped" ON public.produto_descontos
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR (public.cliente_conta_liberada()
        AND EXISTS (SELECT 1 FROM public.clientes c
                    WHERE c.tabela_preco_id = produto_descontos.tabela_preco_id
                      AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id)))));

COMMIT;

-- ---------------------------------------------------------------------------
-- CUSTO
--
-- `cliente_conta_liberada()` passa a rodar por LINHA lida dessas cinco tabelas.
-- Ela e `STABLE SECURITY DEFINER` e faz 3 `has_role` mais um join por chave
-- primaria. Onde isso pesa e no carrinho e no catalogo, que leem
-- `tabela_preco_itens` para varios produtos de uma vez.
--
-- NAO MEDI. Se ficar lento, o caminho e cachear no nivel da consulta — nao tirar
-- a checagem.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO impede o STAFF de ler nada — os tres papeis continuam com acesso total, e o
-- ramo deles vem antes.
--
-- NAO afeta edge function: todas usam service role, que ignora RLS.
--
-- NAO mexe em `_resolve_desconto` nem em `preco_autoritativo`, que sao
-- SECURITY DEFINER e ignoram RLS de proposito — e por isso que o PEDIDO de um
-- cliente continua sendo precificado certo mesmo que ele nao consiga LER a
-- tabela. Sao coisas diferentes: uma e o que ele enxerga, a outra e o que o
-- servidor cobra.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK — reinstala as cinco policies SEM a checagem de conta.
-- Cole os mesmos blocos acima, removendo `public.cliente_conta_liberada() AND`
-- (e os parenteses que ele abriu) de cada um.
--
-- Reverter devolve a regua de preco a quem voce suspendeu.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) As cinco tem a checagem:
--   SELECT tablename, policyname, qual LIKE '%cliente_conta_liberada%' AS tem_checagem
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('tabela_preco_itens','tabelas_preco','variante_precos',
--                       'produto_precos_cliente','produto_descontos')
--     AND cmd = 'SELECT'
--   ORDER BY tablename;
--   -- esperado: true nas cinco
--
-- 2) CONTROLE — o caminho BOM tem que continuar funcionando: entre com um
--    cliente ATIVO que tenha tabela de preco e confira que o catalogo mostra o
--    preco DELE (nao o de balcao) e que o carrinho fecha normalmente.
--    Sem este teste, uma policy que recusa TODO mundo passaria como "consertada".
-- ---------------------------------------------------------------------------
