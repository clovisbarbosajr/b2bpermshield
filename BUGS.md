# BUGS — Mapa de correção (rastreador)

Documento vivo. Status: ⬜ a fazer · 🔧 em andamento · ✅ feito · ⏭️ manual (fora do código).
Detalhe técnico de cada item nos `REVIEW_PARTE_*.md`. Ordem = severidade.
Última atualização: **2026-06-18**.

---

## ✅ FEITOS (corrigidos no código + `npm run build` ✅)

| ID | Item | Onde |
|----|------|------|
| A1 | Remove leitura `anon` de clientes/pedidos/itens/preços | migration `20260618000000` |
| A2 | `configuracoes` restrito a staff + RPC `get_public_config()` | migration + Checkout/PortalLayout |
| A3 | Remove backdoor `admin-reprovision-user` | função deletada |
| A4 | Stripe cobra `pedidos.total` (não confia no cliente) | `stripe-checkout` |
| A5 | API token deixa de vazar (via A2) | — |
| B1 | XSS confirmado latente (sem injeção no DOM) | — |
| B3 | RLS de sub-login (contatos veem/criam pedidos da empresa) | migration `20260618000001` |
| C1 | `ProductImport` mockup → ponteiro honesto | ProductImport.tsx |
| C2 | `ProductStatusRules` falso → tela honesta | ProductStatusRules.tsx |
| C3 | Abas falsas do CustomerEdit marcadas "display-only" | CustomerEdit.tsx |
| C4 | Filtros Brand/Privacy/Backorder de Produtos funcionam | Produtos.tsx |
| C5 | Export do admin Pedidos ligado | Pedidos.tsx |
| C6 | Export do pedido (portal) ligado | PedidoDetalhe.tsx |
| C7 | Botão PDF Catalog morto removido | Catalogo.tsx |
| C8 | "Stripe Connect" fake → aviso honesto | PaymentOptions.tsx |
| C9 | "Send Test Email" consertado (`type: raw`) | Configuracoes.tsx |
| C10 | Links mortos `href="#"` removidos | Profile.tsx |
| C11 | Botão Download duplicado removido | ExportsLog.tsx |
| D1 | `import_logs` colunas alinhadas (histórico volta) | 7 ferramentas tools/ |
| D2 | Confirmação no delete (Coupons + SalesTax) | Coupons/SalesTax |
| D3 | `BulkUpdateOrders` detecta pedido inexistente | BulkUpdateOrders.tsx |
| D4 | Dashboard "Total Orders" correto | portal/Dashboard.tsx |
| D5 | ProductEdit timestamps reais | ProductEdit.tsx |
| D6 | Categorias mostra inativas | Categorias.tsx |
| D7 | Remove `Login.tsx` (backdoor demo) | App.tsx |
| D8 | Senha mínima 6 → 8 | Cadastro/ResetPassword |

## ⏳ PENDENTES

| ID | Item | Tipo / por quê |
|----|------|----------------|
| A6 | **Rotacionar chaves expostas** (Stripe/SMTP/api_token) | ⏭️ MANUAL (dashboards) — **fazer já** |
| — | Aplicar 2 migrations + redeploy edge functions | ⏭️ DEPLOY (Lovable/Supabase) |
| B2 | Hash de `api_keys`/`oauth client_secret` | follow-up (admin-only, baixo risco) |
| B4 | Privacy groups de produto server-side (RLS/RPC) | follow-up (decisão de arquitetura) |
| B5 | Teste de webhook faz `fetch` arbitrário | follow-up (admin-only) |
| B6 | Permissões configuráveis por papel (escrita) | deferido pelo dono (warehouse+admin; warehouse NÃO deleta pedido ✅ já escondido) |
| D5* | `saveSubData` (ProductEdit) não-transacional | robustez (precisa RPC/transação) |

## ✅ FEITOS — rodada 4 (sync + ajustes)
| ID | Item |
|----|------|
| SYNC | b2bwave-sync: upsert de pedidos, fix Total $0.00 (mapeamento + soma dos itens), soft-delete clientes, update price lists, notify new_order inline, action `cron_orders` + auth X-Cron-Secret |
| SYNC | migration `20260618000002`: `sync_state` + pg_cron (4 jobs via Vault) |
| C12 | PdfCatalog: controles órfãos removidos |
| C3* | CustomerEdit: nota honesta no endereço inline (não salva) |
| UX | B2BWaveSync: contador "Updated" no progresso |
| B6a | OrderDetail: "Delete order" escondido p/ warehouse |

---

## BLOCO A — CRÍTICOS de segurança (bloqueadores) ✅ FEITO (aguarda deploy)
- [x] **A1 / 0-1** ✅ — migration `20260618000000_security_critical_fixes.sql`: `DROP` das policies `Anon can read …` em clientes/pedidos/pedido_itens/tabelas_preco/tabela_preco_itens/produto_precos_cliente/representantes.
- [x] **A2 / 7-2** ✅ — mesma migration: SELECT de `configuracoes` restrito a staff + RPC `get_public_config()`. Portal atualizado (`Checkout.tsx`, `PortalLayout.tsx`) p/ usar a RPC.
- [x] **A3 / 7-1** ✅ — função `supabase/functions/admin-reprovision-user/` deletada.
- [x] **A4 / 7-4 / 2-A** ✅ — `stripe-checkout/index.ts`: `create_payment_intent` agora lê `pedidos.total` pelo `pedido_id` (ignora `amount` do cliente).
- [x] **A5 / 7-3** ✅ — mitigado por A2 (api_token não é mais legível por clientes). Hash de `api_keys` fica como follow-up (B2).
- [ ] **A6** ⏭️ MANUAL — **Rotacionar as chaves expostas** (Stripe secret/webhook, SMTP password, api_token, zapier_password) nos dashboards Stripe/Office365/Lovable Secrets. Não dá pra fazer por código — **fazer antes de confiar que o vazamento foi contido**, pois quem já tinha acesso pode ter copiado.
> Verificação: `npm run build` ✅ passou. Falta **aplicar a migration no Supabase** (deploy via Lovable) + **redeploy das edge functions** + **A6 (rotacionar chaves)**.

