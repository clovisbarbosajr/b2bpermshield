-- ============================================================================
-- TRAVA O NOME dos seis status de fábrica. DELETE continua liberado.
--
-- Decisão da Jessika, 03/set/2026 (item DADO 3): *"Pode travar a edicao, mas
-- deixa liberada a opcao de deletar o status. Status novo pode ser criado à
-- vontade."* — e, perguntada de novo sobre o risco de apagar: *"Deixe a opcao de
-- apagar, eu entendo os riscos."*
--
-- POR QUE O NOME IMPORTA
-- `produtos.status_produto` é TEXTO e casa com `product_statuses.nome` por NOME,
-- sem FK. Os três consumidores falham ABRINDO — nome que não casa é tratado como
-- "pode comprar e pode aparecer":
--   • `src/lib/stock.ts`            (carrinho e catálogo)
--   • o catálogo do portal
--   • o gatilho `fn_item_produto_valido`
-- Renomear "Sold Out" devolve à vitrine, comprável, todo produto tirado de venda
-- de propósito com estoque em caixa.
--
-- O RISCO QUE FICA, POR DECISÃO DELA
-- Apagar tem o MESMO efeito que renomear: sem a linha, o nome deixa de casar.
-- Isto foi dito a ela com essas palavras e a resposta foi manter o DELETE livre.
-- Esta migration protege metade da porta, de propósito — não é esquecimento.
--
-- Por isso o DELETE ganha um aviso em `activity_logs`: se um dia produto voltar
-- sozinho para a vitrine, o registro de quem apagou qual status está lá.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_status_fabrica_nome_travado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Os seis do seed original (20260318203107). Comparação por `lower(btrim())`
  -- porque a tela já apara espaço desde 30/ago, mas as linhas antigas não foram
  -- tocadas — e "Sold Out " com espaço no fim é o mesmo status.
  _fabrica constant text[] := ARRAY[
    'available', 'limited stock', 'sold out',
    'pre-order', 'not available', 'discontinued'
  ];
BEGIN
  IF lower(btrim(OLD.nome)) = ANY (_fabrica)
     AND lower(btrim(NEW.nome)) IS DISTINCT FROM lower(btrim(OLD.nome)) THEN
    RAISE EXCEPTION 'STATUS_FABRICA_NOME_TRAVADO'
      USING ERRCODE = 'check_violation',
            MESSAGE = format(
              'O status "%s" e de sistema e nao pode ser renomeado. '
              || '`produtos.status_produto` casa por NOME: renomear devolve a vitrine, '
              || 'compravel, todo produto tirado de venda com este status. '
              || 'Para um rotulo diferente, crie um status novo.', OLD.nome);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_status_fabrica_nome_travado ON public.product_statuses;
CREATE TRIGGER trg_status_fabrica_nome_travado
  BEFORE UPDATE ON public.product_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_status_fabrica_nome_travado();

-- ---------------------------------------------------------------------------
-- DELETE fica LIBERADO (decisão dela), mas deixa rastro.
--
-- Sem isto, um produto voltando sozinho para a vitrine é um mistério: o status
-- some da tabela e nada diz que ele existiu. Com isto, `activity_logs` responde
-- quem apagou o quê e quando — e quantos produtos ficaram órfãos naquele
-- instante, que é o número que mede o estrago.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_status_apagado_deixa_rastro()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _orfaos int;
BEGIN
  SELECT count(*) INTO _orfaos
  FROM public.produtos
  WHERE lower(btrim(coalesce(status_produto, ''))) = lower(btrim(OLD.nome));

  INSERT INTO public.activity_logs
    (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
  VALUES (
    auth.uid(),
    coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), 'desconhecido'),
    'sistema',
    'deleted',
    'product_status',
    OLD.id::text,
    OLD.nome,
    jsonb_build_object(
      'produtos_que_ficaram_com_status_orfao', _orfaos,
      'aviso', 'status_produto casa por NOME: estes produtos voltam a ser compraveis e visiveis'
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_status_apagado_deixa_rastro ON public.product_statuses;
CREATE TRIGGER trg_status_apagado_deixa_rastro
  BEFORE DELETE ON public.product_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_status_apagado_deixa_rastro();

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (rode depois e me mande):
--
--   -- 1. renomear um de fábrica tem que FALHAR:
--   UPDATE public.product_statuses SET nome = 'Esgotado' WHERE lower(btrim(nome)) = 'sold out';
--
--   -- 2. renomear um criado por você tem que PASSAR (crie um antes se não houver):
--   INSERT INTO public.product_statuses (nome) VALUES ('Teste Claude');
--   UPDATE public.product_statuses SET nome = 'Teste Claude 2' WHERE nome = 'Teste Claude';
--   DELETE FROM public.product_statuses WHERE nome = 'Teste Claude 2';
--
--   -- 3. o delete do passo 2 tem que ter deixado uma linha:
--   SELECT entity_name, details FROM public.activity_logs
--   WHERE entity_type = 'product_status' ORDER BY created_at DESC LIMIT 3;
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_status_fabrica_nome_travado ON public.product_statuses;
--   DROP TRIGGER IF EXISTS trg_status_apagado_deixa_rastro ON public.product_statuses;
--
-- NÃO REVERTA sem trocar `produtos.status_produto` por FK antes. Sem a trava,
-- uma renomeação inocente devolve produto esgotado à venda, sem erro nenhum.
-- ---------------------------------------------------------------------------
