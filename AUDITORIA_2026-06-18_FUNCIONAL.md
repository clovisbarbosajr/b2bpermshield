# Auditoria Funcional + Segurança — PermShield (2026-06-18)

Auditoria profunda de **funcionalidade real vs. tela falsa**, segurança (RLS/permissões),
carrinho, inventário e ciclo de pedidos. Feita por 3 subagentes de leitura de código +
verificação manual dos pontos críticos + confirmação visual no app rodando (preview Lovable).

> **Pergunta central do dono:** "é só frontend ou funciona de verdade?"
> **Resposta:** A espinha dorsal é **REAL e persiste no Supabase**. Existem fakes pontuais
> e 2 buracos de segurança reais (1 já corrigido). Detalhes abaixo.

---

## 0. Status de deploy desta sessão (commits no `main`)

| Commit | O quê | Estado |
|---|---|---|
| `e07d187` | **Clone do sync** — preços por tabela ($0,00), datas reais, endereços, variantes | no ar |
| `efaf8ba` | **Fix segurança** — PII de `enderecos`/`cliente_privacy_groups` aberta a `anon` → fechada | no ar |
| `c4fb2d7` | **Fix 404 Vercel** — `vercel.json` com SPA rewrites | no ar |

---

## 1. SEGURANÇA (RLS + papéis)

### 1.1 🔴 CORRIGIDO — PII de endereços aberta ao público (`anon`)
- **Era:** as policies `anon` (SELECT/INSERT/UPDATE/DELETE) em `enderecos` e
  `cliente_privacy_groups` (criadas em `20260320142326`, modo demo) **nunca foram revogadas**.
  As correções de ontem (`20260618000000`/`193846`) fecharam clientes/pedidos/etc. mas
  **esqueceram essas duas**. Como a chave anon vai no browser, qualquer não-autenticado
  podia **ler, editar e apagar endereço de TODOS os clientes** (cross-tenant total).
- **Fix:** migration `20260618233000_fix_anon_enderecos_privacy.sql` (commit `efaf8ba`) —
  dropa as 8 policies anon + adiciona leitura do próprio cliente em `cliente_privacy_groups`
  (necessária pro filtro do catálogo). Acesso admin/dono/contato permanece intacto.
  Verificado: nenhum fluxo de cadastro escreve nessas tabelas como anon → não quebra signup.

### 1.2 🟠 PENDENTE — `warehouse`/`manager` leem segredos
- `configuracoes` guarda `stripe_secret_key`, `stripe_webhook_secret`, `smtp_password`,
  `email_api_key`, `api_token`. A policy "Staff read configuracoes" inclui
  `warehouse` e `manager` → esses papéis dão `SELECT *` e **leem os segredos**.
- No RLS, warehouse está até *sub*-privilegiado pro resto (não vê pedidos/produtos/clientes),
  mas os segredos vazam. **É o "warehouse com acesso a mais do que precisa".**
- **Fix proposto:** mover segredos pro Vault (já existe `_vault_upsert_secret`) **ou** restringir
  o SELECT de `configuracoes` a admin e usar `get_public_config()` (já existe) pro resto;
  trocar as chaves expostas. *(A confirmar abordagem antes de mexer — pode afetar telas de staff.)*

### 1.3 🟡 Menor — preços públicos
- `variante_precos` e `produto_descontos` continuam legíveis por `anon` → vaza preço de
  tabela publicamente. Só importa se preço deve ser restrito a login.

### 1.4 ✅ O que está SEGURO (verificado)
- **Cliente↔cliente:** `clientes`/`pedidos`/`pedido_itens`/`produto_precos_cliente` têm RLS
  owner-scoped correto (`auth.uid() = user_id` / join por `cliente_id`). Cliente A não vê
  dados de B. INSERT de pedido revalida posse (WITH CHECK) → `cliente_id` forjado é rejeitado.
