# REVIEW — Parte 2: Portal do Cliente

**Data:** 2026-06-17
**Escopo:** `portal/Dashboard`, `Catalogo`, `ProdutoDetalhe`, `Carrinho`, `Checkout`, `Pedidos`, `PedidoDetalhe`, `Conta`, `CartContext`, `lib/pricing`.
**Foco:** isolamento de dados (cliente A vs B), manipulação de carrinho/preço/checkout, Stripe, notificação de pedido, botões falsos.
**Método:** revisão estática.

---

## Veredito rápido
Boa engenharia no núcleo de comércio: **preço é recalculado no servidor** (`getProductPrice` lê tudo do banco, não confia no cliente), estoque/status/cupom são revalidados no checkout, e o **vazamento de pedido entre clientes logados está bloqueado pela RLS** + checagem de posse. Porém há **2 pontos sérios no fluxo de pagamento** a confirmar na Parte 7, **1 restrição de catálogo que só existe no front**, e **2 botões falsos**.

> Reforço: o vazamento real de "compras de outro cliente" é o achado **0-1** (anon key). Dentro do portal logado (papel `authenticated`), um cliente NÃO acessa pedido de outro — isso está correto aqui.

---

## ACHADOS

| # | Severidade | Achado |
|---|-----------|--------|
| 2-A | 🟠 Alto (a confirmar) | Valor cobrado no Stripe (`amount`) é calculado no cliente e enviado à função |
| 2-B | 🟠 Médio (a confirmar) | Cliente faz `update` em `pedidos` (is_paid/status) — depende da policy de UPDATE |
| 2-C | 🟠 Médio | Restrição de produto por "privacy group" é só client-side (dados vazam na rede) |
| 2-D | 🟡 Baixo | Botão falso: **EXPORT** em `PedidoDetalhe` (sem ação) |
| 2-E | 🟡 Baixo | Botão falso: **PDF CATALOG** em `Catalogo` (sem ação) |
| 2-F | 🟡 Baixo | Dashboard: stat "Total Orders" travado em "5+" (conta errada) |
| 2-G | ⚪ Info | Excluir endereço sem confirmação (UX) |

---

### 🟠 2-A — Integridade do valor cobrado no Stripe (confirmar na Parte 7)
`Checkout.tsx:422-430` cria o PaymentIntent passando `amount: recalcGrossTotal` **calculado no cliente**:
```ts
await supabase.functions.invoke("stripe-checkout", {
  body: { action: "create_payment_intent", amount: Math.round(recalcGrossTotal*100)/100, ... pedido_id: pedido.id }
});
```
Se a função `stripe-checkout` **confiar no `amount` do cliente** em vez de reler `pedidos.total` do banco pelo `pedido_id`, um cliente pode pagar **$0,01** por um pedido de $1.000 (o pedido é gravado com o total correto, mas a cobrança usa o valor adulterado). **Ação:** verificar em `supabase/functions/stripe-checkout` se o valor é recomputado server-side a partir do `pedido_id`. Se não for → **Alto/Crítico**.

### 🟠 2-B — Cliente atualiza `pedidos` (is_paid / status)
`Checkout.tsx` faz, como o próprio cliente:
- `update({ is_paid:true, payment_intent_id })` após sucesso (l.456-459)
- `update({ status:"cancelado" })` em falha (l.436, 449)

A migration fundadora só dá ao cliente policies de **SELECT** e **INSERT** em `pedidos` (UPDATE é admin-only). Dois cenários, ambos ruins:
- **Se NÃO há policy de UPDATE p/ cliente:** o `update is_paid` falha silenciosamente → pedidos pagos no cartão **nunca ficam marcados como pagos** (bug funcional real; entrega quebrada).
- **Se há policy de UPDATE permissiva:** o cliente pode marcar **qualquer pedido seu como `is_paid=true` sem pagar**, ou mexer no status. → falha de integridade.
**Ação:** conferir policies de UPDATE de `pedidos` na Parte 7. O correto é o `stripe-checkout` (service_role) marcar `is_paid` via webhook/confirmação server-side, não o cliente.

