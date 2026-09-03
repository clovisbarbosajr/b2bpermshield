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

**Há quatro cron jobs rodando no banco agora**, chamando a edge `b2bwave-sync`
sozinhos (`migrations/20260618000002_b2bwave_sync_cron.sql`):

| job | frequência | ação |
|---|---|---|
| `b2bwave-cron-orders` | **a cada 15 min** | `cron_orders` |
| `b2bwave-cron-customers` | a cada 15 min, defasado 5 | `sync_customers` |
| `b2bwave-cron-products` | 1x por hora, minuto 10 | `sync_products` |
| `b2bwave-cron-pricelists` | 1x por hora, minuto 20 | `sync_price_lists` |

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

-- 2. Desligar os quatro:
SELECT cron.unschedule('b2bwave-cron-orders');
SELECT cron.unschedule('b2bwave-cron-customers');
SELECT cron.unschedule('b2bwave-cron-products');
SELECT cron.unschedule('b2bwave-cron-pricelists');

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

### Colunas de banco — deixar por último, e provavelmente deixar

`pedidos.b2bwave_order_id`, `produtos.b2bwave_id`, `clientes.b2bwave_id`,
`sync_state` e a tabela de log do sync.

**Recomendação: não apagar agora.** Coluna sobrando não custa nada e é o único
vestígio de qual registro veio de onde. Apagar coluna é irreversível e não traz
benefício. Decidir depois, com o sistema no ar.

---

## Estado

- [x] Decisão registrada e perguntas respondidas
- [ ] Passo 1 — cron desligado *(aguardando o dono)*
- [ ] Passo 2 — pedidos zerados
- [ ] Passo 3 — código limpo