- **Escalonamento p/ admin:** impossível via API. `user_roles` só dá SELECT da própria linha;
  escrita exige `has_role(admin)`. `has_role` é SECURITY DEFINER com search_path fixo.
- **Sub-logins (`company_contacts`):** corretamente scoped — contato só vê a empresa dele
  (buyer/manager inserem pedido; viewer não).
- **Warehouse:** no RLS não vê pedidos/produtos/clientes (só logs/config).

---

## 2. FUNCIONAL — Real vs. Fake

### 2.1 ✅ REAL e persistindo no Supabase
- **Clientes:** criar (cria login auth via edge `admin-create-user` + registro + role),
  editar, deletar, ativar/desativar, aprovar/rejeitar. Contatos da empresa.
- **Pedidos (admin):** editar pedido existente, mudar status (lista e detalhe),
  add/remover item (recalc subtotal), deletar pedido (só admin), invoice PDF (edge).
- **Portal do cliente:** histórico scoped ao login dele, detalhe valida posse,
  **checkout grava `pedidos`+`pedido_itens`** com revalidação de estoque, preço server-aware,
  cupom e fluxo Stripe real. Perfil/endereços (CRUD). Reorder. Export CSV.
- **Notificações:** edges `send-email` (SMTP/nodemailer) e `notify-dispatch`
  (Email/Resend + SMS/Twilio + WhatsApp) reais; gatilhos plugados em cadastro,
  aprovação, novo pedido, mudança de status.

### 2.2 🔴 FAKE (parece funcionar, não faz nada)
1. **Admin "Create Order" (`/admin/orders/new`)** — **confirmado visualmente.** Abre form de
   pedido com tudo vazio ("Order # –"), sem nem seletor de cliente. No código, `isNew` faz
   `loadOrder()` retornar sem insert, e todo handler tem `if (!order) return`. **Nada salva.**
   Botões em `Pedidos.tsx:302` e `CustomerEdit.tsx:905`. **Maior fake funcional.**
2. **"Invite Customers by Email"** (`Clientes.tsx`) — na verdade é `resetPasswordForEmail`,
   só funciona p/ email já existente. Label engana.
3. **Abas display-only do `CustomerEdit`** (admitido no próprio código): Email Settings,
   Customer homepage products, Admin fields, **editar endereço existente (read-only)**,
   Billing, campo "Specify activity".
4. **Checkboxes de seleção em massa** nos Pedidos — sem ação conectada.
5. **"Files"/"Messages"** no detalhe do pedido — "coming soon".

### 2.3 🟠 BUGS observados ao vivo
- **Pedido 2547 com Total $0.00** — ✅ **INVESTIGADO: NÃO é bug nosso.** Verificado direto no
  B2BWave (`/orders/2547/edit`): o pedido é **genuinamente $0.00 na origem** — todas as 11
  linhas $0,00, Gross total $0,00. São produtos com **variante** (Lite/One Plus/Black Box,
  pisos com cor) **sem preço na tabela "Wholesale Price"** do cliente no próprio B2BWave.
  Nosso sync copiou fielmente. **Ação:** corrigir o preço no B2BWave (o sync pega depois).
  **Verificado (correção):** o B2BWave **não tem preço por variante** — não há endpoint de
  variant-price na API, e `product_variants` só traz `code` + `option_values` (sem preço). A
  **variante herda o preço do PRODUTO**. Então NÃO há `variante_precos` pra sincronizar; o
  preço por tabela já é coberto pelo sync `product_prices → tabela_preco_itens` (commit
  `e07d187`). O $0 desses itens é puramente **produto sem preço na tabela "Wholesale" no
  B2BWave** (dado upstream). `variante_precos` (tabela local) não faz parte do clone via API.
- **Gráfico "Total per month" do dashboard vazio** (sem barras). → a verificar.
- **Vercel 404** em rotas client-side → **corrigido** (`c4fb2d7`).

---

## 3. CARRINHO

