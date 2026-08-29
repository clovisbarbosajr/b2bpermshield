-- Um padrao de imposto so, garantido pelo BANCO.
--
-- O PROBLEMA. Marcar uma classe/grupo como padrao e um passo; desmarcar os
-- outros e um SEGUNDO request feito pela tela (`SalesTax.limparOutrosDefault`).
-- Entre os dois existe uma janela com DOIS padroes, e se o navegador fechar,
-- a rede cair ou o admin sair da pagina no meio, os dois padroes FICAM.
--
-- E dois padroes custam dinheiro do cliente, nao um aviso na tela:
--   * `Checkout.tsx` le com `.eq("is_default", true).maybeSingle()`. Duas linhas
--     fazem o `maybeSingle` ERRAR, `taxRate` fica 0 e a tela mostra imposto zero.
--   * o trigger do banco usa `WHERE is_default ... LIMIT 1`, escolhe uma e
--     CALCULA o imposto de verdade.
--   * o checkout entao grava o total do banco. O cliente paga mais do que viu.
--
-- POR QUE TRIGGER E NAO UNIQUE PARCIAL. `CREATE UNIQUE INDEX ... WHERE
-- is_default` recusaria o INSERT/UPDATE do novo padrao ANTES de o antigo ser
-- limpo — quebraria a tela, que marca primeiro e limpa depois. O trigger faz a
-- limpeza dentro da MESMA transacao do UPDATE/INSERT: nunca existe um instante
-- com dois padroes visivel para outra sessao, e a tela continua funcionando sem
-- mudanca. O segundo request dela vira redundante (idempotente), nao errado.

CREATE OR REPLACE FUNCTION public.fn_so_um_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default IS TRUE THEN
    -- `format` com `TG_TABLE_NAME`: a mesma funcao serve as duas tabelas, e o
    -- nome vem do proprio gatilho — nao de entrada de usuario.
    EXECUTE format(
      'UPDATE public.%I SET is_default = false WHERE is_default IS TRUE AND id <> $1',
      TG_TABLE_NAME
    ) USING NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER, e nao BEFORE: no INSERT a linha nova so tem `id` depois de gravada, e
-- e ele que exclui a propria linha do UPDATE acima.
DROP TRIGGER IF EXISTS trg_so_um_default ON public.tax_classes;
CREATE TRIGGER trg_so_um_default
  AFTER INSERT OR UPDATE OF is_default ON public.tax_classes
  FOR EACH ROW WHEN (NEW.is_default IS TRUE)
  EXECUTE FUNCTION public.fn_so_um_default();

DROP TRIGGER IF EXISTS trg_so_um_default ON public.tax_customer_groups;
CREATE TRIGGER trg_so_um_default
  AFTER INSERT OR UPDATE OF is_default ON public.tax_customer_groups
  FOR EACH ROW WHEN (NEW.is_default IS TRUE)
  EXECUTE FUNCTION public.fn_so_um_default();

-- ARRUMA O QUE JA ESTIVER TORTO. Se hoje ja houver dois padroes, o trigger
-- sozinho nao conserta (ele so age quando alguem grava). Mantem o mais antigo,
-- que e o que o `LIMIT 1` do trigger de imposto vinha usando na pratica, e
-- desmarca os demais. NAO apaga nenhuma linha — so tira a marca de padrao.
UPDATE public.tax_classes SET is_default = false
 WHERE is_default IS TRUE
   AND id <> (SELECT id FROM public.tax_classes WHERE is_default IS TRUE
              ORDER BY created_at NULLS LAST, id LIMIT 1);

UPDATE public.tax_customer_groups SET is_default = false
 WHERE is_default IS TRUE
   AND id <> (SELECT id FROM public.tax_customer_groups WHERE is_default IS TRUE
              ORDER BY created_at NULLS LAST, id LIMIT 1);

-- VERIFICACAO. Os dois numeros tem que ser 0 ou 1 (0 = nenhum padrao definido,
-- que e outro problema, mas nao este) e `trigger_ok` tem que ser 2.
SELECT
  (SELECT count(*) FROM public.tax_classes         WHERE is_default IS TRUE) AS classes_padrao,
  (SELECT count(*) FROM public.tax_customer_groups WHERE is_default IS TRUE) AS grupos_padrao,
  (SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname = 'trg_so_um_default')                 AS trigger_ok;

-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_so_um_default ON public.tax_classes;
--   DROP TRIGGER IF EXISTS trg_so_um_default ON public.tax_customer_groups;
--   DROP FUNCTION IF EXISTS public.fn_so_um_default();
-- (os UPDATEs acima nao tem rollback automatico: se precisar, remarque a mao a
--  classe/grupo que voce quer como padrao.)
