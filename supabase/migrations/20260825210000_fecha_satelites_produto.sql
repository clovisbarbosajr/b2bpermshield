-- ============================================================================
-- FECHA O VAZAMENTO DAS TABELAS SATELITE DE PRODUTO
--
-- Confirmado no banco de PRODUCAO (nao so nos arquivos), com:
--   SELECT tablename, policyname, roles::text, cmd
--   FROM pg_policies WHERE schemaname='public' AND qual='true';
--
-- `produtos` e `categorias` sao corretamente escopadas por
-- `cliente_pode_ver_produto` (20260802150000), mas as tabelas satelite ficaram
-- com a policy original `FOR SELECT TO authenticated USING (true)` de
-- 20260318202244, que nunca foi dropada. Como o cadastro deste sistema e ABERTO,
-- qualquer pessoa que se registre le:
--
--   produto_descontos      -> a REGUA DE DESCONTO e o PRECO FINAL de TODAS as
--                             tabelas de preco, inclusive as de concorrentes.
--                             E o pior: e o diferencial comercial do dono.
--                             A migration 20260619170000_pricelist_isolation
--                             fechou tabela_preco_itens/tabelas_preco/
--                             variante_precos/produto_precos_cliente e ESQUECEU
--                             esta, que tem o mesmo formato e alimenta
--                             `_resolve_desconto` (20260622220000).
--   produto_variantes      -> variantes e QUANTIDADE EM ESTOQUE de produto que a
--                             privacidade deveria esconder
--   produto_imagens        -> imagens de produto restrito
--   produto_arquivos       -> fichas tecnicas de produto restrito
--   produto_opcoes         -> sortimento privado
--   produtos_relacionados  -> idem
--
-- PADRAO: identico ao de 20260619170000 — staff ve tudo; cliente ve so o que a
-- funcao de visibilidade ja autoriza para `produtos`. Nao inventa regra nova.
--
-- ROLLBACK: no fim do arquivo, comentado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP — rode ANTES e guarde o resultado. Se algo quebrar, e com isto que se
-- reconstroi o estado anterior.
--
--   SELECT tablename, policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('produto_descontos','produto_variantes','produto_imagens',
--                       'produto_arquivos','produto_opcoes','produtos_relacionados')
--   ORDER BY tablename, policyname;
-- ---------------------------------------------------------------------------

-- TUDO NUMA TRANSACAO. Sem isto, um erro no meio deixa parte das tabelas com o
-- DROP aplicado e sem policy nova — que e pior que o vazamento: em
-- `produto_descontos` significa preco da tela diferente do preco cobrado.
BEGIN;

-- ---------- produto_descontos (regua de desconto por tabela de preco) --------
-- Escopo pela TABELA DE PRECO do cliente, igual a `tabela_preco_itens`.
-- `is_subcustomer_of` cobre o sub-login (`parent_customer_id`).
--
-- NAO usar `is_company_contact`: eu tinha copiado o padrao de
-- 20260619170000_pricelist_isolation, que e de 19/jun e foi SUBSTITUIDA em
-- 22/jun — `20260622000000_consolidate_subusers` DROPOU aquela funcao (junto com
-- a tabela `company_contacts`, do modelo antigo) e reescreveu as 4 policies de
-- price list usando `is_subcustomer_of`. Copiei a versao morta.
--
-- Se tivesse rodado assim: erro na 1a policy, mas o DROP da linha acima JA teria
-- passado — e `produto_descontos` ficaria SEM policy de leitura. O cliente veria
-- o preco de tabela na tela (RLS filtra, nao da erro) enquanto
-- `_resolve_desconto` (SECURITY DEFINER, ignora RLS) gravaria o preco COM
-- desconto no pedido. Tela e fatura discordando, em silencio.
DROP POLICY IF EXISTS "Authenticated can read produto_descontos" ON public.produto_descontos;
DROP POLICY IF EXISTS "Auth can read produto_descontos" ON public.produto_descontos;
CREATE POLICY "Read produto_descontos scoped" ON public.produto_descontos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.tabela_preco_id = produto_descontos.tabela_preco_id
        AND (c.user_id = auth.uid() OR public.is_subcustomer_of(c.id))
    )
  );

