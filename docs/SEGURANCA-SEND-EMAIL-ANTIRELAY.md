# Segurança send-email — trava anti-relay (2026-07-20)

## O problema (achado na auditoria)
A `send-email` aceitava o destinatário (`to`/`customerEmail`/`customer.email`)
vindo do **body**, e só exigia admin para `raw/set_password/magic_link/admin_alert`
e `toOverride`. Como a **anon key está no bundle do frontend**, qualquer um podia
chamar a função e mandar email com a **marca e o domínio da empresa** para
qualquer vítima (spam/phishing), inclusive `approval` ("sua conta foi aprovada"),
`waiting_approval`, `new_order_customer`, etc. E `product_available` interpolava
`sku/name` sem `esc()` (injeção de HTML) — já corrigido no commit e64b548.

## A trava (commit deste doc)
Contexto do chamador computado UMA vez: `viaCron`, `viaService` (bearer =
service-role key), `isAdmin` (sessão + role admin), `callerEmail` (email do
usuário logado), `isLoggedIn`.

Dois níveis:
1. **Privilegiados** (`raw/set_password/magic_link/admin_alert`) e `toOverride`
   (Resend com destino arbitrário): só admin/service/cron. (já existia)
2. **Anti-relay** (novo):
   - **customer-facing** (`new_order_customer`, `order_status_change`, `approval`,
     `waiting_approval`, `rejection`, `product_available`): destino = email do
     body. Só passa se admin/service/cron, OU se o destino for o **email do próprio
     chamador** (email de login OU email da ficha em `clientes` do chamador — cobre
     cliente cujo email de cadastro difere do login, sub-usuário, migrado).
   - **admin-facing** (`new_order_admin`, `new_registration_admin`): destino = emails
     do admin da **config** (não do body), então sem risco de relay pra terceiro;
     exige apenas um chamador logado/servidor (evita spam anônimo ao admin).
   - **auth** (`password_reset` etc.) e `force=true`: NUNCA bloqueados.

## Mudança de fluxo necessária (pra NÃO quebrar o cadastro)
No auto-cadastro o cliente **não tem sessão** (não confirmou login). Com a trava,
`waiting_approval` (customer-facing) e `new_registration_admin` (admin-facing)
seriam bloqueados se chamados do frontend. Por isso foram **movidos pro
`register-customer`** (server-side, service-role → passa). `Cadastro.tsx` agora só
chama `register-customer`, que faz tudo: cria a ficha pendente + dispara os 2
emails + o SMS `new_customer`.

## Fluxos legítimos preservados (validados em teste)
- Checkout (cliente logado): `new_order_customer` pro próprio email + `new_order_admin`. ✅
- Admin (OrderDetail/CustomerEdit): status/approval/rejection + Resend (toOverride). ✅
- register-customer (service): waiting_approval + new_registration_admin + new_customer. ✅
- b2bwave-sync (service): new_order_admin. ✅
- password_reset (company-member/register-customer, service). ✅
- View-as (admin impersonando): isAdmin → pula a checagem de destino. ✅

## Ataques bloqueados (validados em teste)
- Anon → new_order_customer/approval pra vítima (relay/phishing). ✅ 403
- Cliente logado → email pra terceiro. ✅ 403
- Anon → spam new_registration_admin no admin. ✅ 403
- Anon → raw/toOverride. ✅ 403

## Teste
15 cenários (9 legítimos + 6 ataques) validados por réplica da lógica da trava —
todos passaram (authgate-test). Bundle + tsc limpos.

## Rollback
Ponto seguro antes desta mudança: commit **e64b548**. Se quebrar algum envio,
`git revert` do commit da trava restaura o comportamento anterior (menos seguro,
mas funcional). Arquivos tocados: `supabase/functions/send-email/index.ts`,
`supabase/functions/register-customer/index.ts`, `src/pages/Cadastro.tsx`.

## Redeploy necessário
`send-email` e `register-customer`.
