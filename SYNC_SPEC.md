# SYNC_SPEC — Estado real do sync B2BWave → app e o que falta construir

> Documento de especificação. Descreve **exatamente** o que o sync faz hoje (verificado no
> código) e o que precisa ser construído para o objetivo do dono do projeto:
> **"tudo 100% sincronizado, mesmo que demore ~5 min — não só as ordens".**
> Fonte da verdade: `supabase/functions/b2bwave-sync/index.ts` (836 linhas).

---

## 0. ⚠️ PROBLEMA CONCRETO (ler primeiro — é o sintoma a resolver)

Reportado pelo dono, com a aba do **nosso sistema** aberta (admin):

1. **Pedidos pararam em 28/abril/2026.** Os últimos no nosso sistema são `id 2351, 2352, 2353`
   (28/04). No B2BWave (`zapsupplies.b2bwave.com`) existem pedidos de **maio e junho** que
   **não aparecem** aqui. Hoje é junho — ou seja, ~1,5 mês de pedidos faltando.
   - Causa provável: não há sync automático (depende de clique manual com aba aberta — ver §1B
     e §3.1) **e/ou** o loop de páginas travou silenciosamente no meio. Investigar paginação,
     filtro de data (a função pula pré-2025 — confirmar que não está cortando 2026 errado) e
     erros silenciosos (`orderErrors++; continue`).

2. **Total $0.00 em pedidos importados.** Vários pedidos entram com **Total $0.00** e quantidade
   zerada mesmo tendo valor real no B2BWave. Exemplos confirmados no B2BWave:
   - `2348` = **$2.881,30** (110 un) — aqui aparece $0.00
   - `2347` = **$2.299,13** (51 un)
   - `2353` = **$4.852,10** (264 un) — este veio certo
   - Causa provável: mapeamento de total/itens (`gross_total` / `total_after_vat` / `total` e os
     preços dentro de `order_products`) não está casando os campos certos do B2BWave →
     cair em 0. Ver `sync_orders_page` linhas ~513–563.

**Objetivo final do dono:** tudo que existe no **B2BWave** tem que existir, idêntico e
atualizado, no **nosso sistema** — produtos, preços, clientes e **todos os pedidos**. Inclui
pedido novo, **cancelado/editado** (status muda), **preço editado**, **cliente novo** e
**cliente deletado**. Não importa o intervalo (5 / 15 / 30 min); importa **não parar** e
**não depender de aba aberta**. O sync é temporário: um dia o B2BWave sai do ar e fica só o
nosso sistema — até lá, os dados têm que se manter espelhados sozinhos.

---

## 1. Conceito: são DOIS sistemas diferentes (não confundir)

### A) Notificações (WhatsApp / SMS / Email)
- Disparadas a partir de **eventos do PRÓPRIO app** (frontend), via `notify-dispatch`.
  Ex.: checkout no portal (`src/pages/portal/Checkout.tsx`), mudança de status no admin
  (`OrderDetail.tsx`), cadastro (`Cadastro.tsx`), aprovação de cliente (`CustomerEdit.tsx`).
- **NÃO existe** nenhum poll vigiando o B2BWave. Logo:
  - Pedido feito **no app permshield** → notifica em segundos. ✅
  - Pedido feito **no B2BWave antigo** → **não dispara notificação** (ninguém vigia o B2BWave). ❌
- O "poll de 5 min" que detectava pedidos novos do B2BWave existia no **projeto explorer
  (protótipo)** e **não foi portado** para o permshield.

### B) Sincronização de dados (B2BWave → Supabase)
- Função `b2bwave-sync`. **100% manual**, **mão única** (B2BWave → app).
- Disparada pela tela **Admin → Settings → B2B Wave Sync** (botões "Test Connection",
  "Sync All", "Sync Now" por tipo, e card "Sync All Orders").
- O navegador chama a função; ela puxa de `zapsupplies.b2bwave.com` e grava no Supabase.
- Pedidos vêm de 50 em 50 (histórico 32k+ → sync completo leva 30–60 min **com a aba aberta**).
- **Se ninguém clicar, nada atualiza.** (Causa de "os pedidos pararam em abril".)

---

## 2. O que cada `action` da função faz HOJE (verificado)