### 🟠 2-C — "Privacy groups" filtrados só no front
`Catalogo.tsx:64-108` busca **todos** os produtos ativos (`produtos` é legível por `authenticated`/`anon`) e filtra por grupo de privacidade **em JavaScript**. Logo, produtos que deveriam ficar ocultos para um cliente **ainda chegam ao navegador** (nome, SKU, preço calculado) — basta olhar a resposta de rede. A restrição é cosmética. **Ação:** se privacy groups protegem SKUs/preços sensíveis por cliente, aplicar a filtragem via RLS/RPC server-side. Relacionado ao achado 0-1.

### 🟡 2-D / 2-E — Botões falsos (o que você pediu pra caçar)
- `PedidoDetalhe.tsx:132` — `<Button>EXPORT</Button>` com ícone de download e **sem `onClick`**. Não faz nada. (Em `Pedidos.tsx` o EXPORT é real, com `handleExport`.)
- `Catalogo.tsx:291` — `<Button>PDF CATALOG</Button>` **sem `onClick`**. Não faz nada. (Existe a página `tools/PdfCatalog` no admin; aqui no portal o botão está solto.)

### 🟡 2-F — Stat "Total Orders" errado
`Dashboard.tsx:92` usa `recentOrders` (fatiado em 5) para o número de pedidos → sempre mostra no máximo "5+". O array completo `all` está disponível; deveria usar `all.length`.

### ⚪ 2-G — Excluir endereço sem confirmação
`Conta.tsx:93` deleta o endereço direto no clique do ícone de lixeira, sem diálogo de confirmação. UX/risco de clique acidental.

---

## Confirmado OK (entrega / seguro)
- **Manipulação de preço bloqueada:** `lib/pricing.getProductPrice` resolve o preço lendo `produto_precos_cliente` → `tabela_preco_itens` → `produto_descontos` → `produtos.preco`, tudo do banco, recebendo só `(productId, customerId, quantity)`. O `Checkout` recalcula com isso antes de gravar (`Checkout.tsx:347`). Preço adulterado no localStorage é ignorado. ✅
- **IDOR de pedido (cliente logado):** `PedidoDetalhe.tsx:55` valida posse (`p.cliente_id === clienteData.id`) **e** a RLS `authenticated` escopa por dono. Pedido de outro cliente → "Order not found". ✅
- **Estoque/status/cupom revalidados no checkout** (server-side, l.309-344, 356). ✅
- **Carrinho isolado por usuário** no localStorage; limpo no logout (`CartContext`). ✅
- **Notificações de pedido disparam:** `new_order_customer`/`new_order_admin` (send-email) + `notify-dispatch` `new_order` no checkout (card e não-card). ✅
- Catálogo/Carrinho/Conta/Dashboard: demais botões todos ligados a ações reais.

---

## Levado para a Parte 7 (Backend/RLS)
1. **2-A** — `stripe-checkout` recomputa o valor a partir do `pedido_id`? (integridade de cobrança)
2. **2-B** — policies de UPDATE em `pedidos` para o papel cliente (is_paid/status).
3. **company_contacts (sub-login):** Conta/Pedidos/Dashboard usam `impersonatedCustomer` no front, mas a RLS usa `clientes.user_id = auth.uid()`. Um contato (uid próprio ≠ dono) **consegue** ver/editar os pedidos e o perfil da empresa? Há policy específica p/ contatos? (pode ser leak OU funcionalidade quebrada).
4. **2-C** — viabilidade de mover privacy groups para RLS/RPC.

## Veredito
Núcleo de e-commerce **bem protegido** contra as fraudes clássicas (preço, IDOR logado). Os riscos abertos são **pagamento** (2-A/2-B — confirmar na Parte 7) e **exposição de catálogo restrito** (2-C). Botões falsos: 2 (EXPORT em PedidoDetalhe, PDF CATALOG no Catalogo).
