# REVIEW — Parte 6: Admin — Configurações

**Data:** 2026-06-17
**Escopo:** ~24 telas de `admin/settings/*` + `Configuracoes`, `Dashboard`, `Ferramentas`, `Relatorios`.
**Método:** revisão estática via 3 subagentes (segurança / comércio / diversos+menus).

---

## Veredito rápido
A maioria das telas de settings é **CRUD real** (SetupApp, CompanyActivities, PrivacyGroups, QuickLinks, WarehouseSettings, EmailSettings, EmailTemplates, Configuracoes, Coupons, SalesTax, PaymentOptions, ShippingOptions, MeasurementUnit, ExtraFields, ApiKeys, OauthApplications, UsersManagement, EditPassword, ActivityLogs, B2BWaveSync) e os menus (Dashboard/Relatorios) usam dados reais. **Mas aqui concentram-se as piores questões de SEGURANÇA do app** — quase todas dependem de RLS/edge functions e estão levadas à Parte 7 para verificação final.

---

## 🔴 SEGURANÇA (prioridade)

| # | Severidade | Achado | Depende de |
|---|-----------|--------|-----------|
| 6-S1 | 🔴 Alto (provável Crítico) | `configuracoes` guarda segredos (Stripe secret, SMTP, API token, webhook) e é **legível por `authenticated`** | confirmar colunas + RLS (Parte 7) |
| 6-S2 | 🔴 Alto | `api_keys.key_value` em texto plano, re-revelável; `select("*")` traz o segredo | RLS de `api_keys` |
| 6-S3 | 🔴 Alto | `oauth_applications.client_secret` em texto plano, re-revelável | RLS de `oauth_applications` |
| 6-S4 | 🟠 Alto | `admin-create-user` faz `update_password` p/ `user_id` arbitrário | edge function valida admin? |
| 6-S5 | 🟠 Alto | UsersManagement grava `role`/`permissions` via upsert client-side em `user_roles` | RLS de `user_roles` |
| 6-S6 | 🟠 Médio/Alto | Stored XSS: campos `custom_code_head/body`, `custom_css`, `analytics` salvos p/ injeção em head/body | onde são renderizados |
| 6-S7 | 🟡 Médio | Profile expõe API token / Zapier password (= API token) / webhook header em texto plano no DOM | — |
| 6-S8 | 🟡 Médio | Teste de webhook faz `fetch` p/ URL arbitrária com dados reais de pedidos+clientes | — |