| action | Cria novo | Atualiza alterado | Apaga/desativa removido | Observações |
|---|---|---|---|---|
| `sync_products` | ✅ | ✅ upsert por **SKU** (inclui **preço**, estoque, ativo, imagem) | ✅ deleta stale (a menos que referenciado em `pedido_itens`) | linhas 212–309 |
| `sync_customers` | ✅ | ✅ update por **email** se mudou | ❌ **não apaga deletados** | linhas 353–423 |
| `sync_orders_page` / `sync_orders_all` | ✅ só novos | ❌ **pula se já existe** (`if existingNumeros.has(numero) continue`) | ❌ | linhas 426+/589+. **Cancelamento/edição/mudança de status NÃO refletem.** Pula pré-2025. |
| `sync_price_lists` | ✅ | ❌ pula se já existe | ❌ | linhas 312–326. Só cria a tabela; não atualiza nome/ativo |
| `sync_categories` | ✅ | parcial | ❌ | linhas 136+ |
| `sync_brands` | ✅ | parcial | ❌ | linhas 190+ |
| `sync_sales_reps` | ✅ | ✅ | ❌ | linhas 329+ |
| `sync_privacy_groups` | ✅ | ✅ | ❌ | linhas 773+ |
| `sync_company_activities` | ✅ | ✅ | ❌ | linhas 800+ |

Status de pedido: mapeado de `status_order_name` do B2BWave via `statusMap` → enum local.

---

## 3. GAPS vs. o objetivo ("tudo 100% sincronizado, ~5 min ok")

1. **Não há sync automático/agendado.** Não existe pg_cron nem função `sync-poll` no projeto
   (confirmado: `grep -r cron supabase/migrations` = vazio). Tudo depende de clique humano com
   aba aberta.
2. **Pedidos nunca atualizam.** Só insere pedido novo. Pedido **cancelado**, com **status
   alterado** ou **editado** no B2BWave continua igual no app. ❌ (este é o gap mais grave)
3. **Clientes deletados não somem.** O `sync_customers` faz upsert, mas nunca remove/desativa
   quem foi excluído no B2BWave. ❌
4. **Tabelas de preço não atualizam** (só criam na 1ª vez). Preço **de produto** atualiza ✅
   (via upsert por SKU), mas só no clique.

---

## 4. O QUE CONSTRUIR (escopo recomendado)

### 4.1 Sync incremental agendado (server-side, sem aba aberta)
- **pg_cron** (Supabase) chamando `b2bwave-sync` em **modo incremental** a cada **5 min**
  (intervalo a confirmar com o dono).
- Cada ciclo (leve): **clientes + pedidos** incremental.
- **Produtos + preços + tabelas**: ciclo mais pesado, rodar a cada ~30–60 min OU sob demanda
  (a confirmar). Produtos já têm update+delete; falta só agendar.
- Manter a tela manual existente como "forçar agora".
- Segurança: a função roda com header de serviço (ex.: `X-Cron-Secret` / service role),
  sem depender de login admin. **Não** colocar chaves no Git — usar Supabase Edge Function
  Secrets / Lovable Cloud Secrets.

### 4.2 Adicionar UPDATE de pedidos + destravar maio/junho (crítico)
- Em vez de "pula se já existe", fazer **upsert por `numero`**:
  atualizar `status`, `subtotal`, `total`, `quantidade_total`, datas, notas.
- Cancelamento no B2BWave → refletir como status cancelado local (mapear no `statusMap`).
- **Não** apagar pedido fisicamente (preserva histórico e `pedido_itens`). Cancelado = status.
- **Destravar a importação parada em 28/abril (§0.1):** garantir que o loop pagina até o fim
  (todas as páginas de `orders.json`), que erros de um pedido não abortem o lote (logar e
  seguir), e que o filtro "pula pré-2025" não esteja cortando 2026. Rodar um sync completo de
  recuperação para trazer maio+junho.

### 4.2.1 Corrigir Total $0.00 dos pedidos (§0.2)
- Revisar o mapeamento em `sync_orders_page`/`sync_orders_all` (linhas ~513–563):
  `total`/`subtotal` do pedido e `preco_unitario`/`subtotal` dos itens (`order_products`).
- Confirmar quais campos do B2BWave têm o valor real (`gross_total`, `total_after_vat`,
  `total_before_vat`, e nos itens `price`/`final_price`/`total_price`). Hoje muitos caem em 0.
