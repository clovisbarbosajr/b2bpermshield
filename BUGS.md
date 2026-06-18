# BUGS — Mapa de correção (rastreador)

Documento vivo. Status: ⬜ a fazer · 🔧 em andamento · ✅ feito · ⏭️ manual (fora do código).
Detalhe técnico de cada item nos `REVIEW_PARTE_*.md`. Ordem = severidade.

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
- [ ] **D1 / 5-1** ⬜ — `import_logs`/`export_logs` colunas (pendente — precisa olhar schema).
- [~] **D2** parcial — `Coupons` ✅ (confirmação add); `SalesTax` (4 deletes) ⬜ pendente.
- [ ] **D3** ⬜ — `BulkUpdateOrders` count nulo (pendente).
- [x] **D4** ✅ — `portal/Dashboard.tsx`: "Total Orders" usa `all.length`.
- [ ] **D5** ⬜ — `ProductEdit` timestamps/saveSubData (pendente).
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
