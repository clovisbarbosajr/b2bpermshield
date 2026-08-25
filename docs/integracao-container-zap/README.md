# ETA automático — Produção × CONTAINER ZAP

**No ar desde 25/ago/2026.** Primeira execução real: 16 lidos, 13 casados,
13 ETAs atualizados, 0 erros.

O PermShield busca sozinho, 1× por dia, a data de chegada de cada container em
trânsito e escreve em `producao_pedidos.est_entrega`. Ninguém abre o tracker
para copiar data.

## Peças

| Peça | Onde vive | O que faz |
|---|---|---|
| `eta_por_containers(text[])` | **CONTAINER ZAP** | Recebe a lista de containers, devolve container + ETA + fonte. Único ponto de contato entre os dois projetos. |
| `sync-container-eta` | PermShield (edge) | Lê os pendentes, chama a RPC, grava o ETA, registra a execução. |
| `permshield-cron-eta` | PermShield (pg_cron) | Dispara a função todo dia às **06:20 UTC**. |
| `producao_eta_sync_log` | PermShield | Uma linha por execução. É a prova de que rodou. |
| `eta_fonte` / `eta_atualizado_em` | `producao_pedidos` | De onde veio a data e quando. Alimenta o selo na tela. |

## Prioridade da data

A primeira que existir vence:

1. `arrivalDate` — chegada real → selo **chegou**
2. `etaPredicted` — previsão revisada da ShipsGo → selo **auto**
3. `eta` — ETA corrente da ShipsGo → selo **auto**
4. `container_products.eta` — planilha → selo **planilha**

A planilha (4) é a única que **não sobrescreve**: só preenche campo vazio. É dado
estático — deixá-la sobrescrever apagaria o ETA digitado à mão todo dia, para
sempre. Ver `PENDENCIAS.md`.

## Instalação (já feita — aqui para reinstalar ou clonar)

1. **CONTAINER ZAP → SQL editor**: rodar `01-RODAR-NO-CONTAINER-ZAP.sql`.
2. **PermShield → Secrets**: criar `TRACKER_SUPABASE_URL` e
   `TRACKER_SUPABASE_ANON_KEY` com os valores de `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_PUBLISHABLE_KEY` do `.env` do CONTAINER ZAP.
   **Sem aspas em volta** — ver Armadilha 2 abaixo.
3. **PermShield → SQL editor**: rodar
   `supabase/migrations/20260825120000_sync_eta_container.sql`.
4. **PermShield**: deploy da edge function + publish.

`CRON_SECRET` e `PROJECT_ANON_KEY` já existiam no Vault (usados pelos crons do
b2bwave-sync). **Não recriar** — reescrevê-los quebra aqueles agendamentos.

## Verificar

Rodou hoje?

```sql
select iniciado_em, ok, mensagem, itens_lidos, itens_casados,
       itens_atualizados, itens_com_erro
from public.producao_eta_sync_log
order by iniciado_em desc limit 5;
```

Quais ETAs o robô escreveu?

```sql
select numero_container, tracking, est_entrega, eta_fonte, eta_atualizado_em
from public.producao_pedidos
where eta_atualizado_em is not null
order by eta_atualizado_em desc limit 20;
```

O agendamento está ativo?

```sql
select jobname, schedule, active from cron.job where jobname = 'permshield-cron-eta';
```

Forçar uma execução agora (sem esperar 06:20):

```sql
select net.http_post(
  url     := 'https://bnicfvxvyblzzatvursw.supabase.co/functions/v1/sync-container-eta',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'PROJECT_ANON_KEY'),
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
  ),
  body    := '{}'::jsonb
) as request_id;
```

Se o log não registrar nada, a chamada morreu **antes** de entrar na função:

```sql
select status_code, left(content, 500) as resposta, error_msg
from net._http_response order by id desc limit 3;
```

## Armadilhas já pagas

**1. `404 NOT_FOUND` — a função não estava publicada.** O commit estava no GitHub,
mas o Lovable não tinha feito o deploy da edge function e o botão de publish não
mostrava nada pendente. Resolvido pedindo o deploy no chat do Lovable.

**2. `Invalid URL: '"https://..."'` — secret salvo com aspas.** Copiar o valor
direto do `.env` traz as aspas junto. Corrigido no painel; o commit `c63ce1e`
também faz a função tolerar aspas nos dois secrets do tracker.

**3. Tela mostrando ETA vazio depois do sync.** Página carregada antes da
execução. F5 resolve — o dado está no banco.

**4. `verify_jwt = false` no `config.toml` não é opcional.** Sem isso o portão do
Supabase exige login, o cron (que usa segredo, não login) toma 401 **antes** de
entrar na função — e como o log é escrito dentro dela, não sobra nem registro do
erro. A autorização é feita pela própria função, na primeira linha, antes de
qualquer escrita.

## O que NÃO quebra

- Tracker fora do ar → registra a falha, não toca em nenhum ETA.
- UI publicada antes do SQL → a tela detecta a ausência das colunas e trabalha sem
  elas, **inclusive ao salvar**. Só o painel e os selos deixam de aparecer.
- Cron não agendado → o bloco avisa e segue; colunas e log continuam de pé.
- Um item falha no meio de 500 → os outros continuam; o erro vai para o contador.
- Mais de 1000 itens → lê paginado, o limite do PostgREST não corta em silêncio.
- Item já recebido → nem entra na lista.
