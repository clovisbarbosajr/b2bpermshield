# Consolidação de Email — 2026-07-10

## Por quê
Existia uma tela **"Email Templates"** (`/admin/settings/email-templates`) com Logo +
template do email de pedido + template do PDF — mas ela **nunca apareceu no menu**
(já tinha sido tirada numa sessão anterior, ver `MENU_OCULTO.md`: "Email e Email
Templates já tinham sido tirados do menu antes, consolidados em Notifications").
Resultado: o dono não conseguia achar a tela, só por link direto.

Decisão: **mover tudo pra dentro de Notifications** (que já está no menu), numa aba
nova **"Email"**, e apagar a tela solta.

## O que mudou

### Removido
- `src/pages/admin/settings/EmailTemplates.tsx` — deletado.
- Rota `/admin/settings/email-templates` — agora redireciona (`<Navigate>`) pra
  `/admin/settings/notifications` em vez de dar 404 (por segurança, caso alguém
  tenha o link antigo salvo).

### Adicionado — `src/pages/admin/settings/Notificacoes.tsx`, nova aba **Email**
1. **Logo** — upload (bucket `product-images`, mesmo usado por banners/produtos) +
   posição no cabeçalho do email (esquerda/centro/direita). Salvo em
   `configuracoes.email_logo_url` / `email_logo_position`.
2. **Order Confirmation Email (Customer)** — editor rico (negrito, cor, tamanho de
   fonte, caixa alta — componente novo `src/components/RichTextEditor.tsx`) +
   preview usando o pedido mais recente + botão "Edit HTML source" pra quem quiser
   colar HTML puro. Salvo em `configuracoes.email_order_template`.
3. **Order PDF Template** — textarea de HTML (sem editor rico — é layout de PDF,
   não corpo de email) + preview via `generate-pdf`. Salvo em
   `configuracoes.pdf_order_template`.
4. **Per-event email messages (plain text)** — os campos de email por evento que
   antes ficavam na aba **Templates**, MOVIDOS pra cá (não convertidos pro editor
   rico — ver "Achado importante" abaixo).

### Mudado — aba **Templates**
- Campo "Email" removido do card de cada evento (só sobrou SMS/WhatsApp). Nota
  adicionada apontando pra aba Email.

### Migração já aplicada (2026-07-10, rodada pelo dono)
```sql
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS email_logo_url text,
  ADD COLUMN IF NOT EXISTS email_logo_position text NOT NULL DEFAULT 'left'
    CHECK (email_logo_position IN ('left', 'center', 'right'));
```
(`supabase/migrations/20260710120000_email_logo_config.sql`)

## Achado importante durante a consolidação

O texto de email por-evento (aba Templates → campo "Email") é enviado **como
`text` puro pelo Resend** (`_shared/senders.ts` → `sendEmail`, parâmetro `text`,
não `html`). Por isso **não** apliquei o editor rico nesses campos ao movê-los —
HTML de formatação apareceria como tags literais no corpo do email, quebrando a
mensagem.

Além disso, só o evento **`low_stock`** realmente sai por esse caminho hoje. Os
outros 4 (`new_order`, `order_status`, `new_customer`, `account_approved`) tiveram
o canal `email` **removido** na migração `20260619001000_notif_dedup_email.sql` —
o email de verdade desses eventos sai pelo `send-email` (`supabase/functions/send-email/index.ts`),
com HTML **fixo no código** (`templateNewOrderCustomer`, `templateApproval`, etc.),
**sem ler** `configuracoes.email_order_template` nem nada da aba Email. Marquei
esses 4 cards com o badge "not live yet" na UI pra não confundir.

## Estado atual (o que funciona vs. o que não funciona ainda)

| Peça | Existe na UI? | Realmente usada no envio? |
|---|---|---|
| Logo | ✅ (aba Email) | ❌ ainda não — precisa ser injetada no `send-email` |
| Order Confirmation Email template | ✅ (aba Email, editor rico) | ❌ ainda não — `send-email` usa HTML fixo |
| Order PDF Template | ✅ (aba Email) | ⚠️ só pro botão de imprimir do admin (`window.print()`); não gera PDF binário nem anexa em email |
| Email por evento (Templates→Email antigo) | ✅ (aba Email, texto puro) | ✅ só `low_stock` |

## Próximos passos (Etapa 2, ainda não feita)
1. `send-email/index.ts`: no tipo `new_order_customer`, usar
   `configuracoes.email_order_template` (+ logo) quando setado, mantendo o HTML
   fixo como fallback quando vazio.
2. Gerar o PDF de verdade (biblioteca `pdf-lib`, decidido com o dono — sem
   headless browser disponível no Supabase Edge Functions/Deno) usando os
   **mesmos dados** que já alimentam o email (número do pedido, itens, totais
   etc.), e anexar no email de confirmação do cliente via Resend + fallback
   Office365.
3. Testar: pedido real → conferir logo/formatação no email recebido + PDF anexado
   batendo com os dados do pedido.

## Arquivos tocados nesta rodada
- `src/pages/admin/settings/Notificacoes.tsx` (aba Email nova + Templates ajustada)
- `src/pages/admin/settings/EmailTemplates.tsx` (deletado)
- `src/App.tsx` (rota antiga vira redirect)
- `src/components/RichTextEditor.tsx` (novo)
- `src/components/ScrollToTop.tsx` (novo, fix separado de scroll — ver commit anterior)
- `supabase/migrations/20260710120000_email_logo_config.sql`
