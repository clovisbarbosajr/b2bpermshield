-- ============================================================================
-- O CLIENTE PARA DE EDITAR AS PROPRIAS COLUNAS DE DINHEIRO
--
-- Achado do cetico de preco (26/ago). A politica "Clients can update own data"
-- (20260317221608:13) e `FOR UPDATE` na LINHA INTEIRA — RLS no Postgres nao e
-- por coluna. Quem tranca coluna e o gatilho `fn_lock_privileged_cliente_cols`
-- (20260801130000:165), e a lista dele deixou quatro de fora.
--
-- A mais grave anula uma correcao de ontem: `minimum_order_value`.
--
--   PATCH /clientes?id=eq.<meu>  {"minimum_order_value": 0}
--
-- e o pedido minimo que o gatilho `fn_pedido_minimo` (20260825390000) passou a
-- exigir no servidor deixa de valer para essa conta, para sempre. Eu tinha
-- tirado a regra do navegador e posto no banco; ela continuava editavel pelo
-- proprio cliente por outra porta.
--
-- As outras tres:
--   `pais`           -> alimenta o casamento de condicao de FRETE no
--                       `fn_pedido_total_appside`. Trocar o pais muda o frete.
--   `discount`       -> hoje nao e aplicado a preco nenhum (conferido), mas e
--                       campo de dinheiro na ficha, editavel pelo dono da linha.
--                       Trancar agora e barato; descobrir depois que alguem
--                       comecou a aplica-lo, nao.
--   `admin_comments` -> anotacao interna do admin SOBRE o cliente. O cliente
--                       podia reescrever o que voce anotou sobre ele.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Alguem JA mexeu? Clientes cujo minimo esta zerado ou nulo mas que tem pedido
-- abaixo do que seria o minimo de outros da mesma tabela de preco. E indicio,
-- nao prova — mas se vier linha, vale olhar a conta.
--
--   SELECT c.email, c.minimum_order_value, c.pais, c.discount,
--          count(p.id) AS pedidos
--     FROM public.clientes c
--     LEFT JOIN public.pedidos p ON p.cliente_id = c.id
--    WHERE COALESCE(c.minimum_order_value, 0) = 0
--      AND c.parent_customer_id IS NULL
--    GROUP BY c.id, c.email, c.minimum_order_value, c.pais, c.discount
--   HAVING count(p.id) > 0
--    ORDER BY count(p.id) DESC
--    LIMIT 50;
-- ---------------------------------------------------------------------------

BEGIN;

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
    -- Faltava: sem isto o cliente zerava o próprio imposto (o trigger de total
    -- de `pedidos` resolve a alíquota por esta coluna).
    NEW.tax_customer_group_id := OLD.tax_customer_group_id;

    -- NOVAS em 20260826020000. As duas primeiras entram em conta de dinheiro.
    --
    -- `minimum_order_value`: zerar isto desliga `fn_pedido_minimo`
    -- (20260825390000) para a conta. A regra saiu do navegador e foi para o
    -- banco ontem, e continuava editavel pelo proprio cliente por esta porta.
    NEW.minimum_order_value   := OLD.minimum_order_value;
    -- `pais`: o casamento de condicao de FRETE usa esta coluna.
    NEW.pais                  := OLD.pais;
    -- `discount`: hoje nao e aplicado a preco nenhum. Trancado por antecipacao
    -- — o dia em que alguem passar a aplica-lo, ja esta protegido.
    NEW.discount              := OLD.discount;
    -- `admin_comments`: anotacao SUA sobre o cliente. Ele nao reescreve.
    NEW.admin_comments        := OLD.admin_comments;
  END IF;
  RETURN NEW;
END; $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO tranca `email`, `empresa`, `customer_reference_code` nem os enderecos do
-- cadastro: o cliente PRECISA poder corrigir isso sozinho, e nenhum entra em
-- conta de dinheiro. Trocar o e-mail tem outro efeito (o sync casa clientes por
-- e-mail), mas trancar aqui quebraria o autoatendimento; fica registrado.
--
-- NAO cobre INSERT: nao existe politica de INSERT em `clientes` para
-- `authenticated` (conferido no inventario de politicas), entao nao ha por onde.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Cole de volta o corpo de `fn_lock_privileged_cliente_cols` de
-- 20260801130000_fix_3_trigger_criticals.sql (linha ~165) — o mesmo de cima,
-- sem as quatro linhas marcadas "NOVAS em 20260826020000".
--
-- Reverter devolve ao cliente o poder de zerar o proprio pedido minimo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao tem as quatro colunas novas:
--   SELECT count(*) AS deve_ser_4
--     FROM regexp_split_to_table(pg_get_functiondef(
--            'public.fn_lock_privileged_cliente_cols()'::regprocedure), E'\n') l
--    WHERE l ~ 'NEW\.(minimum_order_value|pais|discount|admin_comments)\s*:=';
--
-- 2) CONTROLE — o teste que importa e o de comportamento, e sao DOIS:
--    a) logado como CLIENTE, tentar mudar o proprio minimo:
--         PATCH /clientes?id=eq.<meu> {"minimum_order_value": 0}
--       A chamada RESPONDE OK (o gatilho nao levanta erro, ele SOBRESCREVE).
--       Confira lendo de volta: o valor tem que continuar o antigo.
--       Este e o ponto que mais engana — "deu certo" na resposta nao significa
--       que gravou.
--    b) logado como ADMIN, mudar o minimo de um cliente: TEM que gravar.
--       Sem este segundo teste, uma funcao que trava para todo mundo passaria
--       por "consertada", e voce perderia a edicao no admin.
-- ---------------------------------------------------------------------------
