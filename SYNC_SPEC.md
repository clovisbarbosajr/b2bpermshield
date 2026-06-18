# SYNC_SPEC — Estado real do sync B2BWave → app e o que falta construir

> Documento de especificação. Descreve **exatamente** o que o sync faz hoje (verificado no
> código) e o que precisa ser construído para o objetivo do dono do projeto:
> **"tudo 100% sincronizado, mesmo que demore ~5 min — não só as ordens".**
> Fonte da verdade: `supabase/functions/b2bwave-sync/index.ts` (836 linhas).

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

### 4.2 Adicionar UPDATE de pedidos (crítico)
- Em vez de "pula se já existe", fazer **upsert por `numero`**:
  atualizar `status`, `subtotal`, `total`, `quantidade_total`, datas, notas.
- Cancelamento no B2BWave → refletir como status cancelado local (mapear no `statusMap`).
- **Não** apagar pedido fisicamente (preserva histórico e `pedido_itens`). Cancelado = status.

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

## 5. Decisões que o dono precisa confirmar antes do build
1. **Intervalo do cron**: 5 min? 15 min?
2. **Escopo por ciclo**: tudo (clientes+produtos+pedidos+preços) todo ciclo, ou
   incremental leve (pedidos+clientes a cada 5 min) + pesado (produtos/preços a cada 30–60 min)?
3. **Cancelamento de pedido**: refletir como status "cancelado" (recomendado) e nunca apagar?
4. **Cliente removido**: inativar (soft-delete, recomendado) ou apagar de verdade?

## 6. Regras de segurança (manter)
- **Nunca** commitar chaves reais nem colá-las no chat. Usar Cloud Secrets / Edge Function Secrets.
- Sync é **mão única** B2BWave → app. Não escrever de volta no B2BWave.
- Não rodar nada em produção sem o dono mandar.
