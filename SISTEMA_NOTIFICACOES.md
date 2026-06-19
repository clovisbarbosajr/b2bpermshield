# Sistema de Notificações & Email — PermShield (documentação completa)

> Última atualização: 2026-06-19. Cobre EMAIL (Resend primário + Office365 fallback),
> SMS (Twilio), WhatsApp (desligado), logs, alertas ao admin e eventos.

---

## 1. Visão geral em uma frase

**EMAIL** é responsabilidade da edge function `send-email` (Resend primário → Office365
fallback, mesmo template/remetente). **SMS** é do `notify-dispatch` (Twilio). **WhatsApp**
está desligado por config. Toda tentativa é registrada em `notification_log` e qualquer
**falha real** avisa o admin por email.

---

## 2. EMAIL — Resend primário, Office365 (SMTP) fallback

### 2.1 Onde está
`supabase/functions/send-email/index.ts`, função **`sendEmailResilient(config, fromEmail, to, subject, html, replyTo, bcc)`**.

### 2.2 Ordem de tentativa (mesmo template, mesmo remetente, automático)
1. **Resend (primário)** — só se houver chave: `RESEND_API_KEY` (env) **ou** `email_api_key`
   da `configuracoes` quando `email_provider='resend'`. Se enviar, retorna `provider:'resend'`.
2. **Office365 / SMTP (fallback)** — se o Resend **falhar** OU não tiver chave. Usa os
   secrets `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` (host default
   `smtp.office365.com:587`). Retorna `provider:'smtp', fallback:true`.
3. **SendGrid** — último recurso, só se `email_provider='sendgrid'` com chave.

> **O remetente NUNCA muda:** usa sempre o `configuracoes.email_from`
> (`PermShield B2B <automated@wiseitsolutions.us>`) e `email_reply_to`
> (`jess@zapsupplies.com`) — definidos na migration `20260408200001_email_smtp_config.sql`.
> O HTML do email é o mesmo, seja Resend ou Office365.

### 2.3 Estado ATUAL (importante)
A config tem `email_provider='smtp'`. Então:
- **Sem `RESEND_API_KEY` setada** → o Resend é pulado e o **email sai direto pelo Office365**
  (exatamente como funcionava antes). **Nada precisa ser configurado de novo** — reaproveita
  os secrets SMTP que já existiam.
- **Quando setar `RESEND_API_KEY`** → o Resend vira primário e o Office365 vira o fallback
  automático. Zero mudança de remetente.

### 2.4 "Não é falha" vs "é falha"
- **Resend SEM chave** = não é falha, é só "não configurado" → Office365 assume **sem alertar**
  o admin (sem barulho). No log aparece `via Office365 (Resend não configurado)`.
- **Resend COM chave que TENTA e ERRA** (offline/limite/billing) = falha real → Office365
  assume **E** o admin é alertado com o erro exato (ver §4).

---

## 3. O LOG (como tudo fica registrado) — tabela `notification_log`

Cada tentativa de envio grava uma linha. **Nada é silencioso.** Colunas:
`event, channel, recipient, status (sent|failed), error, payload (jsonb), created_at`.

Quem grava:
- **`send-email`** (`index.ts`, após `sendEmailResilient`): grava o resultado de cada email.
  - sucesso direto Resend → `status:sent, error:null`.
  - sucesso via fallback → `status:sent, error:"via Office365 (fallback) — Resend falhou: <erro exato>"`.
  - Resend não configurado, Office365 enviou → `status:sent, error:"via Office365 (Resend não configurado)"`.
  - tudo falhou → `status:failed, error:"<erros concatenados>"`.
  - `payload`: `{ provider, fallback, resendError }`.
- **`notify-dispatch`** (`_shared/dispatch.ts`, `logRow`): grava cada SMS/email de evento, e
  também os **SKIPS** (ex.: `error:"skip: cliente sem telefone"`) que antes sumiam sem rastro.

**Onde o admin VÊ:** tela **Settings → Notifications → Log** (`NotificacoesLog.tsx`, lê
`notification_log`). É o histórico persistente de tudo que saiu/falhou.

---

## 4. Como o ADMIN fica sabendo de uma falha (alertas)

Duas fontes, complementares:

### 4.1 Falha de EMAIL pelo Resend (`send-email`)
Quando o Resend **tenta e falha** (mesmo que o Office365 salve o envio), o `send-email`
dispara um **email de alerta ao admin** com:
- o evento/tipo que falhou e o destinatário;
- **o erro EXATO que o Resend retornou** (ex.: `429 rate limit`, `403 billing`, etc.);
- se o Office365 **entregou mesmo assim** (cliente recebeu) ou se **tudo falhou** (não recebeu).

O alerta vai para `configuracoes.email_new_orders` (ou `email_contato`) e é enviado pelo
**próprio `sendEmailResilient`** (Resend→Office365) — ou seja, **chega mesmo com o Resend fora**,
porque cai no Office365. Não entra em loop (o tipo `admin_alert` não re-dispara alerta).
Também é logado como `event:"resend_failure_alert"`.

