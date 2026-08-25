-- ============================================================================
-- RODAR NO PROJETO **CONTAINER ZAP** (o do tracker) — NAO no PermShield.
--
-- Expoe uma unica funcao de leitura: dado um lote de numeros de container,
-- devolve o ETA mais atual de cada um. Nada alem disso sai daqui — sem eventos,
-- sem navio, sem produto, sem custo.
--
-- Por que RPC e nao acesso direto as tabelas: o PermShield e outro projeto
-- Supabase. Compartilhar a service key daria acesso TOTAL a este banco. Esta
-- funcao entrega so container + ETA + fonte, e e o unico ponto de contato.
--
-- SCHEMA CONFIRMADO no banco de producao do tracker (25/ago), nao suposto:
--   container_products(container_number text, eta date, ...)
--   tracking_cache(container_number text, tracking_data jsonb, sync_status,
--                  last_synced_at timestamptz, ...)
--   tracking_data traz: eta, etaPredicted, arrivalDate, shipmentStatus, status,
--                       events[], portStops[], destination{...}
--
-- ORDEM DE PRIORIDADE do ETA (a primeira que existir vence):
--   1. tracking_data->>'arrivalDate'  -- chegada REAL (ja aconteceu)
--   2. tracking_data->>'etaPredicted' -- previsao revisada da ShipsGo
--   3. tracking_data->>'eta'          -- ETA corrente da ShipsGo
--   4. container_products.eta         -- o da PLANILHA (fallback estatico)
--
-- A `fonte` sai junto justamente pra o PermShield tratar (4) diferente: dado de
-- planilha nao "atualiza", ele so existe. Sobrescrever um ETA digitado a mao com
-- uma data estatica de planilha, todo dia, nao seria sincronizacao — seria
-- apagar o trabalho do admin em loop.
--
-- `SET TimeZone = 'UTC'` + `AT TIME ZONE 'UTC'`: os campos da ShipsGo sao ISO com
-- hora (ex.: 2026-08-23T16:00:00.000Z). O `SET` protege o cast text->timestamptz
-- (string sem offset usaria o fuso da sessao); o `AT TIME ZONE` protege o
-- `::date`. Num banco em America/New_York, um ETA de 02:00Z viraria o dia
-- ANTERIOR sem erro nenhum.
--
-- FILTRO POR CONTAINER dentro das subqueries (nao so no JOIN): sem ele a funcao
-- varria as tabelas INTEIRAS. Duas consequencias reais — (a) uma UNICA linha com
-- data malformada em qualquer lugar do `tracking_cache` derrubava a chamada
-- inteira com erro de cast, inclusive para containers sem relacao nenhuma;
-- (b) `anon` tem statement_timeout de 8s, e regexp em toda a tabela + sort podia
-- estourar. Filtrando, o custo passa a ser proporcional ao lote pedido.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eta_por_containers(_containers text[])
RETURNS TABLE (container_number text, eta date, fonte text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'UTC'
AS $$
  WITH pedidos AS (
    SELECT DISTINCT upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) AS norm
    FROM unnest(COALESCE(_containers, '{}')) AS c
    WHERE upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) <> ''
  ),
  do_tracker AS (
    SELECT DISTINCT ON (norm) norm, chegada_real, eta_previsto, eta_corrente, situacao
    FROM (
      SELECT
        upper(regexp_replace(tc.container_number, '[^A-Za-z0-9]', '', 'g')) AS norm,
        (NULLIF(tc.tracking_data->>'arrivalDate', '')::timestamptz  AT TIME ZONE 'UTC')::date AS chegada_real,
        (NULLIF(tc.tracking_data->>'etaPredicted', '')::timestamptz AT TIME ZONE 'UTC')::date AS eta_previsto,
        (NULLIF(tc.tracking_data->>'eta', '')::timestamptz          AT TIME ZONE 'UTC')::date AS eta_corrente,
        tc.tracking_data->>'shipmentStatus' AS situacao,
        tc.last_synced_at
      FROM public.tracking_cache tc
      WHERE tc.tracking_data IS NOT NULL
        AND upper(regexp_replace(tc.container_number, '[^A-Za-z0-9]', '', 'g'))
            IN (SELECT norm FROM pedidos)
    ) x
    -- Mais recente primeiro: se o mesmo container tiver duas linhas de cache,
    -- vale a ultima sincronizada.
    ORDER BY norm, last_synced_at DESC NULLS LAST
  ),
  da_planilha AS (
    -- `container_products` tem UMA LINHA POR PRODUTO por container: sem agregar,
    -- um container com 12 produtos devolveria 12 linhas, e o lado do PermShield
    -- ficaria com a ultima que o Postgres mandasse — ordem arbitraria, resultado
    -- diferente a cada execucao. `min` = a data mais conservadora.
    SELECT norm, min(eta_planilha) AS eta_planilha
    FROM (
      SELECT
        upper(regexp_replace(cp.container_number, '[^A-Za-z0-9]', '', 'g')) AS norm,
        cp.eta AS eta_planilha
      FROM public.container_products cp
      WHERE cp.eta IS NOT NULL
        AND upper(regexp_replace(cp.container_number, '[^A-Za-z0-9]', '', 'g'))
            IN (SELECT norm FROM pedidos)
    ) y
    GROUP BY norm
  )
  SELECT
    p.norm AS container_number,
    COALESCE(t.chegada_real, t.eta_previsto, t.eta_corrente, pl.eta_planilha) AS eta,
    CASE
      WHEN t.chegada_real IS NOT NULL THEN 'arrival'
      WHEN t.eta_previsto IS NOT NULL THEN 'eta_predicted'
      WHEN t.eta_corrente IS NOT NULL THEN 'eta'
      WHEN pl.eta_planilha IS NOT NULL THEN 'sheet'
      ELSE 'none'
    END AS fonte,
    t.situacao AS status
  FROM pedidos p
  LEFT JOIN do_tracker  t  ON t.norm  = p.norm
  LEFT JOIN da_planilha pl ON pl.norm = p.norm
  WHERE COALESCE(t.chegada_real, t.eta_previsto, t.eta_corrente, pl.eta_planilha) IS NOT NULL;
$$;

-- Leitura publica LIMITADA a container -> ETA. Quem tiver a anon key deste
-- projeto e souber um numero de container descobre a data de chegada dele —
-- exposicao baixa e deliberada, em troca de nao compartilhar a service key.
REVOKE ALL ON FUNCTION public.eta_por_containers(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eta_por_containers(text[]) TO anon, authenticated, service_role;
