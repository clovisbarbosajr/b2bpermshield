-- ============================================================================
-- OPCOES MARCADAS NA FICHA DO CLIENTE RESTRINGEM O QUE ELE PODE ESCOLHER
--
-- ORDEM: 1o publicar o front (Checkout.tsx + src/lib/opcoesDisponiveis.ts),
--        2o rodar ESTE SQL.
-- Ao contrario, o checkout antigo ainda mostraria as 5 opcoes publicas e o
-- cliente que escolhesse uma desmarcada levaria SHIPPING_OPTION_NOT_ALLOWED
-- no botao de finalizar.
--
-- POR QUE. A aba "Customer shipping options"/"Payment options" da ficha do
-- cliente define quais opcoes ele VE (B2BWave: "choose which shipping options
-- your customer will see during checkout"; a nossa ficha de pagamento diz "If
-- none are selected, the customer will have access to all active payment
-- options"). A regra antiga, na tela e aqui, era `!privado OR atribuida`: toda
-- opcao publica passava mesmo DESMARCADA. Dado real: 5 fretes publicos, cliente
-- com 3 marcados -> checkout mostrava 5, e este gatilho aceitava os 5.
--
-- REGRA NOVA (a mesma de `opcoesDisponiveis.ts`):
--   - a conta tem alguma opcao ATIVA atribuida (frete: ativa E visivel ao
--     cliente) -> so as atribuidas valem, publicas ou privadas;
--   - nao tem nenhuma -> valem as publicas;
--   - atribuicao a opcao inativa/oculta nao conta (senao a conta ficaria sem
--     opcao nenhuma — a tela tambem ignora).
--
-- So muda a condicao de validade. Isencao de staff, `auth.uid() IS NULL`,
-- pedido importado, `_ok IS NULL`, frete nulo aceito, codigos de erro e nome do
-- gatilho ficam iguais aos de 20260826040000.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- DIAGNOSTICO — rode ANTES e guarde. Contas com atribuicao de frete e quantas
-- opcoes publicas ativas deixam de enxergar.
--
--   SELECT c.email, count(DISTINCT x.shipping_option_id) AS marcadas
--     FROM public.cliente_shipping_options x
--     JOIN public.clientes c ON c.id = x.cliente_id
--     JOIN public.shipping_options s ON s.id = x.shipping_option_id
--    WHERE s.ativo IS TRUE AND s.show_to_customers IS NOT FALSE
--    GROUP BY c.email ORDER BY marcadas;
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
      RAISE EXCEPTION 'PAYMENT_OPTION_NOT_ALLOWED'
        USING ERRCODE = 'check_violation',
              MESSAGE = 'PAYMENT_OPTION_NOT_ALLOWED: this payment option is not available for this account';
    END IF;
  END IF;

  -- ---------- frete ----------
  -- `shipping_option_id` NULO continua valendo: a tela nao obriga a escolher
  -- (devolve frete 0 quando nao ha escolha), e recusar aqui derrubaria pedido
  -- legitimo — retirada na loja, por exemplo.
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
      RAISE EXCEPTION 'SHIPPING_OPTION_NOT_ALLOWED'
        USING ERRCODE = 'check_violation',
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
-- Rodar de novo, inteiro, `supabase/migrations/20260826040000_opcao_de_frete_e_pagamento_valida.sql`.
-- Ele faz `CREATE OR REPLACE` do corpo antigo (`privado IS NOT TRUE OR atribuida`)
-- e recria o mesmo gatilho. Reverter o SQL sem reverter o front deixa o servidor
-- mais frouxo que a tela (aceita publica desmarcada), nao quebra pedido.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) O corpo novo esta no ar:
--   SELECT prosrc LIKE '%CASE WHEN _tem%' AS regra_nova
--     FROM pg_proc WHERE proname = 'fn_pedido_opcoes_validas';
--
-- 2) O gatilho continua existindo:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.pedidos'::regclass AND NOT tgisinternal
--      AND tgname = 'a_trg_pedido_opcoes_validas';
--
-- 3) CONTROLE pelo portal, logado como cliente comum:
--    a) conta SEM nenhuma atribuicao fecha pedido com frete PUBLICO: PASSA.
--    b) conta com 3 fretes marcados fecha com um dos 3: PASSA.
--    c) a mesma conta grava `shipping_option_id` de publica DESMARCADA:
--       RECUSADO com `SHIPPING_OPTION_NOT_ALLOWED`.
--    d) ADMIN monta pedido para essa conta com a desmarcada: PASSA.
-- ---------------------------------------------------------------------------