## BLOCO B — Segurança média
- [x] **B1 / 6-S6** ✅ — Stored XSS é **latente, não ativo**: `custom_code_*`/`custom_css` só aparecem em `types.ts`; **nenhum** `dangerouslySetInnerHTML`/injeção no DOM. Sem mudança. (Se um dia forem renderizados, sanitizar.)
- [ ] **B2 / 6-S2,6-S3** ⏳ follow-up — `api_keys`/`oauth_applications` são **admin-only** (não vazam p/ cliente); risco é só re-revelar na tela admin. Hash fica como melhoria futura.
- [x] **B3 / 7-5** ✅ — migration `20260618000001_company_contacts_rls.sql`: funções `is_company_contact`/`is_company_buyer` + policies de SELECT/INSERT em clientes/enderecos/pedidos/pedido_itens p/ contatos.
- [ ] **B4 / 2-C** ⬜ — Privacy groups só no front — mover p/ RLS/RPC (follow-up).
- [ ] **B5 / 6-S8** ⬜ — Teste de webhook `fetch` arbitrário (follow-up).
- [ ] **B6 / 7-7** ⬜ — policies p/ `manager`/`warehouse` (follow-up).

## BLOCO C — Telas / botões falsos
- [x] **C1** ✅ — `ProductImport.tsx`: mockup substituído por ponteiro honesto p/ os fluxos reais (Tools/Export).
- [x] **C2** ✅ — `ProductStatusRules.tsx`: removido o botão falso; tela agora explica que regras são por-produto (ProductEdit).
- [x] **C3** ✅ (parcial) — `CustomerEdit.tsx`: abas Email Settings / Homepage Products / Admin Fields agora têm aviso "⚠ display only, não salva". (Edição inline de endereço: nota pendente — minor.)
- [x] **C4** ✅ — `Produtos.tsx`: filtros Brand/Privacy/Backorder agora filtram (carrega `produto_acesso`).
- [x] **C5** ✅ — `admin/Pedidos.tsx`: botão **Export** ligado (CSV). (Filtros que dependem de join — SKU/rep/invoice — ficam como follow-up; bug de fuso no `fromDate`: pendente.)
- [x] **C6** ✅ — `portal/PedidoDetalhe.tsx`: EXPORT ligado (CSV do pedido).
- [x] **C7** ✅ — `portal/Catalogo.tsx`: botão PDF CATALOG morto removido.
- [x] **C8** ✅ — `PaymentOptions.tsx`: aba "Stripe Connect" fake virou aviso honesto direcionando p/ "Advanced (Stripe keys)".
- [x] **C9** ✅ — `Configuracoes.tsx`: "Send Test Email" agora envia `type: "raw"`.
- [x] **C10** ✅ — `Profile.tsx`: links mortos `href="#"` removidos (Quickbooks já estava `disabled`/honesto).
- [x] **C11** ✅ — `ExportsLog.tsx`: botão Download duplicado falso removido.
- [ ] **C12** ⬜ — `PdfCatalog.tsx`: "Select products"/"Customer" órfãos (pendente — minor).

## BLOCO D — Bugs funcionais menores
- [x] **D1 / 5-1** ✅ — 7 ferramentas de import agora gravam `arquivo_nome`/`registros_total`/`registros_sucesso`/`registros_erro` (schema correto) → histórico aparece.
- [x] **D2** ✅ — confirmação no delete: `Coupons` + `SalesTax` (4 deletes).
- [x] **D3** ✅ — `BulkUpdateOrders`: usa `data.length` em vez de `count` nulo p/ detectar pedido inexistente.
- [x] **D4** ✅ — `portal/Dashboard.tsx`: "Total Orders" usa `all.length`.
- [x] **D5** ✅ (parcial) — `ProductEdit`: timestamps "Created/Updated" reais. (`saveSubData` não-transacional: nota pendente — robustez.)
- [x] **D6** ✅ — `Categorias.tsx`: lista agora mostra inativas.
- [x] **D7 / 1-1** ✅ — `Login.tsx` órfão (com backdoor demo) removido + import no App.tsx. (`RecuperarSenha` órfã: deixada, sem link.)
- [x] **D8** ✅ — senha mínima 6 → 8 (`Cadastro`, `ResetPassword`).

---

### Log de execução
- **2026-06-18** — Bloco A (A1-A5) aplicado: migration `20260618000000` + del `admin-reprovision-user` + fix `stripe-checkout` + RPC no portal. `npm run build` ✅.
- **2026-06-18** — Bloco B: B3 migration `20260618000001`; B1 latente (sem ação); B2 follow-up.
- **2026-06-18** — Bloco C: C2,C4,C5,C6,C7,C9,C11 corrigidos. `npm run build` ✅.
- **2026-06-18** — Bloco D: D2(Coupons),D4,D6,D7 corrigidos. `npm run build` ✅.

### PENDÊNCIAS DE DEPLOY (fora do código)
1. Aplicar migrations `20260618000000` e `20260618000001` no Supabase (via Lovable).
2. Redeploy das edge functions (`stripe-checkout` mudou; `admin-reprovision-user` removida).
3. **A6 — ROTACIONAR** Stripe secret/webhook, SMTP password, api_token (estavam expostos).
