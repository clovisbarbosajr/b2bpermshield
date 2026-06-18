# REVIEW — Parte 7: Backend / Edge Functions & RLS

**Data:** 2026-06-17
**Escopo:** RLS de todas as tabelas sensíveis + 8 edge functions (`admin-create-user`, `admin-reprovision-user`, `stripe-checkout`, `notify-dispatch`, `generate-pdf`, `api`, `b2bwave-sync`, `send-email`).
**Método:** revisão estática de migrations + funções.

---

## Veredito rápido
Aqui se resolvem todas as dúvidas das partes anteriores — e o resultado é **grave**. Além do 0-1, há **mais 2 falhas CRÍTICAS** (segredos em `configuracoes` legíveis por qualquer logado; edge function que cria admin sem auth) e **1 ALTA** (Stripe confia no valor do cliente). Em compensação, partes do backend estão corretas (`admin-create-user` valida admin; webhook do Stripe; `has_role`).

---

## 🔴 ACHADOS CRÍTICOS

### 7-1 🔴 CRÍTICO — `admin-reprovision-user`: cria conta ADMIN sem nenhuma autorização
`supabase/functions/admin-reprovision-user/index.ts` — **não há checagem de quem chama**. Usa service role e:
- cria um auth user com email/senha do body (`email_confirm:true`);
- faz `user_roles.upsert({ role: "admin" })` (l.84-86) → **a conta nasce admin**;
- com `existing_user_id`, **deleta** roles/profiles/auth de um usuário arbitrário (l.48-71).

**Não está em `config.toml`** (não desabilita `verify_jwt`), mas como a **anon key** (pública, embutida no bundle) é um JWT válido, a função é invocável por qualquer um. E **não é referenciada em lugar nenhum do frontend** → é código morto **e** um backdoor de criação de admin / exclusão de usuários exposto na internet. **Correção: deletar a função imediatamente.**

### 7-2 🔴 CRÍTICO — Segredos em `configuracoes` legíveis por qualquer usuário logado
Policy (Parte 0/6): `"Authenticated can read configuracoes" FOR SELECT TO authenticated USING (true)`. A tabela contém:
- `stripe_secret_key` (migration `…0408000002`), `stripe_webhook_secret`
- `smtp_password` (migration `…0408232822`)
- `api_token`, `zapier_password`, `webhook_auth_header`
Qualquer cliente logado roda `supabase.from("configuracoes").select("*")` e leva a **chave secreta do Stripe, a senha SMTP e o token da API**. Account takeover de pagamento + email. **Correção:** tirar segredos de `configuracoes` (mover p/ Supabase Secrets/edge) OU restringir SELECT a admin e expor ao front só flags/`publishable_key`. Trocar todas as chaves expostas.

### 7-3 🔴 Crítico (encadeado) — API pública aberta a qualquer logado
`supabase/functions/api/index.ts` autentica via `x-api-token` comparado a **`configuracoes.api_token`** (l.27-28) e opera com **service role** (acesso total a products/customers/orders). Como `api_token` vaza pelo 7-2, qualquer cliente logado obtém o token e usa a API inteira. (Obs.: a tela `ApiKeys` gerencia outra tabela `api_keys` que esta função **nem usa** — o gerenciamento de chaves é decorativo aqui.)

---

## 🟠 ALTOS

### 7-4 🟠 Alto — `stripe-checkout` confia no valor enviado pelo cliente (2-A confirmado)
`stripe-checkout/index.ts:113,123`: `create_payment_intent` usa `amount` **do body do cliente** (`Math.round(amount*100)`), **sem reler `pedidos.total` pelo `pedido_id`**. Um cliente pode invocar com `amount: 0.01` e pagar centavos por um pedido de milhares; o webhook marca `is_paid=true` na confirmação. **Correção:** no servidor, buscar o pedido por `pedido_id` e calcular o valor a partir dele (ignorar `amount` do cliente).