-- ---------- satelites por produto ----------
-- Todas seguem a visibilidade do PRODUTO. Se o cliente nao pode ver o produto,
-- nao pode ver variante, imagem, ficha tecnica, opcao nem relacionado dele.
DROP POLICY IF EXISTS "Authenticated can read produto_variantes" ON public.produto_variantes;
CREATE POLICY "Read produto_variantes scoped" ON public.produto_variantes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR public.cliente_pode_ver_produto(produto_variantes.produto_id)
  );

DROP POLICY IF EXISTS "Authenticated can read produto_imagens" ON public.produto_imagens;
CREATE POLICY "Read produto_imagens scoped" ON public.produto_imagens
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR public.cliente_pode_ver_produto(produto_imagens.produto_id)
  );

DROP POLICY IF EXISTS "Authenticated can read produto_arquivos" ON public.produto_arquivos;
CREATE POLICY "Read produto_arquivos scoped" ON public.produto_arquivos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR public.cliente_pode_ver_produto(produto_arquivos.produto_id)
  );

DROP POLICY IF EXISTS "Authenticated can read produto_opcoes" ON public.produto_opcoes;
CREATE POLICY "Read produto_opcoes scoped" ON public.produto_opcoes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR public.cliente_pode_ver_produto(produto_opcoes.produto_id)
  );

-- `produtos_relacionados`: exige ver os DOIS lados. Ver so o de origem revelaria
-- a existencia de um produto restrito pelo lado de la.
DROP POLICY IF EXISTS "Authenticated can read produtos_relacionados" ON public.produtos_relacionados;
CREATE POLICY "Read produtos_relacionados scoped" ON public.produtos_relacionados
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'warehouse')
    OR (
      public.cliente_pode_ver_produto(produtos_relacionados.produto_id)
      AND public.cliente_pode_ver_produto(produtos_relacionados.produto_relacionado_id)
    )
  );

-- ---------- NAO mexidas, de proposito ----------
-- `option_values` e `product_options` sao o VOCABULARIO de opcoes (nomes como
-- "Tamanho" -> "P/M/G"). Nao revelam sortimento nem preco de ninguem, e a tela
-- do produto precisa deles para montar o seletor. Escopa-los exigiria um join
-- por produto que so encareceria a leitura sem fechar nada.
--
-- `tax_classes`, `tax_rates`, `tax_rules`, `tax_customer_groups`: regras de
-- imposto, que sao publicas por natureza (a aliquota do estado nao e segredo) e
-- necessarias para o portal exibir o imposto. Anotado como aceito, nao esquecido.

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK — se alguma tela do portal parar de mostrar variante, imagem ou
-- preco, rode isto para voltar EXATAMENTE ao estado anterior. Reabre o
-- vazamento: use so para destravar, e me avise para eu corrigir o escopo.
--
--   DROP POLICY IF EXISTS "Read produto_descontos scoped"     ON public.produto_descontos;
--   DROP POLICY IF EXISTS "Read produto_variantes scoped"     ON public.produto_variantes;
--   DROP POLICY IF EXISTS "Read produto_imagens scoped"       ON public.produto_imagens;
--   DROP POLICY IF EXISTS "Read produto_arquivos scoped"      ON public.produto_arquivos;
--   DROP POLICY IF EXISTS "Read produto_opcoes scoped"        ON public.produto_opcoes;
--   DROP POLICY IF EXISTS "Read produtos_relacionados scoped" ON public.produtos_relacionados;
--
--   CREATE POLICY "Authenticated can read produto_descontos"     ON public.produto_descontos     FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated can read produto_variantes"     ON public.produto_variantes     FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated can read produto_imagens"       ON public.produto_imagens       FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated can read produto_arquivos"      ON public.produto_arquivos      FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated can read produto_opcoes"        ON public.produto_opcoes        FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated can read produtos_relacionados" ON public.produtos_relacionados FOR SELECT TO authenticated USING (true);
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO — rode DEPOIS. As 6 tabelas nao podem mais aparecer aqui.
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND qual = 'true' ORDER BY tablename;
-- ---------------------------------------------------------------------------
