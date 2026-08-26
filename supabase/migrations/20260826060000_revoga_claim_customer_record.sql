-- ============================================================================
-- `claim_customer_record` SAI DO ALCANCE DO CLIENTE
--
-- Achado do cetico de preco (26/ago). A funcao adota uma ficha de cliente pelo
-- e-mail do JWT (20260726120000_harden_view_as_and_claim.sql:71) e continua com
-- `GRANT EXECUTE ... TO authenticated` (20260619000000:50).
--
-- Ela NAO exige `email_confirmed_at` — a trava que 20260825300000 aplicou na
-- irma `ensure_my_cliente_record`, justamente para impedir que alguem se
-- cadastrasse com o e-mail de uma empresa migrada e herdasse a ficha dela:
-- tabela de preco, historico de pedidos e enderecos.
--
-- A migration 20260811120000 declarou esta funcao "codigo morto". Codigo morto
-- que continua com GRANT nao esta morto: o PostgREST expoe toda funcao com
-- EXECUTE em `/rest/v1/rpc/<nome>`. Nenhum arquivo de `src/` a chama — mas o
-- atacante nao usa a tela.
--
-- HOJE ela e inerte por ACIDENTE, nao por desenho: o corpo procura ficha com
-- `user_id IS NULL`, e `clientes.user_id` e NOT NULL. Ou seja, a defesa e um
-- detalhe de schema que ninguem esta guardando. No dia em que alguem tornar a
-- coluna nulavel — para permitir ficha sem login, por exemplo — o furo abre
-- sozinho e em silencio.
--
-- Tirar o GRANT custa nada e nao depende mais daquele acidente.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Quem tem EXECUTE hoje, e se a defesa acidental ainda esta de pe:
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          p.proacl::text AS quem_pode_executar
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'claim_customer_record';
--
--   SELECT is_nullable AS user_id_aceita_nulo
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'clientes'
--      AND column_name = 'user_id';
--   -- 'NO' = a defesa acidental esta de pe hoje. 'YES' = ja estava aberto.
-- ---------------------------------------------------------------------------

BEGIN;

-- `IF EXISTS` no DO: a funcao pode ter sido apagada em algum ponto, e um
-- REVOKE em funcao inexistente derruba a transacao inteira.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'claim_customer_record'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.claim_customer_record() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.claim_customer_record() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.claim_customer_record() FROM anon';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO apaga a funcao. `DROP` derrubaria qualquer dependencia que eu nao tenha
-- enxergado, e o objetivo aqui e fechar o acesso, nao arrumar a casa. Sem
-- EXECUTE ela nao aparece no PostgREST.
--
-- NAO mexe em `ensure_my_cliente_record`, que e a que o sistema usa de verdade
-- e ja exige e-mail confirmado (20260825300000).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   GRANT EXECUTE ON FUNCTION public.claim_customer_record() TO authenticated;
--
-- Reverter devolve a exposicao de uma funcao de adocao de ficha que nao exige
-- e-mail confirmado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) Ninguem mais executa:
--   SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'claim_customer_record';
--   -- ESPERADO: sem `authenticated=X` na lista (pode aparecer o dono do banco).
--
-- 2) CONTROLE — o login normal continua funcionando. Entre no portal com uma
--    conta de cliente e confirme que a ficha carrega (nome/empresa na tela).
--    Quem faz isso e `ensure_my_cliente_record`, que NAO foi tocada — mas sem
--    este teste, um engano meu de nome de funcao so apareceria quando um
--    cliente nao conseguisse entrar.
-- ---------------------------------------------------------------------------