---

## ✅ Backend que está CORRETO
- **`admin-create-user`**: valida o chamador (pega user do JWT, confere `user_roles` admin via service role; senão 403). `create`/`update_password`/`list_staff` **só por admin**. ✅ (Resolve 6-S4/6-S5 como seguros.)
- **RLS de `user_roles`**: só admin gerencia; usuário lê o próprio papel. **Sem self-promoção** via upsert client-side (a tela UsersManagement só funciona porque o operador já é admin). ✅ (A escalada real é o 7-1, não a tela.)
- **Webhook do Stripe** (`stripe-checkout` com `stripe-signature`): valida assinatura com `stripe_webhook_secret` e marca `is_paid`/`cancelado` server-side por `pedido_id` (`.eq("is_paid", false)`). Padrão correto. ✅ → o `update is_paid` client-side do Checkout (achado 2-B) é apenas dead code que a RLS bloqueia silenciosamente (sem dano, pois o webhook cobre).
- **`notify-dispatch`** (verify_jwt=false): valida internamente — evento exige usuário logado; teste com destino arbitrário exige admin ou `X-Cron-Secret`. ✅
- **`b2bwave-sync`**: credenciais ficam só na função (não vazam ao front). ✅
- **RLS central** (`clientes`/`pedidos`/`pedido_itens`/`enderecos`): owner-scoped para `authenticated` (o vazamento é só via `anon` — achado 0-1). `api_keys`/`oauth_applications`: SELECT só admin (`has_role(admin)`) → **não** vazam para clientes (o problema desses é re-revelar segredo na tela admin, menor).

---

## 🟡 MÉDIOS / outros

### 7-5 🟡 Médio (funcional) — Sub-login (company_contacts) quebrado pela RLS
`company_contacts` só tem 2 policies: admin gerencia + "Contacts read own" (`user_id = auth.uid()`). **Não existe** policy dando ao contato acesso a `pedidos`/`clientes` da empresa. Como `pedidos` exige `clientes.user_id = auth.uid()` e o contato tem uid próprio (≠ dono), o sub-login **não lê os pedidos da empresa nem consegue inserir pedido** (INSERT também é owner-scoped). Ou seja, todo o recurso de contatos (buyer/viewer/manager) **não funciona** server-side — apesar do fluxo de UI na CustomerEdit. Fail-closed (sem leak), mas é funcionalidade que não entrega. Resolver com policies que reconheçam `company_contacts` (ex.: `EXISTS (select 1 from company_contacts where user_id = auth.uid() and cliente_id = pedidos.cliente_id)`).

### 7-6 🟡 Médio — `generate-pdf` público (verify_jwt=false)
A função é pública. Precisa confirmar se valida posse/autorização antes de montar o PDF de um pedido por id; se não, qualquer um gera o PDF de qualquer pedido (vazamento — já subsumido pelo 0-1, mas independente dele se 0-1 for corrigido). **Verificar o handler de request** (li só o template). Adicionar checagem de auth/posse.

### 7-7 🟡 Médio — `manager`/`warehouse` vs policies só-admin
A maioria das policies de escrita usa `has_role(admin)`. `manager`/`warehouse` entram nas telas via guard `<S>`/`<AW>` mas o banco bloqueia escrita → "salvar que não salva" para esses papéis (fail-closed). Revisar quais tabelas precisam de policy para staff não-admin.

---

## Veredito da Parte 7
O backend tem **bons fundamentos** (has_role, admin-create-user, webhook Stripe, RLS owner-scoped) mas **3 buracos graves**: secrets em `configuracoes` abertos a clientes (7-2), backdoor de admin (7-1) e cobrança confiando no cliente (7-4) — além da API aberta por tabela (7-3) e do sub-login quebrado (7-5). Junto do 0-1, são **3 CRÍTICOS** que precisam ser corrigidos antes de qualquer publicação real.
