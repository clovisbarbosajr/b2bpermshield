-- ---------------------------------------------------------------------------
-- O BLOQUEIO DE PEDIDO PASSA A OLHAR O TITULAR, E NAO SO QUEM CLICOU.
--
-- O QUE ESTA QUEBRADO HOJE: `fn_block_order_inactive_customer` decide com
--
--     SELECT status, is_active, disable_ordering
--       FROM public.clientes WHERE id = NEW.cliente_id;
--
-- `NEW.cliente_id` e a ficha de QUEM esta comprando. Quando quem compra e um
-- SUB-LOGIN (funcionario), essa e a ficha DELE — nunca a da empresa.
--
-- E o sub-login nasce sempre liberado: `company-member/index.ts:264-265` grava
-- `status: "ativo"` e `is_active: true`, e nem menciona `disable_ordering`, que
-- fica no default `false`. Nada sincroniza isso depois.
--
-- RESULTADO, sem precisar de nenhum truque: o admin marca "Disable Ordering" na
-- ficha da empresa, a tela confirma, e cada funcionario dessa empresa continua
-- comprando normalmente — pela TELA, nao por chamada direta de API. Uma empresa
-- suspensa com cinco funcionarios segue comprando por cinco portas enquanto o dono
-- ve a caixa marcada. O controle mais direto que o dono tem sobre uma conta
-- simplesmente nao alcanca quem esta abaixo dela.
--
-- O mesmo vale para `is_active` e `status`: suspender a empresa nao impede o
-- INSERT do pedido do funcionario. Os itens depois sao recusados um a um por
-- `fn_item_produto_valido`, entao o que sobra e um PEDIDO VAZIO na fila do admin —
-- repetivel em laco.
--
-- ---------------------------------------------------------------------------
-- DUAS FUNCOES, O MESMO DEFEITO EM SENTIDOS OPOSTOS — as duas corrigidas aqui
--
-- `conta_liberada_de` (`20260825370000`) governa a LEITURA (catalogo, categoria,
-- preco) e ja olha o titular, com o `LEFT JOIN` que falta na de escrita. E de la
-- que este arquivo copia o JOIN.
--
-- Mas ela combina com `COALESCE(dono.status, me.status)`, e isso tem o defeito
-- SIMETRICO: como `clientes.status` e NOT NULL, havendo titular o valor do pai
-- vence SEMPRE e a ficha do filho e ignorada. O funcionario demitido pela empresa
-- continua com `conta_liberada_de` = TRUE — segue vendo o catalogo e os PRECOS da
-- empresa de onde foi removido. So o pedido dele seria barrado.
--
-- Ou seja: a de escrita nao olhava o pai, e a de leitura nao olhava o filho.
--
-- A LISTA de status ja era identica nas duas (as mesmas nove strings, na mesma
-- ordem) — nunca foi ela o problema. O que divergia era a COMBINACAO: `COALESCE`
-- de um lado, ficha unica do outro. As duas passam a `OR` aqui, e ai a REGRA, e
-- nao so a lista, fica igual nas duas pontas.
--
-- `LEFT JOIN` e nao `JOIN` nas duas, pelo motivo que a de leitura ja documentava:
-- um `parent_customer_id` apontando para ficha inexistente nao pode ELIMINAR a
-- linha e trancar um sub-usuario legitimo.
--
-- ---------------------------------------------------------------------------
-- POR QUE `OR` NOS TRES, E NAO `COALESCE`
--
-- A primeira versao desta migration usava `COALESCE(dono.status, me.status)` e
-- `COALESCE(dono.is_active, me.is_active)`, com o argumento de que "situacao da
-- conta e do titular". ESTAVA ERRADO, e abria um buraco NOVO — o espelho exato do
-- que esta migration conserta.
--
-- `clientes.status` e NOT NULL DEFAULT 'pendente', entao havendo titular o
-- `COALESCE` pegava SEMPRE o valor do pai e a ficha do filho era ignorada por
-- completo. E a empresa desativa um funcionario mexendo SO na linha DELE:
-- `company-member/index.ts:116` e `:127` gravam `status='inativo'`,
-- `is_active=false` com `.eq("id", member_id).eq("parent_customer_id", companyId)`
-- — e o comentario de la diz "desativa; mantem o login para historico", ou seja, o
-- login continua valendo.
--
-- Resultado do `COALESCE`: funcionario DEMITIDO, com o titular ativo, voltava a
-- poder inserir pedido — `COALESCE(true, false)` = true. E ele era barrado ANTES
-- desta migration, porque a versao antiga lia a ficha dele. Eu fecharia a porta da
-- empresa e abriria a do demitido.
--
-- `OR` nos tres, e a denylist avaliada nos DOIS status: qualquer um dos dois
-- bloqueia. E o unico jeito de os dois controles — o do admin sobre a empresa e o
-- do titular sobre a equipe — valerem ao mesmo tempo.
--
-- ---------------------------------------------------------------------------
-- NAO APAGA NADA. Substitui o corpo de DUAS funcoes: o gatilho
-- `fn_block_order_inactive_customer` (escrita) e `conta_liberada_de` (leitura,
-- que NAO e funcao de trigger — e chamada por `cliente_conta_liberada`,
-- `produto_visivel_para`, `categoria_visivel_para` e, via
-- `cliente_pode_ver_produto`, por `fn_item_produto_valido`). Nenhum trigger e
-- recriado: `trg_block_order_inactive_customer` (`20260623020000:63-65`) continua
-- apontando para a mesma funcao.
--
-- DIAGNOSTICO — rode ANTES e guarde. Mostra quantas contas estao com o bloqueio
-- marcado e quantos funcionarios hoje escapam dele:
--
--   SELECT count(*) FILTER (WHERE c.disable_ordering IS TRUE
--                             AND c.parent_customer_id IS NULL) AS titulares_bloqueados,
--          count(*) FILTER (WHERE c.parent_customer_id IS NOT NULL
--                             AND c.disable_ordering IS NOT TRUE
--                             AND p.disable_ordering IS TRUE)   AS funcionarios_que_escapam
--     FROM public.clientes c
--     LEFT JOIN public.clientes p ON p.id = c.parent_customer_id;
--
-- DIAGNOSTICO DA OUTRA METADE — quem PERDE leitura. Rode ANTES e guarde a lista.
--
-- A mudanca em `conta_liberada_de` e a mais arriscada das duas, porque falha em
-- SILENCIO: nao levanta excecao, so devolve `false`, e o catalogo e o preco vem
-- vazios. Estas sao as pessoas que passam a nao ver mais nada — confira uma a uma
-- antes de rodar, porque depois nao ha erro para acusar.
--
--   SELECT c.id, c.nome, c.email, c.status, c.is_active,
--          p.nome AS titular, p.status AS status_do_titular
--     FROM public.clientes c
--     JOIN public.clientes p ON p.id = c.parent_customer_id
--    WHERE (c.is_active IS FALSE
--           OR lower(c.status::text) IN ('pendente','inativo','rejeitado','suspenso',
--                                        'pending','inactive','rejected','suspended','blocked'))
--      AND p.is_active IS NOT FALSE
--      AND lower(p.status::text) NOT IN ('pendente','inativo','rejeitado','suspenso',
--                                        'pending','inactive','rejected','suspended','blocked');
--   -- Sao funcionarios DESATIVADOS cuja empresa esta ativa. Hoje eles enxergam o
--   -- catalogo; depois desta migration, nao. E o comportamento pretendido — mas se
--   -- aparecer alguem que voce NAO desativou, pare e investigue antes.
--
-- ROLLBACK — SAO DUAS FUNCOES, e reverter so uma deixa a metade silenciosa de pe:
--
--   1. escrita: reaplique `20260825270000_disable_ordering.sql` inteiro;
--   2. leitura: rode o corpo abaixo, que e a versao de `20260825370000:49-87`.
--
--   CREATE OR REPLACE FUNCTION public.conta_liberada_de(_cli_id uuid)
--   RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $rb$
--   DECLARE _st text; _act boolean;
--   BEGIN
--     IF _cli_id IS NULL THEN RETURN false; END IF;
--     SELECT COALESCE(dono.status, me.status)::text,
--            COALESCE(dono.is_active, me.is_active)
--       INTO _st, _act
--     FROM public.clientes me
--     LEFT JOIN public.clientes dono ON dono.id = me.parent_customer_id
--     WHERE me.id = _cli_id;
--     IF NOT FOUND THEN RETURN false; END IF;
--     IF _act IS FALSE THEN RETURN false; END IF;
--     IF lower(coalesce(_st,'')) IN
--        ('pendente','inativo','rejeitado','suspenso',
--         'pending','inactive','rejected','suspended','blocked') THEN
--       RETURN false;
--     END IF;
--     RETURN true;
--   END; $rb$;
--
-- Reverter as duas devolve as duas brechas: empresa bloqueada comprando pelos
-- funcionarios, e funcionario demitido vendo catalogo e preco.
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_block_order_inactive_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _st_me   text;
  _st_dono text;
  _inativo boolean;
  _blk     boolean;
