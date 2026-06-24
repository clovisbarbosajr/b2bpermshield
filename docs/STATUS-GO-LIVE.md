# PermShield — Status & Go-Live

> Resumo organizado do trabalho da auditoria (jun/2026) e o que falta pro go-live.
> Detalhe técnico completo de cada bug/correção: [`AUDITORIA-SEGURANCA.md`](AUDITORIA-SEGURANCA.md).

---

## 1. O que é

Clone fiel do B2BWave (`zapsupplies.b2bwave.com`) — Vite/React/TS + Supabase.
Produção no **Vercel** (`https://b2bpermshield.vercel.app`). Backend/banco gerido pelo
**Lovable Cloud** (Supabase, projeto `bnicfvxvyblzzatvursw`). Sync **uma via**
B2BWave → app (nunca escreve de volta). B2BWave segue como fonte da verdade até o corte.

## 2. Estado da auditoria — FECHADA ✅

Nenhum bloqueador crítico em aberto. Todas as correções estão no `main` e aplicadas.

| Área | Estado |
|---|---|
| Segurança (RLS, escalonamento, price list, relay de email, PII, toll-fraud) | ✅ |
| Compra do cliente + ownership de pedido | ✅ |
| Preço / subtotal / cupom / **frete / imposto** / total — autoritativos no banco | ✅ |
| Estoque: reserva na compra, baixa no complete, sem oversell, **em tempo real** | ✅ |
| Emails: tempo real, confiáveis (await), totais certos, alerta de falha | ✅ |
| SMS: alerta o admin por email se falhar | ✅ |
| Senhas / reset (Supabase bcrypt, sem texto, sem takeover) | ✅ |

## 3. O que foi aplicado (tudo no ar)

**Migrações** (rodadas no SQL editor, confirmadas por query):
- Privacidade, RLS, consolidação de sub-users, status de pedido, integridade de pedido.
- Preço autoritativo + frete/imposto autoritativos (`fn_pedido_total_appside`).
- Estoque: reserva/baixa/release, guard de sync, recompute no delete, realtime (`produtos`).
- Trava de colunas do cliente, bloqueio de pedido de conta inativa.
- RLS de referência do checkout (pagamento/frete/imposto/cupom p/ cliente logado).
- Hardening: qty>0, grants de preço, cupom anti-grief, `ensure_my_cliente_record`.

**Edge functions** (redeploy concluído): `b2bwave-sync`, `send-email`, `notify-dispatch`,
`stripe-checkout`, `generate-pdf`, `api`.

**Config**: Auth Site URL + Redirect URLs travados em produção; secret
`ALLOWED_REDIRECT_ORIGINS`; senha do admin rotacionada (feita pelo dono, fora do git).

## 4. Como testar (live)

**Pré-requisito p/ ver email/SMS chegando em VOCÊ:** aponte os contatos pra você.
- Admin → Settings: `email_contato` / `email_new_orders` = **seu email**.
- Notificações → destinatário admin: **seu email + seu telefone**.
- Cliente de teste: cadastro/edição com **seu email + seu telefone**.

**Teste de entrega (rápido, sem compra):**
1. Admin → Settings → botão **"Test Email"** → confere se chega no seu inbox.
2. Notificações → **enviar teste de SMS** (se houver) → confere no seu celular.

**Teste de compra (fluxo completo):**
1. Admin (login `jess@zapsupplies.com`): cria um **produto nosso** (estoque ex.: 100).
2. Loga como **cliente** (seu email) → adiciona o produto.
3. Finaliza com **Pay Later**.
4. Confere:
   - Estoque baixa **em tempo real** na tela do admin (Estoque).
   - **Total / frete / imposto** batem com o que o cliente viu.
   - **Email do pedido** chega: ao cliente (você) e ao admin (você).
   - **SMS** chega (se canal SMS habilitado no evento `new_order`).
   - Ao marcar o pedido como **complete**, `estoque_total` baixa de vez.

## 5. Resíduos conhecidos (não bloqueiam — anotados)

- **Frete por zona** (`condicoes` jsonb) não é recomputado no banco — só relevante se
  usar frete por zona **e** reativar o Stripe (fechar via RPC de criação de pedido).
- **Marcador de origem do cliente** (`clientes.b2bwave_id`) — sub-user já protegido; o
  caso restante (cliente top-level com email idêntico a um do B2BWave) é raro.
- **Migrações semente** têm senhas commitadas no histórico — a rotação da senha resolve
  o risco vivo (não reescrever histórico).

## 6. Notas operacionais

- **Login admin:** `jess@zapsupplies.com` (senha rotacionada pelo dono).
- **Modelo de estoque no corte:** produto/pedido criado no clone (`b2bwave_id` /
  `b2bwave_order_id` NULL) **não é tocado pelo sync** — a lógica do clone manda 100%.
  Produtos espelhados do B2BWave têm estoque re-baseado pelo sync a cada ~15 min.
- **Stripe** desligado de propósito (criado, desabilitado). Reativar quando for usar
  cartão — aí fechar o resíduo de frete por zona.
