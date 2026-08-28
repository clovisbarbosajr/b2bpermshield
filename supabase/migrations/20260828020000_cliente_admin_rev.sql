-- ---------------------------------------------------------------------------
-- `clientes.admin_rev` — o token do bloqueio otimista da tela de cliente.
--
-- Mesmo defeito que `produtos` tinha, mesma solucao. A de produto foi MEDIDA
-- contra o banco em 27/ago (`docs/ESTRESSE-SAVE-PRODUTO.sql`, testes 1/2/3): dois
-- admins com a mesma ficha aberta, o segundo a salvar apaga o trabalho do
-- primeiro, e os DOIS leem "saved".
--
-- Em `CustomerEdit` a mecanica e identica — `syncPrivacyGroups`,
-- `syncPaymentOptions` e `syncShippingOptions` APAGAM E REESCREVEM a partir do
-- estado da TELA — e o estrago e PIOR que no produto: essas tres listas decidem o
-- que o cliente VE (grupo de privacidade governa categoria e produto privado) e
-- COMO ele paga. Perder uma nao aparece na tela do admin; aparece semanas depois,
-- no portal do cliente, como "sumiu o produto" ou "nao tenho essa forma de
-- pagamento".
--
-- ---------------------------------------------------------------------------
-- POR QUE COLUNA PROPRIA, e nao `updated_at`
--
-- A resposta completa esta em `20260827030000_produto_admin_rev.sql`. Resumo: em
-- `produtos` o `updated_at` falhava dos dois lados — o trigger carimbava na reserva
-- de estoque de cada item de pedido (falso positivo a cada venda), e faze-lo
-- carimbar so na mudanca de dado cegava a guarda em save que so mexe em sub-dado.
--
-- `clientes` tambem tem o trigger generico `update_clientes_updated_at`
-- (`20260317043654`), entao a segunda metade do problema vale aqui igual: um save
-- que so troca o grupo de privacidade nao altera coluna nenhuma de `clientes`.
--
-- `admin_rev` significa uma coisa so: "a tela do admin gravou esta ficha".
--
-- ---------------------------------------------------------------------------
-- CUSTO: `ADD COLUMN ... NOT NULL DEFAULT` e O(1) desde o PG11 — nao reescreve a
-- tabela. Sao 70 clientes hoje. Nenhuma linha e alterada.
--
-- DIAGNOSTICO — rode ANTES:
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'clientes'
--      AND column_name = 'admin_rev';
--   -- Esperado: 0. Se vier 1, esta migration ja rodou.
--
-- ---------------------------------------------------------------------------
-- A COLUNA ENTRA NA TRAVA DE COLUNAS PRIVILEGIADAS, e isso NAO e detalhe.
--
-- `clientes` tem `trg_lock_privileged_cliente_cols` (versao viva em
-- `20260826020000`), que restaura as colunas sensiveis quando o proprio cliente
-- edita a ficha dele. `admin_rev` nao estava na lista — eu criei a coluna e deixei
-- essa ponta em aberto.
--
-- O QUE ISSO PERMITIA: o cliente da um UPDATE na propria linha somando 1 no
-- `admin_rev`. Nao rouba dado nem muda preco, mas TRANCA A FICHA DELE contra voce:
-- a tela do admin carrega o token, o cliente incrementa, e todo Save seguinte cai
-- em "someone else saved this customer" — acusando um colega que nao existe. Fica
-- impossivel editar aquela ficha enquanto ele repetir, e nada na tela explica.
--
-- Republica a funcao INTEIRA (nao da para acrescentar linha a um corpo existente),
-- mantendo as treze colunas que ja estavam la e somando a nova. Se alguem editar
-- essa lista de novo, edite AQUI — esta e a versao mais recente.
--
-- ORDEM: ESTE SQL PRIMEIRO, PUBLISH DEPOIS. Invertido, `fetchProduct` do cliente le
-- `admin_rev` como `undefined`, o token nasce nulo e a tela recusa TODO save com
-- "this customer's version is unknown" — nao ha `PGRST204` no log, porque a guarda
-- dispara antes de a requisicao sair.
--
-- ROLLBACK:
--   ALTER TABLE public.clientes DROP COLUMN IF EXISTS admin_rev;
--   Exige voltar o front junto, e devolve a perda por escrita concorrente.
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS admin_rev integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fn_lock_privileged_cliente_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
    NEW.user_id               := OLD.user_id;
    NEW.tabela_preco_id       := OLD.tabela_preco_id;
    NEW.representante_id      := OLD.representante_id;
    NEW.parent_customer_id    := OLD.parent_customer_id;
    NEW.can_confirm_order     := OLD.can_confirm_order;
    NEW.can_view_full_history := OLD.can_view_full_history;
    NEW.status                := OLD.status;
    NEW.is_active             := OLD.is_active;
    NEW.disable_ordering      := OLD.disable_ordering;
    NEW.tax_customer_group_id := OLD.tax_customer_group_id;
    NEW.minimum_order_value   := OLD.minimum_order_value;
    NEW.pais                  := OLD.pais;
    NEW.discount              := OLD.discount;
    NEW.admin_comments        := OLD.admin_comments;
    -- NOVA em 20260828020000: o token do bloqueio otimista da tela de admin.
    -- Sem esta linha o cliente tranca a propria ficha contra o admin, somando 1.
    NEW.admin_rev             := OLD.admin_rev;
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON COLUMN public.clientes.admin_rev IS
  'Bloqueio otimista da tela de cliente. So o save do admin incrementa. Ver '
  'supabase/migrations/20260828020000_cliente_admin_rev.sql';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A coluna existe e comeca em 0 para todo mundo:
