-- ---------------------------------------------------------------------------
-- `produto_acesso.grupo_nome` VIRA NULLABLE — o que a migration de abril ja
-- pretendia e nunca aconteceu no banco.
--
-- O QUE ACONTECE HOJE: `ProductEdit` grava acesso de produto privado assim:
--
--   grupo_nome: privacyGroups.find((p) => p.id === gid)?.nome ?? null
--
-- Quando o `find` nao acha o grupo, sai `null` — e `grupo_nome` continua
-- `NOT NULL`. O INSERT estoura `23502`. So que o `delOrFail("produto_acesso")`
-- JA rodou e JA foi commitado: o produto privado fica sem grupo de acesso
-- NENHUM. A tela avisa e o estado segue em memoria, mas um F5 consolida a perda.
--
-- POR QUE A COLUNA DEVERIA SER NULLABLE: quem manda hoje e `privacy_group_id`
-- (uuid, FK). `grupo_nome` so existe para compatibilidade com dado legado —
-- `20260622160000` fez a funcao de visibilidade aceitar os DOIS formatos, e
-- `20260407000000_missing_tables.sql:51` ja tinha escrito este mesmo
-- `DROP NOT NULL`. Os types gerados a partir do banco vivo ainda dizem
-- `grupo_nome: string` (obrigatorio) no Insert — prova de que aquele arquivo
-- nao chegou a rodar aqui.
--
-- POR QUE NO BANCO E NAO NA TELA: a tela e um dos escritores. O importador, o
-- sync e o proximo escritor que ninguem previu batem na mesma coluna. Tirar o
-- `NOT NULL` de uma coluna que o proprio projeto ja tratou como opcional resolve
-- para todos; um guarda no `ProductEdit` resolveria so para ele.
--
-- ---------------------------------------------------------------------------
-- NAO APAGA NADA. E um `ALTER COLUMN ... DROP NOT NULL`: afrouxa a restricao,
-- nao toca em linha nenhuma. Por isso nao ha backup aqui.
--
-- DIAGNOSTICO — rode ANTES e guarde:
--
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produto_acesso'
--      AND column_name = 'grupo_nome';
--   -- Esperado ANTES: 'NO'. Se ja vier 'YES', esta migration nao e necessaria.
--
--   SELECT count(*) AS linhas,
--          count(*) FILTER (WHERE privacy_group_id IS NULL) AS sem_uuid,
--          count(*) FILTER (WHERE grupo_nome IS NULL)       AS sem_nome
--     FROM public.produto_acesso;
--   -- `sem_uuid` > 0 significa dado legado que ainda depende do nome: ele
--   -- continua funcionando, ninguem mexe nessas linhas.
--
-- ROLLBACK:
--   ALTER TABLE public.produto_acesso ALTER COLUMN grupo_nome SET NOT NULL;
--   So volta se NENHUMA linha tiver `grupo_nome` nulo. Depois que a tela gravar
--   a primeira linha so com `privacy_group_id`, reverter exige decidir o que
--   fazer com ela (preencher o nome a partir de `privacy_groups`, ou apagar).
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.produto_acesso
  ALTER COLUMN grupo_nome DROP NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A coluna aceita nulo:
--
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produto_acesso'
--      AND column_name = 'grupo_nome';
--   -- ESPERADO: 'YES'.
--
-- 2) A restricao morreu de verdade — sem isto, um ALTER que nao entrou passaria
--    por aplicado. Nao deixa rastro:
--
--   BEGIN;
--     INSERT INTO public.produto_acesso (produto_id, privacy_group_id, grupo_nome)
--     SELECT p.id, g.id, NULL
--       FROM public.produtos p, public.privacy_groups g
--      LIMIT 1;
--   ROLLBACK;
--   -- ESPERADO: INSERT 0 1. Se der `23502`, o ALTER NAO entrou.
--   -- (Se vier `INSERT 0 0`, e porque falta produto ou grupo cadastrado — o
--   --  teste nao rodou, nao e sinal de que passou.)
--
-- 3) A visibilidade do portal nao mudou para o dado que ja existia: linha com
--    `grupo_nome` preenchido continua casando pelo nome, e linha nova casa pelo
--    uuid. As duas ja estavam cobertas pelo `OR` de `cliente_pode_ver_produto`
--    (`20260622160000`), que nao foi tocada aqui.
--
--   SELECT count(*) FILTER (WHERE grupo_nome IS NOT NULL) AS casam_por_nome,
--          count(*) FILTER (WHERE privacy_group_id IS NOT NULL) AS casam_por_uuid
--     FROM public.produto_acesso;
--   -- Compare com o numero do diagnostico. Nada deve ter mudado.
-- ---------------------------------------------------------------------------