- Validar com casos reais: `2348` deve dar **$2.881,30**, `2347` **$2.299,13**.

### 4.3 Tratar remoção de clientes
- Recomendado: **soft-delete** → marcar `status = 'inativo'` quem sumiu do B2BWave
  (em vez de DELETE físico, que quebraria FKs de pedidos).
- Comparar conjunto de emails do B2BWave vs. local; os que não vierem mais → inativar.

### 4.4 Atualizar tabelas de preço
- `sync_price_lists`: trocar "pula se existe" por update de `nome`/`descricao`/`ativo`.

### 4.5 (Opcional, fecha o ciclo de notificação)
- Com o poll incremental rodando, quando um **pedido novo do B2BWave** for inserido, disparar
  `notify-dispatch` (evento `new_order`) inline — assim pedidos vindos do sistema antigo também
  notificam por WhatsApp/email, igual aos feitos no app. Hoje **não** notificam.

---

## 5. Decisões do dono (JÁ DEFINIDAS)
1. **Intervalo do cron**: ~15 min para incremental leve (pedidos+clientes); ~30–60 min para o
   pesado (produtos+preços). O intervalo exato não importa — importa **não parar** e **não
   depender de aba aberta**.
2. **Escopo por ciclo**: incremental leve frequente (pedidos+clientes) + pesado mais espaçado
   (produtos+preços). Pode rodar tudo junto se for mais simples; só não pode travar.
3. **Cancelamento de pedido**: refletir como status **"cancelado"** — **nunca apagar** o registro.
4. **Cliente removido**: **inativar** (soft-delete, `status = 'inativo'`) — **nunca apagar**.
5. **Prioridade imediata**: destravar maio/junho (§0.1) e corrigir Total $0.00 (§0.2) — são o
   sintoma que o dono está vendo agora.

## 6. Regras de segurança (manter)
- **Nunca** commitar chaves reais nem colá-las no chat. Usar Cloud Secrets / Edge Function Secrets.
- Sync é **mão única** B2BWave → app. Não escrever de volta no B2BWave.
- Não rodar nada em produção sem o dono mandar.

---

## 7. ✅ IMPLEMENTADO (2026-06-18) — pronto pra deploy

**`supabase/functions/b2bwave-sync/index.ts`:**
- **Auth:** agora exige `X-Cron-Secret` (pg_cron) OU admin logado (antes não tinha auth).
- **Pedidos = UPSERT** (não "pula se existe"): cria novos e **atualiza** status/total/subtotal/quantidade/datas dos existentes → reflete **cancelamento, edição e mudança de status**. Nunca apaga (cancelado = status). Só escreve se mudou.
- **Total $0.00 corrigido:** mapeamento robusto (`pickNum` tenta vários campos) **+ fallback pela soma dos itens** (`buildOrderItems` soma todos os order_products, mesmo sem produto local). Vale pra `sync_orders_page`, `sync_orders_all` e `fix_order_prices`. Validar 2348/2347 após rodar.
- **Itens re-sincronizados** quando um pedido muda (delete+insert).
- **Clientes:** soft-delete — quem some do B2BWave vira `status='inativo'` (nunca apaga).
- **Tabelas de preço:** agora atualizam nome/descrição/ativo (antes só criavam).
- **Notificação inline:** pedido NOVO e RECENTE (<2 dias) dispara `notify-dispatch` (`new_order`) — assim pedidos vindos do B2BWave também notificam por WhatsApp/email. Recuperação histórica NÃO notifica (guarda de 2 dias evita spam).
- **`cron_orders` (nova action):** caminha pelas páginas via cursor em `sync_state`, faz upsert, erro de rede não aborta (retoma do cursor), reinicia o ciclo no fim.

**`supabase/migrations/20260618000002_b2bwave_sync_cron.sql`:**
- Tabela `sync_state` (cursor) + índice em `pedidos.numero`.
- `pg_cron` + `pg_net`; 4 jobs lendo segredos do **Vault** (nada no Git):
  `cron_orders` (15 min), `sync_customers` (15 min), `sync_products` (1h), `sync_price_lists` (1h).
- Tela manual continua como "forçar agora".

