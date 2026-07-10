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
| Logo | ✅ (aba Email) | ✅ Etapa 2 — injetada no `send-email` (`new_order_customer`) |
| Order Confirmation Email template | ✅ (aba Email, editor rico) | ✅ Etapa 2 — usado quando setado; HTML fixo continua como fallback se vazio |
| Order PDF Template (aba, textarea HTML) | ✅ (aba Email) | ⚠️ continua só pro botão de imprimir do admin — **não é** o PDF anexado no email (esse é gerado à parte, ver abaixo) |
| PDF real anexado no email do cliente | — (não editável na UI) | ✅ Etapa 2 — `pdf-lib`, mesmos dados do email |
| Email por evento (Templates→Email antigo) | ✅ (aba Email, texto puro) | ✅ só `low_stock` (sem mudança) |

## Etapa 2 — CONCLUÍDA (commit pendente de redeploy no Lovable)

**`supabase/functions/send-email/index.ts`, tipo `new_order_customer`:**
- Se `configuracoes.email_order_template` estiver setado, usa ele (mesma renderização
  `{{variavel}}` do preview do admin) + logo no cabeçalho (`email_logo_url`/`email_logo_position`).
  Vazio → mantém o HTML fixo de sempre (`templateNewOrderCustomer`) como fallback.
- As colunas novas (`email_order_template`/logo) são lidas num **select separado**,
  em `try/catch` — se o PostgREST ainda não tiver recarregado o schema (mesmo bug do
  "Configuration not found" da aba Email), cai no fallback fixo em vez de quebrar o envio.
- **Não** mexi no `new_order_admin` (email do admin) — continua com o HTML fixo de sempre,
  fora de escopo por ora.

**PDF real (`supabase/functions/_shared/pdfGenerator.ts`, novo arquivo):**
- Usa `pdf-lib` (decidido com o dono — sem headless browser no Deno/Supabase Edge
  Functions, então o layout é desenhado item por item, não é HTML convertido).
- Recebe os **mesmos dados** já calculados pro email (número do pedido, itens, subtotal,
  desconto, frete, imposto, total, notas, logo) — não há uma segunda fonte de verdade.
- Anexado via `Resend`/`SendGrid` (base64) e `Office365/SMTP` (Buffer) — os 3 provedores
  do `sendEmailResilient` agora aceitam `attachments`.
- Geração roda em `try/catch` própria: se falhar (ex.: texto com caractere que a fonte
  padrão do PDF não suporta — emoji, por exemplo), o email **ainda sai**, só sem o PDF
  anexado (logado no console da function). PDF é tratado como extra, nunca bloqueia o envio.
- **Limitação conhecida:** a fonte padrão (Helvetica/WinAnsi) cobre português com acentos
  normalmente, mas não emoji nem caracteres fora do Latin-1. Se algum pedido tiver
  emoji em observações/nome, o PDF daquele pedido específico não é anexado (o email
  segue normal). Resolver isso exigiria embutir uma fonte Unicode — não feito nesta rodada.

### ⚠️ AÇÃO NECESSÁRIA — redeploy no Lovable
Só o `git push` **não** publica edge functions (só o frontend via Vercel). Pra essas
mudanças valerem, o dono precisa pedir ao Lovable: **"redeploy da função `send-email`"**
(mesma mecânica do bug original desse caso — não repetir o erro de achar que só o
push já bastou).

## Como testar depois do redeploy
1. Confirma que `email_order_template` está salvo (aba Email) com alguma formatação/logo.
2. Faz um pedido de teste de verdade no portal do cliente.
3. Confere: email chega com o template/logo customizados (não o padrão fixo) E com
   um PDF anexado (`order-<numero>.pdf`) cujos números batem com o pedido.
4. Se `email_order_template` estiver vazio: email deve continuar chegando no padrão de
   sempre (fallback), só sem logo — comportamento esperado, não é regressão.

## Arquivos tocados nesta rodada
- `src/pages/admin/settings/Notificacoes.tsx` (aba Email nova + Templates ajustada + fix do load resiliente)
- `src/pages/admin/settings/EmailTemplates.tsx` (deletado)
- `src/App.tsx` (rota antiga vira redirect)
- `src/components/RichTextEditor.tsx` (novo)
- `src/components/ScrollToTop.tsx` (novo, fix separado de scroll — ver commit anterior)
- `supabase/functions/send-email/index.ts` (usa template/logo customizados + anexa PDF)
- `supabase/functions/_shared/pdfGenerator.ts` (novo — gera o PDF real com `pdf-lib`)
- `supabase/migrations/20260710120000_email_logo_config.sql`