- **Onde mora:** React Context + `localStorage` por usuário (`b2b_cart_<uid>`).
  Sem tabela no Supabase. (`src/contexts/CartContext.tsx`)
- **Persistência:** ✅ FUNCIONA em navegação SPA, F5 e re-login do mesmo usuário
  (sair do carrinho e voltar mantém — ponto que o dono pediu atenção: **está OK**).
- ⚠️ **"Saved for later" vaza entre usuários** no mesmo browser — usa chave global
  `cart_saved_for_later` sem userId. Em PC compartilhado, usuário B vê os salvos do A.
  (`src/pages/portal/Carrinho.tsx`) → **item da sequência #4.**
- Não é cross-device (é localStorage do browser).

---

## 4. INVENTÁRIO

- **Reserva:** trigger `AFTER INSERT ON pedido_itens` soma `estoque_reservado` no submit do
  pedido (o "disponível" cai na hora). (`20260413154137`)
- **Baixa real (`estoque_total`):** só quando o pedido vira `status='concluido'`
  (ação do admin). Cancelamento devolve a reserva.
- ⚠️ **Risco de OVERSELL:** validação de estoque é TOCTOU client-side (lê estoque, checa em JS,
  depois insere — sem trava). O trigger de reserva NÃO valida (soma cego, deixa "disponível"
  negativo). Sem `SELECT ... FOR UPDATE`/transação. Dois clientes no último item furam.
  → **item da sequência #2.**

---

## 5. LIMITAÇÃO DE TESTE AO VIVO (importante)

Teste **interativo** automatizado pelo assistente **não é viável neste app**: o PermShield
mantém conexão viva com o Supabase (realtime/sessão), então o robô do Chrome nunca detecta a
página como "pronta" e trava após a 1ª foto. Vale pra preview, publicada e Vercel. Só dá pra
tirar fotos pontuais (navegar + 1 screenshot). **Teste ao vivo confiável = o dono clicando**,
com o assistente guiando e lendo o resultado. A verificação de funcionalidade foi feita por
**leitura de código** (confiável) + confirmações visuais pontuais.

---

## 6. SEQUÊNCIA DE CORREÇÃO

1. ✅ **Pedido $0.00** (2547) — INVESTIGADO: **não é bug** (é $0 na origem, B2BWave).
   Ver 2.3. Expôs o clone gap de `variante_precos` (#7 abaixo).
2. ✅ **Create Order do admin** — agora cria de verdade (commit `67beed8`). Seletor de
   cliente + produtos com preço da tabela do cliente + insere pedido/itens.
3. ✅ **Oversell** — reserva atômica no trigger, gated fail-safe (commit `eb141ba`).
   Sync/admin/backorder/pré-venda não bloqueiam. **Testar um produto de pré-venda.**
4. ✅ **"Saved for later"** isolado por usuário (commit `6ee4be8`).
5. ⏸️ **Warehouse/segredos** — ADIADO pelo dono. Cuidado: componentes de warehouse
   (MondayPopup, InactivityLogout, WarehouseSettings) leem `configuracoes` direto, então
   restringir a admin quebraria warehouse. Fix futuro: VIEW sem colunas secretas, ou Vault.
6. ✅ **Dashboard chart** — INVESTIGADO: **não é bug.** O código do gráfico está correto
   (linhas com cor/eixos ok). A observação de "vazio" veio de um screenshot **cortado** no
   topo do gráfico (só apareceram os eixos). Sem ação.
7. ✅ **`variante_precos`** — INVESTIGADO: **não é lacuna sincronizável.** B2BWave não expõe
   preço por variante (variante herda preço do produto); `product_prices` já cobre. Ver 2.3.

> **A testar pelo dono (não consegui ao vivo):** Create Order salvando; checkout de
> produto no último item (2 abas) pra ver a trava de oversell; pré-venda não bloqueada;
> "saved for later" não vazando entre logins.