### 4.2 Falha de SMS/Twilio (`notify-dispatch`)
Quando um envio de SMS **falha de verdade** (ex.: **Twilio sem créditos**, número inválido,
credencial faltando), o `dispatchEvent` (`dispatch.ts`) chama **`alertAdmin`**, que manda um
email ao admin via `send-email` (Resend→Office365) listando o que falhou e o motivo retornado
pelo Twilio. Assim o admin sabe "o SMS do pedido #X não saiu — Twilio: <erro>".

> **Importante (anti-spam):** "cliente sem telefone" **NÃO** dispara alerta (senão spammaria
> a cada pedido) — fica só registrado no log. Só **falha real de provider** (Twilio/Resend com
> erro, canal desligado) gera o email de alerta.

---

## 5. SMS (Twilio) e WhatsApp

- **SMS:** `_shared/senders.ts` → `sendSms` (Twilio, env `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`).
  O número "from" vem do **banco** (`notification_channels.config.from_number` =
  `+18665805796`, toll-free aprovado), **não** de env.
- **Cliente recebe SMS** se tiver telefone preenchido. O Checkout agora **carrega e repassa**
  `clientes.telefone` (antes não carregava → SMS nunca saía). Sem telefone → skip logado.
- **WhatsApp:** canal `enabled=false` (config). O código existe mas fica inerte — nenhuma
  tentativa de envio. Reversível religando o canal em Notifications → Canais.

---

## 6. Dedup — por que o cliente não recebe email DOBRADO

Antes, um pedido disparava email pelo `send-email` **e** pelo `notify-dispatch` → 2 emails.
Agora a divisão é limpa (migration `20260619001000_notif_dedup_email.sql`):
- **EMAIL** = só `send-email` (Resend+Office365, HTML).
- **SMS** = só `notify-dispatch` (Twilio).
- O canal `email` foi removido dos eventos `new_order`, `order_status`, `new_customer`,
  `account_approved` no `notify-dispatch`.

---

## 7. Eventos e gatilhos (o que dispara o quê)

| Evento | Gatilho (frontend) | send-email (EMAIL) | notify-dispatch (SMS) |
|---|---|---|---|
| **Novo pedido** | `Checkout.tsx` (cliente) e `OrderDetail.tsx` (admin cria) | `new_order_customer` (cliente) + `new_order_admin` (admin) | `new_order` (SMS cliente + admin) |
| **Mudança de status** | `OrderDetail.tsx` (admin muda status) | `order_status_change` (cliente) | `order_status` (SMS) |
| **Novo cadastro** | `Cadastro.tsx` (auto-cadastro) | `waiting_approval` (cliente) + `new_registration_admin` (admin) | `new_customer` (SMS admin) |
| **Aprovação** | `CustomerEdit.tsx` (admin aprova) | `approval` (cliente) | `account_approved` (SMS) |
| **Reset de senha** | login / admin / RecuperarSenha / contato | `password_reset` (link recovery) | — |
| **Setup de contato** | `CustomerEdit.tsx` (criar contato) | `password_reset` (define senha) | — |

> Caminho **com cartão** e **sem cartão** no checkout, ambos disparam SMS agora (antes só o
> de cartão). Todos os disparos são fire-and-forget no front, mas o **resultado real** fica no
> `notification_log` + alerta — então a falha NÃO é silenciosa, mesmo o cliente vendo "pedido enviado".

---

## 8. Reset de senha (segurança)

Todos os pontos usam `send-email` tipo `password_reset` (Resend+Office365), **não** o email
nativo do Supabase (que podia não chegar). Fluxo: gera **link recovery temporário** (Supabase
Admin API) → cliente abre `/reset-password` → `updateUser({password})` grava no `auth.users`
(**senha antiga invalidada na hora**) → `signOut` força login limpo com a senha nova.
SMS reset não existe (só email).

---

## 9. Secrets necessários (Supabase → Edge Functions → Secrets)

| Secret | Pra quê | Estado |
|---|---|---|
| `SMTP_HOST` `SMTP_PORT` `SMTP_USERNAME` `SMTP_PASSWORD` | Office365 (email primário hoje / fallback depois) | **já configurados** (funcionavam) |
| `RESEND_API_KEY` | Resend (email primário, opcional) | setar quando quiser Resend na frente |
| `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` | SMS | setar pra SMS funcionar |
| `CRON_SECRET` | autorização de cron/teste | já configurado |

Se algum faltar, **não falha silencioso**: vai pro `notification_log` + alerta ao admin.

---

## 10. Arquivos-chave

- `supabase/functions/send-email/index.ts` — `sendEmailResilient` + log + alerta de falha Resend + tipo `admin_alert`.
- `supabase/functions/_shared/dispatch.ts` — `dispatchEvent` (canais, skips, falhas, `alertAdmin`), `dispatchOne`, `logRow`.
- `supabase/functions/_shared/senders.ts` — `sendEmail` (Resend), `sendSms`/`sendWhatsapp` (Twilio).
- `supabase/functions/notify-dispatch/index.ts` — roteamento (teste admin-only / evento), auth.
- Migrations: `20260408200001` (provider/from), `20260618000004` (sms-only), `20260619001000` (dedup).
- Front: `src/pages/portal/Checkout.tsx`, `src/pages/admin/OrderDetail.tsx`, `src/pages/Cadastro.tsx`, `src/pages/admin/CustomerEdit.tsx`, `src/pages/admin/settings/Notificacoes.tsx` (+ `NotificacoesLog.tsx`).
