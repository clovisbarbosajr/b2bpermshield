-- Um preco combinado por cliente/produto, garantido pelo BANCO.
--
-- `produto_precos_cliente` nasceu (20260318202244:71-78) com PK so em `id` e
-- nenhuma migration acrescentou indice depois. Nada impede duas linhas para o
-- MESMO par cliente/produto com precos diferentes — e ai:
--   * no servidor, `preco_autoritativo` faz `SELECT preco INTO _cust FROM
--     produto_precos_cliente WHERE ...`. `SELECT INTO` em plpgsql com varias
--     linhas NAO levanta erro: pega a primeira que vier, sem ORDER BY. Qual
--     preco o cliente paga vira sorteio, e o Postgres pode mudar de ideia entre
--     duas execucoes (mudou o plano, passou um autovacuum). Sem erro, sem
--     aviso: so o valor errado no pedido.
--   * no front, `lib/pricing.ts` usa `.maybeSingle()`, que ERRA com duas linhas
--     e derruba o calculo — o preco negociado simplesmente para de valer.
--   * `ImportCustomerPrices` ja precisa recusar a linha quando acha duplicata,
--     e o upsert original nem chegava a gravar (42P10) por falta deste indice.
--
-- ESTA MIGRATION NAO APAGA NADA. Se houver duplicata, o `CREATE UNIQUE INDEX`
-- FALHA e a transacao inteira volta atras — de proposito. Escolher qual dos
-- dois precos combinados vale e decisao de quem negociou, nao de migration.
--
-- ANTES DE RODAR, rode o diagnostico abaixo. Se `pares_duplicados` vier 0, siga
-- direto; se vier maior que 0, a segunda consulta mostra exatamente quais sao.

-- ---------------------------------------------------------------- DIAGNOSTICO
-- SELECT count(*) AS pares_duplicados FROM (
--   SELECT cliente_id, produto_id FROM public.produto_precos_cliente
--    GROUP BY cliente_id, produto_id HAVING count(*) > 1) d;
--
-- SELECT c.nome AS cliente, p.nome AS produto, p.sku,
--        array_agg(ppc.preco ORDER BY ppc.created_at NULLS LAST) AS precos,
--        array_agg(ppc.id    ORDER BY ppc.created_at NULLS LAST) AS ids
--   FROM public.produto_precos_cliente ppc
--   JOIN public.clientes c ON c.id = ppc.cliente_id
--   JOIN public.produtos p ON p.id = ppc.produto_id
--  GROUP BY c.nome, p.nome, p.sku
-- HAVING count(*) > 1
--  ORDER BY c.nome, p.nome;
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS produto_precos_cliente_par_unico
  ON public.produto_precos_cliente (cliente_id, produto_id);

-- VERIFICACAO. `indice_ok` tem que ser 1 e `pares_duplicados` tem que ser 0.
SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'produto_precos_cliente_par_unico') AS indice_ok,
  (SELECT count(*) FROM (
     SELECT cliente_id, produto_id FROM public.produto_precos_cliente
      GROUP BY cliente_id, produto_id HAVING count(*) > 1) d)                        AS pares_duplicados;

-- ROLLBACK
--   DROP INDEX IF EXISTS public.produto_precos_cliente_par_unico;