--
--   SELECT data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='clientes' AND column_name='admin_rev';
--   -- ESPERADO: integer, NO, 0.
--
-- 2) A GUARDA MORDE — as duas metades. So a primeira passaria numa coluna que
--    nunca incrementa, e ai o bloqueio nao existiria. A linha de teste NASCE aqui
--    dentro: sortear um cliente real e somar coisa nele e risco desnecessario, e um
--    ROLLBACK perdido deixaria dado de gente de verdade mexido.
--
--   BEGIN;
--     CREATE TEMP TABLE alvo AS
--     WITH novo AS (
--       INSERT INTO public.clientes (nome, email)
--       VALUES ('ZZVERIF-admin-rev', 'zzverif-admin-rev@example.invalid')
--       RETURNING id, admin_rev
--     ) SELECT id, admin_rev FROM novo;
--
--     -- (a) token em dia grava
--     UPDATE public.clientes c SET admin_rev = c.admin_rev + 1
--       FROM alvo a WHERE c.id = a.id AND c.admin_rev = a.admin_rev;
--     -- ESPERADO: UPDATE 1.
--
--     -- (b) o MESMO token velho e recusado
--     UPDATE public.clientes c SET admin_rev = c.admin_rev + 1
--       FROM alvo a WHERE c.id = a.id AND c.admin_rev = a.admin_rev;
--     -- ESPERADO: UPDATE 0.
--   ROLLBACK;
--
--   -- Depois do ROLLBACK, confirme que nao sobrou nada:
--   SELECT count(*) FROM public.clientes WHERE nome LIKE 'ZZVERIF%';
--   -- ESPERADO: 0.
--
-- 3) A trava de colunas conhece a coluna nova:
--
--   SELECT prosrc LIKE '%NEW.admin_rev%' AS admin_rev_travada
--     FROM pg_proc WHERE proname = 'fn_lock_privileged_cliente_cols';
--   -- ESPERADO: true. Se vier false, o cliente consegue trancar a propria ficha
--   -- contra o admin somando 1 no token.
-- ---------------------------------------------------------------------------
