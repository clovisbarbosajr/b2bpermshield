# VERIFICAÇÃO — Aba por aba (check-off)

Status: ✅ verificado na auditoria · 🔎 revisão profunda pendente (clicar cada botão/aba até o fim) · 🔧 corrigido
Base: menu real (`AdminLayout.tsx`) + portal (`PortalLayout.tsx`).

---

## PORTAL DO CLIENTE
- [x] ✅ Login landing / Customer login / Cadastro / Reset / Pending — Parte 1
- [x] ✅ Dashboard (stat Total Orders 🔧)
- [x] ✅ Catálogo (filtros, busca, grid/list, privacy groups; PDF Catalog 🔧 removido)
- [x] ✅ Produto detalhe (preço por cliente, add to cart, back-order)
- [x] ✅ Carrinho (qtd, save for later, remover, tax)
- [x] ✅ Checkout (preço server-side, estoque, cupom, Stripe, notificações)
- [x] ✅ Pedidos (lista, filtros, re-order, export)
- [x] ✅ Pedido detalhe (EXPORT 🔧 ligado)
- [x] ✅ Conta (perfil, endereços)

## ADMIN — topo
- [x] ✅ Dashboard
- [ ] 🔎 **Orders → OrderDetail** (mudança de status + notificação `order_status`; falta leitura profunda do arquivo)
- [x] ✅ Orders (lista) — Export 🔧 ligado; ~8 filtros que dependem de join ainda inativos (follow-up)
- [x] ✅ Customers (lista)
- [x] ✅ CustomerEdit (10 abas) — Details/Billing/Addresses/Sales Rep/Payment/Shipping/Contacts ✅; Email Settings/Homepage/Admin Fields 🔧 marcadas display-only; endereço inline (follow-up)

### Products (submenu)
- [x] ✅ Products (lista) — filtros Brand/Privacy/Backorder 🔧 ligados
- [x] ✅ ProductEdit (13 abas: Product, Discounts, Customer Prices, Related, Options, Variants, Promotion, Images, Files, Advanced, Price Lists, Status Rules, Access) — timestamps 🔧
- [x] ✅ Price Lists · Options · Brands
- [x] ✅ Import 🔧 (mockup → ponteiro) · Export
- [x] ✅ Product Categories — mostra inativas 🔧

### Tools (submenu) — Parte 5
- [x] ✅ PDF Catalog (órfãos 🔧 removidos) · Import Customer Prices · Import Customers · Import Addresses · Import Product Discounts · Import Product Variants · Import Categories · Import Orders
- [x] ✅ Bulk Update Orders (count 🔧) · Imports Log · Exports Log (Download dup 🔧) — logs `import_logs` 🔧 alinhados

### Conteúdo
- [x] ✅ Banners · News · Pages · Sales Reps

### Reports (13 submenus) — Parte 5
- [x] ✅ Todos REAIS (Order Reps, Customers Perf, Orders/Month, Product Sales, Customer Product Sales, Products by Status, Inventory Control, Sales/Category, Sales/Product, Orders Summary, Customer Activity, Order Summary by Status, Payment Activity)

### Settings (24 submenus) — Parte 6
- [ ] 🔎 **Profile** (sub-abas: General/SEO/Advanced[custom code/cookie]/Integrations) — links mortos 🔧; falta confirmar cada sub-aba salva
- [x] ✅ Setup App · Payment Options (Stripe Connect 🔧) · Shipping Options · Edit Password · Quick Links
- [x] ✅ Product Statuses · Product Status Rules (🔧 honesto) · Privacy Groups · Coupons (confirm 🔧)
- [x] ✅ Sales Tax (confirm 🔧) · Measurement Unit · Company Activities · Users · Warehouse Settings
- [x] ✅ Activity Logs · Email · Email Templates · Notifications · Notifications Log
- [x] ✅ Oauth Applications · Extra Fields · API Keys
- [ ] 🔎 **B2B Wave Sync** — ver seção SYNC abaixo (decisão pendente)

### Warehouse (papel warehouse)
- [x] ✅ Monday popup reminder + Inactivity logout — leem `configuracoes` (warehouse é staff → A2 não quebrou); Warehouse Settings salva (admin)

---

## PENDENTE DE REVISÃO PROFUNDA (próximos)
1. 🔎 `OrderDetail.tsx` (admin) — ler completo, validar status/notificação/itens/totais.
2. 🔎 `Profile.tsx` — confirmar que cada sub-aba persiste (General/SEO/Advanced/Integrations).
3. 🔎 Decisão de **SYNC** (B2B Wave) — ver `BUGS.md` / resposta no chat.

## SEGURANÇA DO CLIENTE (resposta à pergunta: dá pra acessar outro cliente / virar admin?)
- **Ver dados de outro cliente:** ❌ bloqueado. RLS owner-scoped (`auth.uid()`) em clientes/pedidos/itens/enderecos; o vazamento `anon` (0-1) foi corrigido (A1). View-as/impersonação é só front, limitada pelo JWT real.
- **Escalar para admin:** ❌ bloqueado. `user_roles` só admin gerencia (sem self-insert); backdoor `admin-reprovision-user` removido (A3); backdoor demo `Login.tsx` removido (D7).
- ⚠️ Tudo isso só vale **ao vivo depois do deploy** das migrations + remoção da função. Antes do deploy, os buracos continuam abertos em produção.
