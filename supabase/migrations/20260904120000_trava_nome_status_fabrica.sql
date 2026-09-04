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
-- Por isso o DELETE ganha um rastro em `activity_logs`: se um dia produto voltar
-- sozinho para a vitrine, o registro de quem apagou qual status está lá.
--
-- A OUTRA METADE DA MESMA PORTA: SOMBREAR
-- Sem UNIQUE, um status criado pelo usuário podia ser RENOMEADO para "Sold Out"
-- (o gatilho só olha o nome ANTIGO) ou uma segunda "Sold Out" podia ser inserida.
-- Duas linhas com o mesmo nome: o `Map` do front fica com a última, o gatilho do
-- banco faz `LIMIT 1` sem `ORDER BY`, e cada um decide diferente. O índice único
-- no fim fecha isso. (O caçador de 02/set achou que ele já existia; não existia.)
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
  -- tocadas — e "Sold Out " com espaço no fim é o mesmo status. Por isso mesmo,
  -- renomear "Sold Out " -> "Sold Out" tem que PASSAR: é a limpeza.
  _fabrica constant text[] := ARRAY[
    'available', 'limited stock', 'sold out',
    'pre-order', 'not available', 'discontinued'
  ];
BEGIN
  IF lower(btrim(OLD.nome)) = ANY (_fabrica)
     AND lower(btrim(NEW.nome)) IS DISTINCT FROM lower(btrim(OLD.nome)) THEN
    -- SEM texto literal antes do USING: `RAISE 'x' USING MESSAGE = ...` é
    -- inválido em plpgsql ("RAISE option already specified: MESSAGE") e só
    -- estoura em EXECUÇÃO — o CREATE FUNCTION passa. A trava até segurava, mas a
    -- admin lia um erro de sintaxe no toast em vez do motivo.
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'STATUS_FABRICA_NOME_TRAVADO: o status "%s" e de sistema e nao pode ser '
        || 'renomeado. `produtos.status_produto` casa por NOME: renomear devolve a '
        || 'vitrine, compravel, todo produto tirado de venda com este status. '
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
  _slug   text;
BEGIN
  -- ATENÇÃO AO CASAMENTO: `produtos.status_produto` guarda o slug em PORTUGUÊS
  -- ('esgotado', 'pre_venda'), e `product_statuses.nome` está em INGLÊS
  -- ('Sold Out', 'Pre-order'). Comparar cru dava ZERO SEMPRE — o rastro gravava
  -- "0 produtos órfãos" enquanto 40 esgotados voltavam para a vitrine, e quem
  -- investigasse descartaria a hipótese certa. Mesma tabela de tradução de
  -- `fn_item_produto_valido` (20260825330000) e do `NAME_MAP` de
  -- `src/lib/stock.ts`, no sentido inverso (nome -> slug). Mexeu num, mexe nos
  -- três.
  _slug := CASE lower(btrim(OLD.nome))
    WHEN 'available'     THEN 'disponivel'
    WHEN 'not available' THEN 'indisponivel'
    WHEN 'sold out'      THEN 'esgotado'
    WHEN 'pre-order'     THEN 'pre_venda'
    WHEN 'limited stock' THEN 'estoque_limitado'
    WHEN 'discontinued'  THEN 'descontinuado'
    ELSE lower(btrim(OLD.nome))   -- status criado pelo usuário: gravado como está
  END;

  SELECT count(*) INTO _orfaos
  FROM public.produtos
  WHERE lower(btrim(coalesce(status_produto, ''))) = _slug;

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
      'slug_procurado', _slug,
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
-- NOME ÚNICO. Fecha o sombreamento (renomear "Teste" -> "Sold Out", ou inserir
-- uma segunda "Sold Out"). Num `DO` com captura: se já houver duplicata na
-- tabela, o índice falha — e não pode derrubar os dois gatilhos acima junto.
-- Nesse caso avisa com os nomes repetidos, e o dono resolve antes de reaplicar.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _dup text;
BEGIN
  SELECT string_agg(n || ' (' || c || 'x)', ', ')
    INTO _dup
  FROM (
    SELECT lower(btrim(nome)) AS n, count(*) AS c
    FROM public.product_statuses
    GROUP BY 1 HAVING count(*) > 1
  ) d;

  IF _dup IS NOT NULL THEN
    RAISE WARNING 'product_statuses tem nome repetido — indice unico NAO criado. Resolva e reaplique: %', _dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS product_statuses_nome_uniq
      ON public.product_statuses (lower(btrim(nome)));
    RAISE NOTICE 'product_statuses_nome_uniq: ok';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — rode UM PASSO DE CADA VEZ. O passo 1 falha DE PROPÓSITO; se
-- colar tudo junto, o runner aborta a transação nele e os passos 2 e 3 nem rodam
-- — e você vai achar que o 2 "não deu resposta".
--
--   -- 1. renomear um de fábrica tem que FALHAR, com a mensagem começando em
--   --    "STATUS_FABRICA_NOME_TRAVADO" (não "RAISE option already specified"):
--   UPDATE public.product_statuses SET nome = 'Esgotado' WHERE lower(btrim(nome)) = 'sold out';
--
--   -- 2. um criado por você: renomeia e apaga, tem que PASSAR:
--   INSERT INTO public.product_statuses (nome) VALUES ('Teste Claude');
--   UPDATE public.product_statuses SET nome = 'Teste Claude 2' WHERE nome = 'Teste Claude';
--   DELETE FROM public.product_statuses WHERE nome = 'Teste Claude 2';
--
--   -- 3. o delete do passo 2 deixou rastro (orfaos = 0, porque nenhum produto
--   --    usava esse status; para um de fábrica o número seria o real):
--   SELECT entity_name, details FROM public.activity_logs
--   WHERE entity_type = 'product_status' ORDER BY created_at DESC LIMIT 3;
--
--   -- 4. o índice existe:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'product_statuses_nome_uniq';
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_status_fabrica_nome_travado ON public.product_statuses;
--   DROP TRIGGER IF EXISTS trg_status_apagado_deixa_rastro ON public.product_statuses;
--   DROP INDEX IF EXISTS public.product_statuses_nome_uniq;
--
-- NÃO REVERTA sem trocar `produtos.status_produto` por FK antes. Sem a trava,
-- uma renomeação inocente devolve produto esgotado à venda, sem erro nenhum.
-- ---------------------------------------------------------------------------
