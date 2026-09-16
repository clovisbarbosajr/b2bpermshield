-- ============================================================================
-- FRETE OBRIGATORIO EM PEDIDO DE CLIENTE
--
-- ORDEM: 1o publicar o front (Checkout.tsx), 2o rodar ESTE SQL.
-- Ao contrario, o checkout antigo deixaria enviar sem frete e o cliente levaria
-- SHIPPING_OPTION_REQUIRED sem a tela ter avisado antes.
--
-- POR QUE. O gatilho aceitava `shipping_option_id` NULO, e o checkout deixava
-- fechar pedido sem escolher frete (ou sem nenhuma opcao disponivel para a
-- conta: o bloco sumia sem aviso). `fn_pedido_total_appside` gravava
-- `shipping_costs := 0` — frete gratis que ninguem autorizou. Retirada na loja
-- hoje e opcao de frete explicita, entao NULO nao tem mais caso legitimo.
--
-- So acrescenta a recusa do NULO, DEPOIS das isencoes (importado e staff).
-- O resto do corpo e identico ao de 20260916140000, EXCETO os RAISE.
--
-- RAISE CORRIGIDO. `RAISE EXCEPTION 'X' USING ..., MESSAGE = '...'` e invalido
-- em execucao (42601 "RAISE option already specified: MESSAGE"): o INSERT era
-- recusado, mas com a mensagem crua, sem o CODIGO que o Checkout procura. Isto
-- tambem corrige os `*_NOT_ALLOWED` que ja estao no ar via 20260916140000.
-- Forma valida: `RAISE EXCEPTION USING ERRCODE = ..., MESSAGE = 'CODIGO: ...'`.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- DIAGNOSTICO — rode ANTES. Se der 0, nenhuma conta sem atribuicao consegue
-- fechar pedido depois deste SQL: cadastrar opcao publica primeiro.
--
--   SELECT count(*) FROM shipping_options
--    WHERE ativo AND show_to_customers IS NOT FALSE AND privado IS NOT TRUE;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_opcoes_validas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _conta uuid;
  _ok    boolean;
  _tem   boolean;
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
    _tem := EXISTS (SELECT 1 FROM public.cliente_payment_options x
                      JOIN public.payment_options o ON o.id = x.payment_option_id
                     WHERE x.cliente_id = _conta AND o.ativo IS TRUE);

    SELECT (po.ativo IS TRUE)
           AND CASE WHEN _tem
                    THEN EXISTS (SELECT 1 FROM public.cliente_payment_options x
                                  WHERE x.payment_option_id = po.id AND x.cliente_id = _conta)
                    ELSE po.privado IS NOT TRUE
               END
      INTO _ok
    FROM public.payment_options po WHERE po.id = NEW.payment_option_id;

    -- `_ok IS NULL` = a opcao NAO EXISTE. Sem este teste, id inventado passaria:
    -- `IF NOT NULL` nao e verdadeiro, e o pedido entraria com uma referencia
    -- para o nada.
    IF _ok IS NULL OR NOT _ok THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
              MESSAGE = 'PAYMENT_OPTION_NOT_ALLOWED: this payment option is not available for this account';
    END IF;
  END IF;

  -- ---------- frete ----------
  -- `shipping_option_id` NULO e RECUSADO: sem ele `fn_pedido_total_appside`
  -- grava frete 0. Retirada na loja e opcao explicita, nao ausencia de opcao.
  IF NEW.shipping_option_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'SHIPPING_OPTION_REQUIRED: a shipping option is required for customer orders';
  END IF;

  IF NEW.shipping_option_id IS NOT NULL THEN
    _tem := EXISTS (SELECT 1 FROM public.cliente_shipping_options x
                      JOIN public.shipping_options s ON s.id = x.shipping_option_id
                     WHERE x.cliente_id = _conta
                       AND s.ativo IS TRUE AND s.show_to_customers IS NOT FALSE);

    SELECT (so.ativo IS TRUE)
           AND (so.show_to_customers IS NOT FALSE)
           AND CASE WHEN _tem
                    THEN EXISTS (SELECT 1 FROM public.cliente_shipping_options x
                                  WHERE x.shipping_option_id = so.id AND x.cliente_id = _conta)
                    ELSE so.privado IS NOT TRUE
               END
      INTO _ok
    FROM public.shipping_options so WHERE so.id = NEW.shipping_option_id;

    IF _ok IS NULL OR NOT _ok THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
              MESSAGE = 'SHIPPING_OPTION_NOT_ALLOWED: this shipping option is not available for this account';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Prefixo `a_`: gatilhos BEFORE disparam em ordem ALFABETICA de nome, e este
-- precisa recusar ANTES de `trg_pedido_total_appside` calcular frete em cima de
-- uma opcao proibida. Recriado igual, para o arquivo valer sozinho.
DROP TRIGGER IF EXISTS a_trg_pedido_opcoes_validas ON public.pedidos;
CREATE TRIGGER a_trg_pedido_opcoes_validas
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_opcoes_validas();

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Rodar de novo, inteiro, `supabase/migrations/20260916140000_opcoes_do_cliente_restringem.sql`.
-- Ele faz `CREATE OR REPLACE` do corpo sem a recusa do NULO e recria o gatilho.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O corpo novo esta no ar:
--   SELECT prosrc LIKE '%SHIPPING_OPTION_REQUIRED%' AS frete_obrigatorio
--     FROM pg_proc WHERE proname = 'fn_pedido_opcoes_validas';
--
-- 2) O gatilho continua existindo:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--      AND tgname = 'a_trg_pedido_opcoes_validas';
-- ---------------------------------------------------------------------------