### PASSOS DE DEPLOY (você / Lovable)
1. **Deploy** da função `b2bwave-sync` + **aplicar** a migration `20260618000002`.
2. No Supabase: habilitar extensões **pg_cron** e **pg_net**; adicionar ao **Vault** os secrets `CRON_SECRET` (mesmo do Edge Function) e `PROJECT_ANON_KEY`.
3. **Recuperação maio/junho + $0.00:** rodar UMA vez **Settings → B2B Wave Sync → "Sync All Orders"** (agora com upsert, traz maio/junho e corrige os $0.00). Opcional: clicar "Fix Order Prices ($0.00)" pros que ficarem.
4. Conferir 2348 = $2.881,30 e 2347 = $2.299,13.
> Não rodei nada em produção (sem credenciais e sem sua autorização) — está tudo no código, pronto.

---

## 8. ✅ CLONE COMPLETO — expansão do sync (2026-06-18) — pronto pra deploy

Objetivo: o app virar um **clone fiel** do B2BWave (sem "dado fake": as datas/preços/endereços que faltavam eram **sincronização incompleta**, não invenção). Campos confirmados na **API oficial** do B2BWave (docs.b2bwave.com), **não chutados**.

**Importante: NENHUMA migration nova.** Todas as colunas de destino **já existiam** no schema (`produtos`, `clientes`, `tabela_preco_itens`, `produto_variantes`) — o sync é que não preenchia. `tabela_preco_itens` já tem `UNIQUE(tabela_preco_id, produto_id)` → upsert idempotente.

**`supabase/functions/b2bwave-sync/index.ts`:**
- **Helper novo `fetchAllPaginated`** — para endpoints que exigem `paginated=1&per_page=500` (ex.: `product_prices`). Guard contra loop infinito (máx. 200 páginas).
- **`sync_products`:**
  - **Preço $0,00 RESOLVIDO** — busca `product_prices.json` (1 registro por produto×tabela, fonte real do preço). `produtos.preco` = preço da **tabela default** do B2BWave (fallback: qualquer tabela > 0 → `p.price` → MSRP).
  - **Preços por tabela** gravados em `tabela_preco_itens` (mapeando pricelist→tabela local por nome, produto por `b2bwave_id`). Upsert idempotente.
  - **`created_at` REAL** do B2BWave (corrige "criado hoje"). Backfill one-shot: detecta data divergente e atualiza.
  - **Variantes/opções** (Size/Color etc.) → `produto_variantes` (de `product.product_variants[]` = `{code, option_values}`). Sync é dona total: apaga e reinsere por produto.
  - **Campos extras do clone:** barcode, código UPC, código de referência, descrição PDF, meta descrição, dimensões (altura/largura/comprimento), qtd. pacote, backorder, promover categoria/destaque, data de disponibilidade.
- **`sync_customers`:**
  - **`created_at` REAL** (corrige ordem da lista) + backfill one-shot.
  - **Endereço de entrega:** endereco, endereco2, cidade, estado, cep, pais.
  - **Extras:** website, company_number, discount (%), minimum_order_value, customer_reference_code, admin_comments, disable_ordering, billing_same_as_contact, is_active.
- **`sync_price_lists`:** agora também sincroniza `is_default` (necessário pra escolher o preço base correto).

**Frontend (ordem das listas = espelho do B2BWave):**
- `src/pages/admin/Clientes.tsx` e `src/pages/admin/Produtos.tsx`: ordenação default mudou de alfabética (`empresa`/`nome`) para **`created_at` desc** (mais recente primeiro), agora que a data real é sincronizada.

### PASSOS DE DEPLOY (você / Lovable) — só a função, sem migration
1. **Deploy** da função `b2bwave-sync` (Lovable aplica ao dar push no `main`). **Não há migration nova.**
2. **Aplicar o clone:** rodar UMA vez **Settings → B2B Wave Sync → "Sync All"** (na ordem: price lists → products → customers). Isso traz preços, datas reais, endereços e variantes. O cron mantém atualizado a partir daí.
3. **Conferir:** produtos com preço correto (não $0,00), "Created" com a data real, Customers/Products na mesma ordem do B2BWave, aba de Options/variantes preenchida, endereço do cliente preenchido.
> Continua **mão única** (B2BWave → app) e **sem rodar em produção** sem sua autorização. Código pronto.