BEGIN
  IF NEW.b2bwave_order_id IS NOT NULL
     OR auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;

  -- OS DOIS LADOS, sempre. Ver o cabecalho: ler so a ficha de quem clicou deixava
  -- o funcionario de empresa bloqueada comprando; ler so a do titular deixaria o
  -- funcionario demitido comprando.
  SELECT me.status::text, dono.status::text,
         (me.is_active IS FALSE OR dono.is_active IS FALSE),
         (me.disable_ordering IS TRUE OR dono.disable_ordering IS TRUE)
    INTO _st_me, _st_dono, _inativo, _blk
  FROM public.clientes me
  LEFT JOIN public.clientes dono ON dono.id = me.parent_customer_id
  WHERE me.id = NEW.cliente_id;

  -- FICHA INEXISTENTE BLOQUEIA. Sem isto, `NOT FOUND` deixaria tudo nulo, nenhum
  -- IF dispararia e o pedido PASSARIA — falhar aberto na guarda que decide quem
  -- pode comprar e o pior desfecho possivel. A FK ja tornaria isso improvavel; a
  -- guarda existe para o dia em que ela nao estiver la.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not active yet. Please wait for approval.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Denylist conservadora, como estava: status desconhecido NAO bloqueia, para
  -- nao derrubar cliente legitimo com status novo. Avaliada nos DOIS: o titular
  -- suspenso barra a equipe inteira, e o funcionario desativado e barrado mesmo
  -- com a empresa em ordem. `_st_dono` e nulo quando nao ha titular, e
  -- `coalesce(...,'')` faz esse lado nunca bloquear sozinho.
  IF _inativo IS TRUE
     OR lower(coalesce(_st_me,''))   IN ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked')
     OR lower(coalesce(_st_dono,'')) IN ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked') THEN
    RAISE EXCEPTION 'This account is not active yet. Please wait for approval.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Mensagem SEPARADA de propósito: "aguarde aprovacao" mandaria o cliente
  -- esperar por algo que nunca vem — a conta esta ativa, o que foi suspenso e a
  -- compra. Token no inicio para o front reconhecer sem casar texto.
  IF _blk IS TRUE THEN
    RAISE EXCEPTION 'ORDERING_DISABLED: ordering is currently disabled for this account. Please contact us.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

