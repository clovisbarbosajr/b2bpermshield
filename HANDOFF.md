# HANDOFF — Estado completo do projeto (2026-06-17)

Documento de continuidade. **Leia isto primeiro** ao retomar em nova conversa.
Cobre tudo que foi feito hoje, credenciais (onde estão), arquitetura e pendências.

---

## 1. Os DOIS projetos (não confundir)
- **`b2bpermshield` (ESTE repo) = o PRODUTO REAL.** Plataforma B2B completa (admin + portal do cliente + carrinho + Stripe). É aqui que se trabalha.
  - Lovable project: `1942de5e-f270-48c1-9159-c5a7227bd0be` → URL `b2bpermshield.lovable.app`
  - Supabase: `bnicfvxvyblzzatvursw` (https://bnicfvxvyblzzatvursw.supabase.co)
  - Stack: Vite + React + React Router + Supabase. ~85 páginas admin + portal.
- **`b2b-catalog-explorer` = protótipo/experimento** (só visualizador). Onde o sistema de notificações foi validado primeiro. **NÃO é o produto** — ignorar daqui pra frente.

---

## 2. O que foi feito HOJE no permshield (tudo commitado no GitHub `clovisbarbosajr/b2bpermshield`)

### 2.1 Sistema de Notificações (migrado do explorer) — FUNCIONAL ✅
Adiciona SMS + WhatsApp ao que o permshield já tinha (email via SMTP). Multi-canal controlado por admin.

- **Migração** `supabase/migrations/20260617210000_notifications_system.sql`:
  - Tabelas: `notification_channels`, `notification_events`, `notification_recipients`, `notification_log`.
  - RLS usa a função que já existe no permshield: `public.has_role(auth.uid(),'admin')`.
  - Seed: 3 canais (email/sms/whatsapp) + 5 eventos com templates.
- **Edge Functions**:
  - `supabase/functions/notify-dispatch/index.ts` — sender central. Auth: usuário logado dispara EVENTO; só ADMIN (ou header `X-Cron-Secret`) dispara TESTE. `verify_jwt=false` (auth feita dentro).
  - `supabase/functions/_shared/senders.ts` — Resend (email) + Twilio (SMS/WhatsApp).
  - `supabase/functions/_shared/dispatch.ts` — `dispatchEvent()` inline (lê config, renderiza template, envia, loga).
  - `_shared/cors.ts`.
- **UI admin** (as 3 telas + histórico — vindas do explorer, foram aprovadas como "melhores"):
  - `src/pages/admin/settings/Notificacoes.tsx` — abas **Canais / Eventos / Destinatários**.
  - `src/pages/admin/settings/NotificacoesLog.tsx` — **Histórico**.
  - `src/components/PhoneInput.tsx` — seletor +55/+1.
  - Menu: **Admin → Settings → Notifications / Notifications Log** (AdminLayout.tsx).
  - Rotas (App.tsx): `/admin/settings/notifications` e `/admin/settings/notifications-log` (admin-only, wrapper `<A>`).
- **Eventos REAIS ligados** (chama `notify-dispatch` ao lado do `send-email` existente, fire-and-forget):
  - `new_order` → `src/pages/portal/Checkout.tsx` (caminho card + non-card)
  - `order_status` → `src/pages/admin/OrderDetail.tsx` (`handleStatusChange`)
  - `new_customer` → `src/pages/Cadastro.tsx`
  - `account_approved` → `src/pages/admin/CustomerEdit.tsx` (botão Approve)
- **Validado:** teste forçado de Email (Resend → `clovisjunior@live.com`) e WhatsApp (Twilio sandbox → `+15618498555`) **chegaram**. ✅

### 2.2 Config de notificação (SQL já aplicado no Supabase)
```
email enabled, from "INWISE <noreply@inwisepro.com>"
whatsapp enabled, from_number +14155238886 (sandbox Twilio)
sms disabled (sem número Twilio real ainda)
eventos: channels {email,whatsapp}, notify_admin=true, notify_customer=false
destinatário "Teste": email clovisjunior@live.com, whatsapp/phone +15618498555, active
```
> `notify_customer=false` de propósito: enquanto o sistema antigo (B2BWave) estiver vivo, não notificar o cliente em dobro.

### 2.3 Correções de build/deploy
- **3 erros de tipo pré-existentes** que quebravam o build (provável causa do "Vercel parou de funcionar"):
  `EmailTemplates.tsx` (`pedido.desconto` inexistente → cast; `replaceAll` → `split/join`), `Pedidos.tsx` (`status` string → cast).
- **`@import` da fonte** movido pro topo do `src/index.css` (erro `@import must precede` no build).
- **White screen no deploy publicado**: causa = `VITE_SUPABASE_URL` **não injetada** no build de produção → `createClient` quebrava. Lovable corrigiu o env. ⚠️ Conferir a cada publish que o bundle ao vivo contém `bnicfvxvyblzzatvursw.supabase.co` (e muda de hash).

### 2.4 Imagens de login (estavam quebradas)
- `adminportal.jpg`, `customers.jpg`, `login-bg.jpg`, `landing-bg.jpg`, `admin-login-bg.png`, `customer-login-bg.png` estavam **0 bytes**.
- Substituídas por **SVGs premium na marca**: `src/assets/admin-bg.svg` (gradiente navy→roxo + escudo/check), `customer-bg.svg` (navy→teal + ondas), `login-bg.svg`. Imports atualizados em LoginLanding/AdminLogin/CustomerLogin/Login. Os 0-byte foram removidos.

---

## 3. Credenciais e secrets

### Login de teste (resetáveis via Lovable/Supabase)
- **Admin:** `jess@zapsupplies.com` / `Admin@1234` — URL `/admin-login`
- **Cliente:** `cliente.teste@inwisepro.com` / `Cliente@1234` — URL `/login` (= `/customers-login`)
- Roles: tabela `user_roles` (enum `app_role`: admin/cliente), função `has_role`.

### Secrets (já em **Lovable Cloud Secrets** do projeto — NÃO ficam no Git)
`RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `CRON_SECRET` (para forçar teste sem login admin), `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Pré-existentes do permshield: `SMTP_*`, `B2BWAVE_API_KEY`, `B2BWAVE_USERNAME`.
> Os VALORES brutos das chaves estão no chat de hoje e nos Cloud Secrets. Não foram commitados por segurança.

### Forçar uma notificação de teste (sem login admin)
Invocar `notify-dispatch` com header `X-Cron-Secret: <valor do secret CRON_SECRET>` e body:
```json
{"event":"new_order","test":{"channel":"email","to":"clovisjunior@live.com","message":"Teste ✅"}}
```
(trocar `"channel":"whatsapp","to":"+15618498555"` para WhatsApp).

---

## 4. Variáveis disponíveis nos templates de notificação
`{order_id} {status} {total} {date} {items} {customer_name} {customer_company} {customer_email} {customer_phone} {product_name} {quantity}`

---

## 5. PENDÊNCIAS / próximos passos
1. **Re-publicar no Lovable** para os SVGs de fundo + notificações aparecerem ao vivo. O deploy publicado tem ficado **defasado** — confirmar que o bundle muda de hash e que as imagens de fundo carregam (sem ícone de imagem quebrada).
2. **PASSO B — Code review** (próximo combinado): varrer o app procurando **"botões falsos"** (botões/links sem ação real), bugs, telas incompletas, fluxos quebrados. App é grande.
3. Opcionais: ativar SMS (comprar número Twilio); decidir sobre o `b2bwave-sync` existente; cutover do B2BWave; trocar email SMTP→Resend nos fluxos antigos se quiser unificar.

---

## 6. Gatilhos de email PRÉ-EXISTENTES do permshield (para referência no code review)
Função `supabase/functions/send-email` (SMTP/Office365, templates hardcoded). Disparada do frontend (fire-and-forget) em: novo cadastro (Cadastro.tsx), pedido (Checkout.tsx), mudança de status (OrderDetail.tsx), aprovação/rejeição de cliente (CustomerEdit.tsx), reset de senha (ForgotPasswordModal). Tabela de config: `configuracoes` (toggles `email_on_*`, destinatários `email_new_orders`/`email_new_customer`/`bcc_outgoing_emails`).