### 6-S1 — `configuracoes` legível por qualquer logado + guarda segredos ⚠️
Na Parte 0 vi a policy `"Authenticated can read configuracoes" FOR SELECT TO authenticated USING (true)`. As telas `Configuracoes`/`EmailSettings`/`Profile` gravam **nessa mesma tabela**: Stripe keys, SMTP host/user/**password**, API token, `webhook_auth_header`, custom code. Se esses segredos estão em colunas de `configuracoes`, **qualquer cliente logado consegue lê-los** via `supabase.from("configuracoes").select("*")`. Potencialmente tão grave quanto o 0-1. **Verificar na Parte 7:** quais colunas de `configuracoes` contêm segredos e se a leitura `authenticated`/`anon` os expõe. Correção: mover segredos para Supabase Secrets/edge functions ou restringir leitura a admin (e nunca enviar secret ao front — só flags/publishable).

### 6-S5 — Privilege escalation (mitigado por RLS, confirmar)
UsersManagement faz `upsert` direto em `user_roles` com `role`/`permissions` arbitrários (`UsersManagement.tsx:142,193`). Na Parte 0, a RLS de `user_roles` só deixa **admin** gerenciar e o usuário só **lê** o próprio papel — então um não-admin **não** consegue se auto-promover. **Provavelmente seguro**, mas a Parte 7 deve reconfirmar que nenhuma migration afrouxou isso e que não há policy de self-insert.

### 6-S2/6-S3 — Segredos de API/OAuth re-reveláveis
`ApiKeys.tsx` e `OauthApplications.tsx` armazenam `key_value`/`client_secret` em texto plano e os reexibem (ícone de olho / modal), contradizendo o aviso "shown only once". Mais grave se a RLS dessas tabelas permitir leitura a não-admin (Parte 7). Correção: hashear no servidor; mostrar só na criação.

---

## 🟡 BOTÕES FALSOS / TELAS QUEBRADAS

| # | Sev | Achado |
|---|-----|--------|
| 6-1 | 🟠 Médio | `ProductStatusRules.tsx` é **tela falsa inteira** — "Add Rule" sem ação, mockup (duplica a aba real dentro de ProductEdit) |
| 6-2 | 🟠 Médio | `PaymentOptions`: "Stripe Connect" é fake — nunca conecta (estado `connected` nunca vira true) |
| 6-3 | 🟡 Baixo | `Profile`: Quickbooks "Install"/"Start" (disabled placeholder), "Add sample text" e "Throttled Customer Logins" são links mortos `href="#"` |
| 6-4 | 🟡 Médio | `Configuracoes`: "Send Test Email" invoca `send-email` **sem o campo `type`** → provavelmente não envia |
| 6-5 | 🟡 Baixo | `EmailTemplates`: "Save Template" faz `return` silencioso em linhas seed `temp-*` (não salva, não avisa) |
| 6-6 | 🟡 Baixo | `ExtraFields`: botão "Back" descarta edições sem aviso |
| 6-7 | 🟡 Baixo | `Coupons` e `SalesTax` (4 deletes): exclusão **sem confirmação** |
| 6-8 | ⚪ Info | `ProductStatuses`: coluna "View order" mostra o ícone errado (rótulo trocado); `PrivacyGroups`: botão "Add" duplicado |

---

## Confirmado OK (entrega)
- **Notificações** (`Notificacoes`/`NotificacoesLog`): construídas e validadas nesta sessão (HANDOFF) — email + WhatsApp chegando.
- CRUD real: SetupApp, CompanyActivities, PrivacyGroups, QuickLinks, WarehouseSettings, EmailSettings (com teste real via `send-email`), EmailTemplates, Coupons, SalesTax, PaymentOptions, ShippingOptions, MeasurementUnit, ExtraFields, MeasurementUnit, ApiKeys, OauthApplications, UsersManagement, EditPassword.
- `ActivityLogs` e `B2BWaveSync`: read/edge reais. **B2BWaveSync é o padrão correto** — credenciais ficam na edge function, nada de segredo no front (contraste com ApiKeys/OAuth/Profile).
- Menus `Dashboard`/`Ferramentas`/`Relatorios`: dados reais, links para rotas reais, sem stats hardcoded.

---

## Levado para a Parte 7 (Backend/RLS) — itens que SÓ se resolvem lá
1. **6-S1**: colunas de `configuracoes` que guardam segredo + RLS `authenticated`/`anon` (potencial crítico).
2. **6-S2/6-S3**: RLS de `api_keys` e `oauth_applications` (leitura por não-admin/anon?).
3. **6-S4**: `admin-create-user` valida que o chamador é admin antes de `create`/`update_password`?
4. **6-S5**: reconfirmar RLS de `user_roles` (sem self-insert/update permissivo).
5. **6-S6**: onde `custom_code_*` é injetado (stored XSS real?).
6. `import_logs`/`export_logs` schema (da Parte 5).

## Veredito
Funcionalmente, settings é majoritariamente real (1 tela falsa: ProductStatusRules; 1 fluxo fake: Stripe Connect; alguns botões/handlers quebrados). **O risco grande está em segurança de segredos** — `configuracoes`/`api_keys`/`oauth_applications` legíveis no front + segredos em texto plano. A Parte 7 decide se isso é "feio porém contido por RLS" ou "segundo vazamento crítico".