-- A LEITURA TAMBEM, no sentido oposto. Ver o cabecalho: sem isto o funcionario
-- demitido continua vendo catalogo e PRECO da empresa de onde saiu, porque o
-- `COALESCE` faz o `ativo` do titular apagar o `inativo` dele. Corpo identico ao
-- de `20260825370000`; so a combinacao muda.
CREATE OR REPLACE FUNCTION public.conta_liberada_de(_cli_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _st_me text; _st_dono text; _inativo boolean;
BEGIN
  IF _cli_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT me.status::text, dono.status::text,
         (me.is_active IS FALSE OR dono.is_active IS FALSE)
    INTO _st_me, _st_dono, _inativo
  FROM public.clientes me
  LEFT JOIN public.clientes dono ON dono.id = me.parent_customer_id
  WHERE me.id = _cli_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _inativo IS TRUE THEN
    RETURN false;
  END IF;

  -- Denylist conservadora: status desconhecido NAO bloqueia. Avaliada nos DOIS.
  IF lower(coalesce(_st_me,'')) IN
       ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked')
     OR lower(coalesce(_st_dono,'')) IN
       ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked') THEN
    RETURN false;
  END IF;

  RETURN true;
END; $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICACAO — as DUAS metades. So a primeira passaria numa funcao que bloqueia
-- todo mundo, e ai a loja inteira para de vender.
--
-- Tudo dentro de BEGIN ... ROLLBACK, e as fichas NASCEM aqui dentro: nao mexe em
-- cliente de verdade, e um ROLLBACK perdido deixa so linhas `ZZVERIF-` visiveis.
--
-- `user_id` com `gen_random_uuid()` porque a coluna e NOT NULL e a FK para
-- `auth.users` foi removida em `20260319152251`. A primeira versao deste bloco
-- omitia o campo: os INSERTs morriam com "null value in column user_id" ANTES de
-- chegar no pedido — e o bloco (1) ainda MOSTRAVA UM ERRO, que quem estivesse com
-- pressa leria como "bloqueou, funcionou". Prova que se aprova pelo motivo errado
-- e pior que prova nenhuma.
--
--   BEGIN;
--     -- titular BLOQUEADO + funcionario dele, liberado na propria ficha
--     CREATE TEMP TABLE zzt AS
--     WITH pai AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, disable_ordering)
--       VALUES (gen_random_uuid(), 'ZZVERIF-titular', 'zzverif-pai@example.invalid', 'ativo', true, true)
--       RETURNING id
--     ), filho AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, parent_customer_id)
--       SELECT gen_random_uuid(), 'ZZVERIF-funcionario', 'zzverif-filho@example.invalid', 'ativo', true, pai.id FROM pai
--       RETURNING id
--     ) SELECT (SELECT id FROM pai) AS pai_id, (SELECT id FROM filho) AS filho_id;
--
--     -- (1) O FUNCIONARIO TEM QUE SER BLOQUEADO pelo bloqueio do titular.
--     --     ESPERADO: erro `ORDERING_DISABLED`. Se o INSERT passar, a migration
--     --     NAO entrou.
--     INSERT INTO public.pedidos (cliente_id, subtotal, total)
--     SELECT filho_id, 0, 0 FROM zzt;
--   ROLLBACK;
--
--   BEGIN;
--     -- (2) A OUTRA METADE: conta em ordem CONTINUA comprando.
--     CREATE TEMP TABLE zzt2 AS
--     WITH pai AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, disable_ordering)
--       VALUES (gen_random_uuid(), 'ZZVERIF-titular-ok', 'zzverif-pai2@example.invalid', 'ativo', true, false)
--       RETURNING id
--     ), filho AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, parent_customer_id)
--       SELECT gen_random_uuid(), 'ZZVERIF-func-ok', 'zzverif-filho2@example.invalid', 'ativo', true, pai.id FROM pai
--       RETURNING id
--     ) SELECT (SELECT id FROM filho) AS filho_id;
--
--     INSERT INTO public.pedidos (cliente_id, subtotal, total)
--     SELECT filho_id, 0, 0 FROM zzt2;
--     -- ESPERADO: INSERT 0 1, sem erro.
--   ROLLBACK;
--
--   -- Depois dos dois, confirme que nao sobrou nada:
--   SELECT count(*) AS sobrou FROM public.clientes WHERE nome LIKE 'ZZVERIF%';
--   -- ESPERADO: 0.
--
-- 3) A OUTRA FUNCAO — `conta_liberada_de`, a da leitura. Os blocos (1) e (2) so
--    exercitam a de escrita, e esta e a que falha calada.
--
--   BEGIN;
--     CREATE TEMP TABLE zzl AS
--     WITH pai AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active)
--       VALUES (gen_random_uuid(), 'ZZVERIF-l-titular', 'zzverif-l1@example.invalid', 'ativo', true)
--       RETURNING id
--     ), ativo AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, parent_customer_id)
--       SELECT gen_random_uuid(), 'ZZVERIF-l-ativo', 'zzverif-l2@example.invalid', 'ativo', true, pai.id FROM pai
--       RETURNING id
--     ), demitido AS (
--       INSERT INTO public.clientes (user_id, nome, email, status, is_active, parent_customer_id)
--       SELECT gen_random_uuid(), 'ZZVERIF-l-demitido', 'zzverif-l3@example.invalid', 'inativo', false, pai.id FROM pai
--       RETURNING id
--     )
--     SELECT (SELECT id FROM pai) AS pai_id,
--            (SELECT id FROM ativo) AS ativo_id,
--            (SELECT id FROM demitido) AS demitido_id;
--
--     SELECT public.conta_liberada_de((SELECT ativo_id    FROM zzl)) AS ativo_ve,
--            public.conta_liberada_de((SELECT demitido_id FROM zzl)) AS demitido_ve,
--            public.conta_liberada_de((SELECT pai_id      FROM zzl)) AS titular_ve;
--     -- ESPERADO: true, false, true.
--     -- `demitido_ve = true` significa que a migration NAO entrou (era o
--     -- comportamento antigo). `ativo_ve = false` seria pior: a funcao passou a
--     -- barrar quem tem direito, e o catalogo esvazia sem erro nenhum.
--   ROLLBACK;
--
--   SELECT count(*) AS sobrou FROM public.clientes WHERE nome LIKE 'ZZVERIF%';
--   -- ESPERADO: 0.
-- ---------------------------------------------------------------------------
