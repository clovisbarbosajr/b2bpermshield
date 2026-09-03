# Desligar o sync do B2BWave e nascer com zero pedidos

**Decisão do cliente, 02/set/2026.** O sistema B2B entra em produção **sem nenhum
pedido migrado**. Os **clientes e o catálogo ficam**. O sync com o B2BWave morre, e
a API de saída junto.

> *"vai começar do ZERO, zero ordens... vamos manter APENAS os clientes.
> (...) não precisamos mais daquela parte de sync... tudo aquilo vai morrer e
> qualquer outra ligação com API. (...) esse período foi bom pq serviu de testes,
> aprendizado."*

## Decisões do dono, respondidas em 02/set

| pergunta | resposta |
|---|---|
| "Apenas os clientes" é literal? | **Não.** Zera só `pedidos`. Ficam clientes, produtos, categorias, tabelas de preço e estoque — o catálogo continua pronto para vender no dia 1. |
| ETA de container (CONTAINER ZAP / ShipsGo) morre? | **Fica.** Não é do B2BWave; alimenta o módulo Produção. |
| Edge `api` (API de saída, token próprio) morre? | **Morre.** Uma porta de entrada a menos. |

Ficam também, por serem serviço e não integração com o B2BWave: **Stripe, Resend e
Twilio**.

---

## A ORDEM IMPORTA — e o motivo

**Há CINCO cron jobs rodando no banco agora**, chamando a edge `b2bwave-sync`
sozinhos:

| job | frequência | ação | criado em |
|---|---|---|---|
| `b2bwave-cron-orders` | **a cada 15 min** | `cron_orders` | `20260618000002` |
| `b2bwave-cron-customers` | a cada 15 min, defasado 5 | `sync_customers` | `20260618000002` |
| `b2bwave-cron-products` | 1x por hora, minuto 10 | `sync_products` | `20260618000002` |
| `b2bwave-cron-pricelists` | 1x por hora, minuto 20 | `sync_price_lists` | `20260618000002` |
| `b2bwave-cron-categories` | 1x por hora, minuto 5 | `sync_categories` | **`20260717130000`** |

⚠️ **O `categories` mora em outra migration** e por isso escapou do inventário
inicial — que dizia "quatro". Só apareceu quando o dono rodou o `SELECT` de
conferência e sobrou uma linha. Qualquer varredura por `b2bwave-` tem que ser por
**prefixo**, nunca por lista escrita à mão.

**Apagar os pedidos antes de desligar o cron não funciona:** em até 15 minutos o
`cron_orders` reimporta tudo do B2BWave. E o `sync_customers` continua
sobrescrevendo os clientes que devem ficar como estão.

Por isso: **1) cron → 2) dado → 3) código.**

---

## PASSO 1 — Desligar os cron jobs (SQL, o dono executa)

Nada é apagado aqui; só para de disparar. Reversível.

