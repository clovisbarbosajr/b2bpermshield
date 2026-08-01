-- ============================================================================
-- PREÇO DO SUB-LOGIN: usar a conta da EMPRESA (bug 38/50).
--
-- `preco_autoritativo` (o lado que GRAVA o preço no pedido) faz:
--     SELECT tabela_preco_id INTO _tpid FROM clientes WHERE id = _cliente_id;
--     SELECT preco ... FROM produto_precos_cliente WHERE cliente_id = _cliente_id;
-- sem `COALESCE(parent_customer_id, id)`, que é a convenção do repo inteiro
-- (privacidade: 20260622150000/160000/191614/200000/200725, 20260701130000,
--  20260703120000; RLS: 20260623060000:19,28).
--
-- Consequência: o preço NEGOCIADO da empresa (produto_precos_cliente) é do PAI.
-- O funcionário (sub-login) não casa nessa linha → paga preço de tabela/base,
-- enquanto o dono da conta vê o preço combinado. Mesma compra, dois preços.
--
-- A tabela de preço ESTAVA parcialmente coberta: `trg_subuser_inherit_pricelist`
-- (20260622000000:19-28) copia `tabela_preco_id` do pai no INSERT do sub-login.
-- Mas é um SNAPSHOT — se o pai trocar de tabela depois, o filho fica no antigo.
-- `produto_precos_cliente` não tem nada equivalente.
--
-- Correção: resolver a conta com COALESCE(parent_customer_id, id) e, na tabela
-- de preço, preferir a do próprio sub-login (se o admin definiu uma específica)
-- e cair na da empresa quando ele não tiver — assim o snapshot velho deixa de
-- importar sem tirar do admin a possibilidade de dar uma tabela só pro filho.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.preco_autoritativo(_produto_id uuid, _cliente_id uuid, _qtd integer)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _base numeric; _tpid uuid; _cust numeric; _extras boolean; _pl numeric; _disc numeric;
  _conta uuid; _tp_self uuid; _tp_conta uuid;
BEGIN
  SELECT preco INTO _base FROM public.produtos WHERE id = _produto_id;
  IF _base IS NULL THEN RETURN 0; END IF;

  -- Conta da empresa (o próprio cliente, se não for sub-login).
  SELECT COALESCE(parent_customer_id, id), tabela_preco_id
    INTO _conta, _tp_self
  FROM public.clientes WHERE id = _cliente_id;
  IF _conta IS NULL THEN _conta := _cliente_id; END IF;

  IF _conta = _cliente_id THEN
    _tpid := _tp_self;
  ELSE
    SELECT tabela_preco_id INTO _tp_conta FROM public.clientes WHERE id = _conta;
    _tpid := COALESCE(_tp_self, _tp_conta);
  END IF;

  -- 1) preço específico do cliente (maior prioridade) — na conta da EMPRESA.
  SELECT preco, aplicar_descontos_extras INTO _cust, _extras
  FROM public.produto_precos_cliente WHERE produto_id = _produto_id AND cliente_id = _conta;
  IF _cust IS NOT NULL THEN
    IF _extras IS TRUE THEN
      _disc := public._resolve_desconto(_produto_id, _tpid, _qtd, _cust);
      IF _disc IS NOT NULL THEN RETURN _disc; END IF;
    END IF;
    RETURN _cust;
  END IF;

  -- 2) tabela de preço
  IF _tpid IS NOT NULL THEN
    SELECT preco INTO _pl FROM public.tabela_preco_itens
    WHERE tabela_preco_id = _tpid AND produto_id = _produto_id;
    IF _pl IS NOT NULL THEN RETURN _pl; END IF;
  END IF;

  -- 3) descontos por quantidade
  _disc := public._resolve_desconto(_produto_id, _tpid, _qtd, _base);
  IF _disc IS NOT NULL THEN RETURN _disc; END IF;

  -- 4) base
  RETURN _base;
END; $$;
