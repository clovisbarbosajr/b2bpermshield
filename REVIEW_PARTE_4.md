# REVIEW — Parte 4: Admin — Clientes, Pedidos, Representantes

**Data:** 2026-06-17
**Escopo:** `Clientes`, `CustomerEdit`, `Pedidos` (admin), `OrderDetail`, `Representantes`. Foco: aprovação de cliente, mudança de status, notificações, view-as, dados de clientes.
**Método:** revisão estática (eu li CustomerEdit; subagente varreu Pedidos/Representantes; OrderDetail/Clientes referenciados do HANDOFF + checagens pontuais).

---

## Veredito rápido
O **fluxo crítico de negócio funciona**: aprovar/rejeitar cliente, criar cliente com login, sub-logins (contacts), mudar status de pedido — tudo persiste e **dispara as notificações certas**. Porém o `CustomerEdit` tem **3 abas inteiras falsas** + campos que não salvam, e o admin `Pedidos` repete o padrão de **filtros mortos + Export falso** da Parte 3.

---

## ACHADOS

| # | Severidade | Achado |
|---|-----------|--------|
| 4-1 | 🟠 Médio | `CustomerEdit`: abas **Email Settings**, **Homepage products** e **Admin fields** são placeholders (não salvam nada) |
| 4-2 | 🟠 Médio | `CustomerEdit`: edição inline de endereço não persiste (campos `defaultValue`, sem save) |
| 4-3 | 🟡 Médio | `Pedidos` (admin): ~8 filtros atualizam estado mas **não filtram** a lista |
| 4-4 | 🟡 Médio | `Pedidos` (admin): botão **Export** sem `onClick` |
| 4-5 | 🟡 Baixo | `Pedidos` (admin): carrega TODOS os pedidos+PII sem paginação no servidor (perf/escala) |
| 4-6 | 🟡 Baixo | `CustomerEdit`: input "Specify activity" e seleção em massa de Pedidos sem efeito |
| 4-7 | ⚪ Info | `Representantes`: hard-delete sem checar uso (FK/órfãos) |

---

### 🟠 4-1 — Três abas falsas no `CustomerEdit`
- **Email Settings** (l.584-608): todos os Inputs/Checkbox são estáticos — sem `value`/`onChange`/save. "Email for new order notification", "Bcc", "Receive notifications" etc. **não gravam nada**. A aba inteira é decorativa.
- **Customer homepage products** (l.610-636): tabela fixa "No products configured" + botão "Add a product" (l.632) **sem `onClick`**. Aba morta.
- **Admin fields** (l.689-705): Select "CERTIFIED B2 EXPERT" sem `value`/`onChange`/save. Morto.

Risco: operador configura achando que salvou; nada persiste. Implementar de verdade ou remover as abas.

### 🟠 4-2 — Edição de endereço não salva
Na aba **Addresses** (l.504-535), os campos usam `defaultValue` (não-controlados) e **não há handler de save** para edição. Mudar rua/cidade/CEP de um endereço existente não persiste. Só **Add** (insere endereço em branco, l.537) e **Delete** (l.526) funcionam. O "Add" criar endereço vazio também é UX ruim.

### 🟡 4-3 / 4-4 — `Pedidos` admin: filtros e Export
- `Pedidos.tsx:287` — botão **Export** sem `onClick`.
- Filtros que atualizam estado mas o predicado `filtered` ignora: `containsProductSku`, `category`, `isPaid`, `hasInvoice`, `salesRep`, `submittedBy`, `withBackorderedItems`, `productSku` (~8). UX enganosa. `fromDate` ainda tem bug de fuso (comparação sem normalizar hora; `toDate` está tratado, `fromDate` não).

### 🟡 4-5 — Carga de pedidos sem paginação no servidor
`Pedidos.tsx:69` faz `select("*, clientes(nome,empresa,email,telefone)")` sem `.range()` nem filtro server-side → todo o dataset com PII vai pro browser; filtro/paginação são client-side. Admin-only (RLS admin lê tudo, correto), mas vira problema de performance/escala e payload. Mover filtro/paginação pro servidor.

---

## Confirmado OK (entrega — inclusive o que você pediu sobre notificações)
- **Aprovar cliente** (`CustomerEdit.tsx:849`): update status `ativo`, upsert role `cliente` (libera login no portal), dispara `send-email` tipo **approval** + `notify-dispatch` **account_approved**. ✅
- **Rejeitar cliente** (l.876): update status `rejeitado` + `send-email` **rejection** com `confirm`. ✅
- **Criar cliente** (l.145): invoca edge `admin-create-user` (cria auth user) → insere `clientes` `ativo` → upsert role `cliente` → sincroniza privacy/payment/shipping. ✅
- **Sub-logins (Contacts)** (l.796): cria contato via `admin-create-user`, grava `company_contacts`, dá role `cliente`, envia setup email; toggle ativo, reset senha, delete com `confirm`. ✅
- **Reset senha / one-time link** do cliente pelo admin (l.343/353): `resetPasswordForEmail` / `signInWithOtp` reais. ✅
- **Mudança de status de pedido** dispara `order_status` (confirmado no HANDOFF/OrderDetail). Persiste via update com tratamento de erro. ✅
- **`Representantes`**: CRUD completo (insert/update/delete com confirm). ✅
- Abas **Sales Rep / Payment options / Shipping options / Privacy groups** do CustomerEdit: ligadas a estado e sincronizadas no save. ✅

---

## Levado para a Parte 7 (Backend/RLS)
1. **company_contacts role "manager"** promete "vê todos os pedidos da empresa" (l.790), mas a RLS de `pedidos` usa `clientes.user_id = auth.uid()` e o contato tem uid próprio. Confirmar se há policy que faça o sub-login realmente enxergar os pedidos da empresa — senão é funcionalidade prometida que não entrega (ou, se a policy for ampla demais, leak).
2. `admin-create-user`: valida que o chamador é admin antes de criar usuário? (Parte 7)
3. Confirmar que `manager`/`warehouse` conseguem aprovar/editar cliente (policies de `clientes`/`user_roles` são admin-only → pode travar pra esses papéis).

## Veredito
O coração operacional (aprovação, criação, notificações, status) **funciona e entrega**. O passivo é UI enganosa no `CustomerEdit` (3 abas + endereço que não salvam) e os filtros/Export mortos do `Pedidos`. Nenhum vazamento novo entre clientes aqui (tudo admin-scoped); pendência real de segurança continua sendo a RLS de sub-login (Parte 7) e o achado 0-1.