```sql
-- 1. VER o que está agendado hoje (rode primeiro, e me mande o resultado):
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;

-- 2. Desligar TODOS de uma vez, por prefixo — nunca por lista escrita à mão.
--    Foi uma lista à mão que deixou o `b2bwave-cron-categories` para trás.
DO $$
DECLARE _job text;
BEGIN
  FOR _job IN SELECT jobname FROM cron.job WHERE jobname LIKE 'b2bwave-%' LOOP
    PERFORM cron.unschedule(_job);
    RAISE NOTICE 'desligado: %', _job;
  END LOOP;
END $$;

-- 3. CONFIRMAR que sumiram (tem que voltar sem nenhuma linha `b2bwave-`):
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

**Não desligar** nenhum job que não comece com `b2bwave-` — o ETA de container tem
cron próprio e fica.

## PASSO 2 — Zerar os pedidos (SQL, o dono executa)

**Só depois do passo 1 confirmado.** Esta é a parte irreversível.

*(Bloco a ser escrito quando o passo 1 estiver confirmado — precisa da lista real
de tabelas filhas de `pedidos` para apagar na ordem certa das foreign keys, e de
uma contagem antes/depois como prova.)*

## PASSO 3 — Limpar o código (eu executo)

Só depois dos passos 1 e 2.

### Morre

| o quê | tamanho |
|---|---|
| `supabase/functions/b2bwave-sync/` | **3490 linhas** — a maior do projeto |
| `supabase/functions/api/` | 246 linhas |
| `src/pages/admin/settings/B2BWaveSync.tsx` | tela dedicada ao sync |
| `src/pages/admin/tools/ImportOrders.tsx` | importa pedido |
| `src/pages/admin/tools/BulkUpdateOrders.tsx` | atualiza pedido em lote |
| as rotas dos quatro em `src/App.tsx`, e os links no menu | |

### FICA — verificado arquivo por arquivo

Os outros seis importadores **não chamam o sync**; só o citam em comentário. São
ferramentas de CSV e servem ao catálogo, que fica:

`ImportCustomers`, `ImportCategories`, `ImportAddresses`, `ImportCustomerPrices`,
`ImportProductVariants`, `ImportRelatedProducts`.

Ficam também as edges `send-email`, `notify-dispatch`, `generate-pdf`,
`stripe-checkout`, `register-customer`, `admin-create-user`, `company-member` e
`sync-container-eta`.

### Banco — o que dá para apagar um dia, e o que NUNCA

**PODE ficar para depois** (recomendação: não apagar; coluna sobrando não custa
nada e é o único vestígio de qual registro veio de onde):

`pedidos.b2bwave_order_id`, `produtos.b2bwave_id`, `clientes.b2bwave_id`, e a
tabela `sync_log` — esta sim é órfã, nenhum leitor no código.

---

### ⛔ NÃO APAGUE — duas coisas que PARECEM sobra do sync e não são

Ambas foram criadas pela migration do cron do B2BWave
(`20260618000002_b2bwave_sync_cron.sql`), então quem for limpar por esse arquivo
leva as duas junto sem perceber.

**1. A tabela `sync_state`.** O nome engana. Ela guarda:

| chave | o que é |
|---|---|
| `envio_pausado` | a **TORNEIRA GERAL de notificação** — cala todos os canais de uma vez. É o kill switch criado depois dos 1.508 SMS de 25/ago (`20260825180000_teto_notificacao.sql`) |
| `order_notify_max_age_days` | lido por `send-email/index.ts:1688` **e** `_shared/dispatch.ts` |
| `suppress_order_notify`, `suppress_stock_notify` | silêncio por tipo de evento |
| `order_max_per_hour`, `low_stock_max_per_hour`, `sms_max_per_hour`, `email_max_per_hour`, `auth_max_per_hour` | os **tetos por hora** — o outro freio criado depois do incidente |

São pelo menos **nove chaves**, não duas. `docs/CONSULTA-ESTADO-NOTIFICACAO.sql`
lê todas — rode-o antes de encostar nessa tabela.

Dropar essa tabela **desarma o kill switch em silêncio** — sem erro, sem aviso.
Há um `COMMENT ON TABLE` nela avisando isso (`20260902120000`).

**2. O índice `pedidos_numero_idx`** (linha 34 do mesmo arquivo). É ele que faz o
`count: "exact"` das três checagens de pedido por número
(`notify-dispatch`, `_shared/dispatch.ts`, `send-email`) não virar varredura
completa da tabela. Nasceu na migration do sync, mas serve ao portal.

---

## Estado

- [x] Decisão registrada e perguntas respondidas
- [x] Passo 1 — cron desligado (`cron.job` vazio; havia um quinto job fora da migration, `b2bwave-cron-categories`)
- [x] Passo 2 — pedidos zerados: 0 pedidos, 0 itens, 0 reservado, **70 clientes e 330 produtos intactos**
- [x] Passo 3 — código limpo (commit `55ef241`): tsc limpo, 729/729 testes, build ok, 8 edge functions (13 arquivos)
- [ ] Caçador + cético — em andamento
