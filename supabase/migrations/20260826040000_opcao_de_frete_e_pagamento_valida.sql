-- ============================================================================
-- O CLIENTE PARA DE ESCOLHER CONDICAO DE PAGAMENTO QUE NAO E DELE
--
-- Achado do cetico de preco (26/ago). A tela do checkout filtra certo:
--
--   canSee(o, permitidas) = !o.privado || permitidas.has(o.id)
--   (src/pages/portal/Checkout.tsx:188)
--
-- ...mas quem grava e o cliente, e `pedidos.payment_option_id` /
-- `shipping_option_id` aceitam QUALQUER uuid. A RLS de `payment_options` e
-- `shipping_options` (20260623060000:36,50) so limita LEITURA — escrever o id
-- e livre.
--
-- Consequencia concreta: o cliente le a lista de opcoes publicas, descobre (ou
-- adivinha) o id de uma condicao PRIVADA — "faturado 60 dias", por exemplo —
-- e a grava no proprio pedido. Ele nao paga menos naquele instante; ele leva a
-- mercadoria a prazo sem voce ter concedido prazo.
--
-- Mesma coisa no frete: opcao privada com tabela mais barata.
--
-- ESTA MIGRATION REPLICA NO SERVIDOR A REGRA DA TELA, e so ela.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — rode ANTES e guarde.
--
-- Pedido JA existente com opcao privada que a conta nao tinha atribuida. Se
-- vier linha, alguem usou (ou a atribuicao foi removida depois do pedido).
--
--   SELECT p.numero, p.created_at, c.email,
--          po.nome AS pagamento_privado
--     FROM public.pedidos p
--     JOIN public.clientes c        ON c.id = p.cliente_id
--     JOIN public.payment_options po ON po.id = p.payment_option_id
--    WHERE p.b2bwave_order_id IS NULL
--      AND po.privado IS TRUE
--      AND NOT EXISTS (
--            SELECT 1 FROM public.cliente_payment_options x
--             WHERE x.payment_option_id = po.id
--               AND x.cliente_id = COALESCE(c.parent_customer_id, c.id))
--    ORDER BY p.created_at DESC
--    LIMIT 50;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_opcoes_validas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _conta uuid;
  _ok    boolean;
BEGIN
  -- Pedido importado: as opcoes vem do outro sistema, e a regra de la nao e esta.
  IF NEW.b2bwave_order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Staff monta pedido por telefone e precisa poder conceder a condicao na hora.
  -- `auth.uid()` NULL = service key ou conexao direta; tambem passa.
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'manager'::app_role)
     OR public.has_role(auth.uid(), 'warehouse'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Sub-usuario herda as atribuicoes da conta da empresa — mesma regra da tela.
  SELECT COALESCE(parent_customer_id, id) INTO _conta
  FROM public.clientes WHERE id = NEW.cliente_id;

  -- ---------- pagamento ----------
  IF NEW.payment_option_id IS NOT NULL THEN
    SELECT (po.ativo IS TRUE)
           AND (po.privado IS NOT TRUE
                OR EXISTS (SELECT 1 FROM public.cliente_payment_options x
                            WHERE x.payment_option_id = po.id AND x.cliente_id = _conta))
      INTO _ok
    FROM public.payment_options po WHERE po.id = NEW.payment_option_id;

    -- `_ok IS NULL` = a opcao NAO EXISTE. Sem este teste, id inventado passaria:
    -- `IF NOT NULL` nao e verdadeiro, e o pedido entraria com uma referencia
    -- para o nada.
    IF _ok IS NULL OR NOT _ok THEN
      RAISE EXCEPTION 'PAYMENT_OPTION_NOT_ALLOWED'
        USING ERRCODE = 'check_violation',
              MESSAGE = 'PAYMENT_OPTION_NOT_ALLOWED: this payment option is not available for this account';
    END IF;
  END IF;

  -- ---------- frete ----------
  -- `shipping_option_id` NULO continua valendo: a tela nao obriga a escolher
  -- (`Checkout.tsx:459` devolve frete 0 quando nao ha escolha), e recusar aqui
  -- derrubaria pedido legitimo — retirada na loja, por exemplo.
  IF NEW.shipping_option_id IS NOT NULL THEN
    SELECT (so.ativo IS TRUE)
           AND (so.show_to_customers IS NOT FALSE)
           AND (so.privado IS NOT TRUE
                OR EXISTS (SELECT 1 FROM public.cliente_shipping_options x
                            WHERE x.shipping_option_id = so.id AND x.cliente_id = _conta))
      INTO _ok
    FROM public.shipping_options so WHERE so.id = NEW.shipping_option_id;

    IF _ok IS NULL OR NOT _ok THEN
      RAISE EXCEPTION 'SHIPPING_OPTION_NOT_ALLOWED'
        USING ERRCODE = 'check_violation',
              MESSAGE = 'SHIPPING_OPTION_NOT_ALLOWED: this shipping option is not available for this account';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Prefixo `a_`: gatilhos BEFORE disparam em ordem ALFABETICA de nome, e este
-- precisa recusar ANTES de `trg_pedido_total_appside` calcular frete em cima de
-- uma opcao proibida.
DROP TRIGGER IF EXISTS a_trg_pedido_opcoes_validas ON public.pedidos;
CREATE TRIGGER a_trg_pedido_opcoes_validas
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_opcoes_validas();

COMMIT;

-- ---------------------------------------------------------------------------
-- O QUE ISTO NAO FAZ
--
-- NAO recusa pedido SEM opcao de frete. A tela permite, e o gatilho de total ja
-- trata como frete 0. Fechar isso e decisao de operacao, nao de seguranca:
-- se voce quiser exigir escolha de frete, me diga e eu acrescento.
--
-- NAO cobre UPDATE. Nao existe politica que deixe o CLIENTE alterar `pedidos`
-- (conferido no inventario de politicas) — quem altera e staff, que esta isento
-- de proposito.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS a_trg_pedido_opcoes_validas ON public.pedidos;
--   DROP FUNCTION IF EXISTS public.fn_pedido_opcoes_validas();
--
-- Reverter devolve ao cliente a possibilidade de gravar condicao de pagamento
-- que voce nunca concedeu aquela conta.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O gatilho existe:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--      AND tgname = 'a_trg_pedido_opcoes_validas';
--
-- 2) CONTROLE — DOIS testes, e o (b) e o que impede o desastre silencioso:
--    a) cliente comum fecha pedido com opcao PUBLICA: tem que PASSAR.
--       Sem este teste, um gatilho que recusa tudo passaria por "consertado" e
--       voce descobriria pelo telefone, com a loja parada.
--    b) cliente comum tenta gravar `payment_option_id` de uma opcao PRIVADA que
--       a conta dele nao tem: tem que ser RECUSADO com
--       `PAYMENT_OPTION_NOT_ALLOWED`.
--    c) ADMIN monta pedido com a mesma opcao privada: tem que PASSAR.
-- ---------------------------------------------------------------------------
