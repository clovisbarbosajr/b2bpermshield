# Auditoria de Segurança & Integridade — PermShield

> Registro completo dos bugs encontrados e corrigidos na auditoria (jun/2026).
> Clone do B2BWave (`zapsupplies.b2bwave.com`). B2BWave segue como fonte da verdade
> por algumas semanas; o objetivo é a **lógica própria do clone funcionar** para o
> dia do corte. Sync é **uma via** (B2BWave → app, nunca escreve de volta).

Método: revisão estática multi-agente (adversarial) + testes comportamentais em SQL
rodados na base real. Cada correção tem migração e/ou edit de código versionado.

---

## Como aplicar (resumo)

1. **Migrações** (rodar o SQL no editor do Lovable, em ordem de data):
   - `20260622170000` … `20260623060000` (lista completa abaixo).
2. **Edge functions** (redeploy pelo chat do Lovable, branch `main`):
   - `b2bwave-sync`, `send-email`, `notify-dispatch`, `stripe-checkout`.
3. **Front** (Checkout, OrderDetail, AuthContext, CartContext, relatórios, etc.):
   sobe sozinho no rebuild do Lovable a cada push.

---

## 1. Segurança — CRÍTICO

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| S1 | Cliente podia `UPDATE` qualquer coluna da própria linha em `clientes` → **trocar `tabela_preco_id` e ver a price list de outro**, pôr `can_confirm_order=true` (auto-aprovar compra), mudar `parent_customer_id` (herdar visibilidade), reativar `status`/`is_active`. | Trigger `BEFORE UPDATE fn_lock_privileged_cliente_cols` restaura as colunas sensíveis ao valor antigo no self-update; staff/service_role passam. | `20260623020000` |
| S2 | `send-email` era **relay aberto**: qualquer um com a anon key (no bundle) usava `type:"raw"` / `admin_alert` (to/subject/html arbitrários) para spam/phishing pelo domínio; `set_password`/`magic_link` forjáveis. | `PRIVILEGED_TYPES` (`raw`, `set_password`, `magic_link`, `admin_alert`) exigem admin ou cron/service-role. Fluxos públicos (reset com link do servidor, signup) seguem. | `send-email/index.ts` |
| S3 | Cliente **novo** não conseguia se cadastrar: `INSERT` direto em `clientes` sem policy authenticated → RLS bloqueava (e abrir INSERT permitiria forjar price list no insert, fora do alcance do trava-colunas). | RPC `ensure_my_cliente_record` (SECURITY DEFINER) cria com defaults **seguros forçados** (pendente, sem price list/aprovação/parent) e vincula registro do sync por email. | `20260623050000` + `AuthContext.tsx` |

## 2. Segurança — ALTO

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| S4 | `notify-dispatch`: qualquer logado disparava evento com `customer.phone` arbitrário → SMS/email pra qualquer número (**fraude de toll** no Twilio). | Chamador não-admin não escolhe destino: `customer` vem do cliente do próprio usuário logado (não do body). | `notify-dispatch/index.ts` |
| S5 | Conta **pendente/inativa** criava pedido (só barrava no front). | Trigger `BEFORE INSERT fn_block_order_inactive_customer` (sync e staff passam; denylist conservadora). | `20260623020000` |
| S6 | `payment_options`/`shipping_options`/`coupons`/`tax_*`/`cliente_*_options` só tinham leitura `TO anon` (ou só admin) → **cliente logado não via opções nem imposto** (checkout quebrado) **e** leitura anon ignorava `privado`/`show_to_customers` (vazava opção privada). | Migração impõe visibilidade na RLS: público OU atribuído à conta (herança sub-user→pai), via `cliente_ve_payment_option`/`cliente_ve_shipping_option`; leituras `authenticated` p/ imposto e cupom. | `20260623060000` |
| S7 | `configuracoes` tinha leitura `authenticated USING(true)` expondo segredos (stripe/email/smtp). | (já corrigido antes) `Staff can read configuracoes`; portal lê só não-segredos via `get_public_config`. | `20260618000000` |
| S8 | `ProductEdit` salvava privacidade com delete→insert **sem checar erro** → insert falho após delete deixava produto privado **sem acesso nenhum** (vazamento/sumiço). | Inserts de `produto_acesso`/`produto_cliente_acesso` checam erro e lançam; `handleSave` avisa e não declara sucesso falso. | `ProductEdit.tsx` |

## 3. Estoque (prioridade do dono)

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| E1 | **Sync inflava `estoque_reservado`**: o trigger de reserva (AFTER INSERT em `pedido_itens`) caía no ELSE p/ service_role e somava reservado de TODO item dos 884 pedidos históricos, de forma permanente e crescente (delete+insert a cada ciclo). | Trigger ignora pedido sincronizado (`b2bwave_order_id NOT NULL`). Reparo único zerou a inflação. Sync de produtos volta a re-basear `estoque_reservado` pelo B2BWave (entrou no `changed`/`select`). | `20260623000000` + `b2bwave-sync` |
| E2 | Apagar item de pedido (admin) **não devolvia a reserva**. | Trigger `AFTER DELETE fn_release_stock_on_item_delete` (só pedido do app ativo). | `20260623000000` |
| E3 | `fn_adjust_stock_on_order_status` mexia no estoque de **pedido sincronizado** (status vindo do B2BWave). | Early-return para `b2bwave_order_id NOT NULL`. | `20260623020000` |
| E4 | Subtotal do pedido só recomputava no INSERT de item → ao **apagar** item, subtotal/total ficavam errados. | `fn_pedido_recompute_subtotal` agora dispara `AFTER INSERT OR DELETE`. | `20260623040000` |
| E5 | Oversell: carrinho/checkout usavam `Math.max(disp, 99)` e clamps que travavam backorder. | Usa disponível real; clamps respeitam backorder/pré-venda. | `CartContext.tsx`, `PedidoDetalhe.tsx` |

> **Modelo de estoque (a decidir no corte):** produto/pedido criado no clone tem
> `b2bwave_id`/`b2bwave_order_id = NULL` e o sync **não toca neles** — a lógica do
> clone manda 100%. Produtos espelhados do B2BWave têm `estoque_total`/`reservado`
> re-baseados pelo sync a cada ciclo (B2BWave é a fonte). Validado por teste em SQL.

## 4. Dinheiro / Preço

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| M1 | Cliente mandava `preco_unitario` de cada item (forjável). | Banco **recomputa** o preço autoritativo (price-list → cliente → desconto-qtd → base), espelhando `src/lib/pricing.ts`. | `20260622220000` |
| M2 | Total/subtotal/desconto graváveis inconsistentes pelo cliente. | Triggers recomputam subtotal (soma dos itens), desconto (do **cupom validado**) e total; imposto/frete clampados ≥ 0. | `20260622210000`, `20260622220000`, `20260623000000` |
| M3 | Colisão de número: sync casava pedido por `numero` (= serial do checkout) e podia sobrescrever pedido do app. | Casamento por `b2bwave_order_id` (app fica NULL e nunca é tocado). 16 pedidos duplicados removidos. | `20260622210000` + `b2bwave-sync` |
| M4 | Cupom: incremento `uso_atual` read-modify-write (estoura `uso_maximo`) + contava mesmo se rejeitado. | RPC atômica `increment_coupon_usage`; Checkout relê o pedido e só incrementa se o desconto entrou. Total exibido = total autoritativo do banco. | `20260623030000` + `Checkout.tsx` |
| M5 | Admin `OrderDetail` calculava subtotal/total no client (brigava com os triggers; delete não recarregava). | Para de calcular no client; insere/apaga e recarrega. Painel de totais mostra imposto/frete/desconto reais; `shipping_costs` valida `Number.isFinite`. | `OrderDetail.tsx` |
| M6 | Stripe lê valor do cliente. | (já) lê `pedidos.total` do banco (service role); webhook e confirm idempotentes (`is_paid=false`). | `stripe-checkout/index.ts` |

## 5. Sync (proteção de dados nativos)

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| Y1 | Sync desativava/zerava clientes e produtos nativos do app; nullava price list quando a API omitia; clobava `is_private` raspado. | Soft-delete de cliente desligado; produto stale só **desativa** (com sanity guard ≥50%); price list/rep só gravados quando resolvidos; `is_private` só quando a API traz o campo. | `b2bwave-sync` |
| Y2 | Customer-sync casa por email e sobrescrevia `status`/flags de **sub-user** (que pode ter o email do dono). | Pula `parent_customer_id` no update. | `b2bwave-sync` |
| Y3 | Injeção de HTML nos emails (nome da empresa/comentário do pedido sem escapar). | `esc()` em todos os campos livres dos templates. | `send-email/index.ts` |

## 6. Relatórios (números corretos)

Todos os relatórios de receita/venda passaram a **excluir pedido cancelado** e a
agrupar por status canônico (`canonicalStatus`, PT↔EN):

- `OrderRepsPerformance` (não paga **comissão** de cancelado), `OrdersPerMonth`,
  `CustomerActivity`, `CustomersPerformance`, `SalesPerCategory`, `SalesPerProduct`,
  `CustomerProductSales`, `ProductSales` — excluem cancelado.
- `OrdersSummary`, `OrderSummaryByStatus`, `ProductsByOrderStatus` — agrupam por
  `canonicalStatus` (antes status cru PT/EN sumia/dobrava buckets).
- `Configuracoes` save com **allow-list** (antes spread reescrevia a linha toda,
  revertendo settings de outras páginas e re-persistindo segredos).

## 7. Validado em runtime (teste SQL na base real)

- ✅ Cliente não troca a própria `tabela_preco_id` (roubo de price list bloqueado).
- ✅ Cliente não põe `can_confirm_order=true` (auto-aprovação bloqueada).
- ✅ Pedido de conta **pendente** bloqueado no banco.
- ✅ Cupom para no `uso_maximo` (incremento atômico).
- ✅ Pedido do app: reserva +qtd ao comprar, baixa `estoque_total` ao concluir,
  preço recomputado (ignora preço forjado), em 2 categorias, auto-limpo.

---

## Residuais / pendências conhecidas (baixo impacto)

- **Marcador de origem em `clientes`**: cliente top-level auto-cadastrado com email
  idêntico a um do B2BWave ainda casaria/sobrescreveria no sync (sub-user já
  protegido). Fix definitivo = coluna `clientes.b2bwave_id`. Caso raro (mesmo negócio).
- **Imposto não é recomputado no trigger** (só clampado ≥ 0). Sob divergência
  cliente×servidor o total fica levemente inconsistente. Sem ganho financeiro (base =
  subtotal−desconto+frete já é protegida). Fix futuro = persistir `tax_rate` e recompor.
- **Impersonation ("ver como cliente")**: o preview não escopa privacidade (RLS libera
  tudo p/ admin) e writes durante o "view as" usam o JWT do admin. Não vaza pro cliente;
  recomendado tratar como **somente leitura** durante a impersonação.
- **Enumeração de cupom**: leitura `authenticated` de `coupons` ativos permite listar
  códigos. Hardening = RPC `validate_coupon(code)`. Baixo (abuso de promo).
- **`buildOrderItems`** casa SKU por prefixo → pode ligar produto errado numa linha de
  **pedido sincronizado** (só exibição; estoque do sync é ignorado).
- **`Estoque`/`ProductEdit`**: `parseInt(...) || 0` ao limpar campo salva estoque 0
  (re-baseado pelo sync no próximo ciclo de qualquer forma).

---

## 8. Varredura de áreas não cobertas (2026-06-23, parte 2)

| # | Bug | Gravidade | Correção | Onde |
|---|-----|-----------|----------|------|
| P1 | `generate-pdf` **sem auth** (verify_jwt=false + service role) → qualquer um com um `pedido_id` baixava PII de outro pedido (nome/email/endereço/itens/total). | 🟠 alto | `verify_jwt=true` + gate de **staff** dentro da função. | `config.toml`, `generate-pdf/index.ts` |
| P2 | `increment_coupon_usage(uuid)` chamável em loop p/ qualquer cupom → exaurir promo (griefing). | 🟡 médio | Só incrementa se o cupom está num **pedido do próprio chamador**. | `20260623070000` |
| P3 | `preco_autoritativo`/`_resolve_desconto` com `EXECUTE` público → cliente chamava com `_cliente_id` de outro e **descobria preço negociado alheio** (vaza price list). | 🟡 médio | `REVOKE EXECUTE` de public/authenticated (só os triggers usam). | `20260623070000` |
| P4 | `pedido_itens` sem `CHECK(quantidade>0)` → POST de quantidade **negativa** via PostgREST gera subtotal negativo (pedido quase de graça). | 🟡 médio | `ADD CONSTRAINT CHECK (quantidade > 0) NOT VALID`. | `20260623070000` |
| P5 | `api` edge function: token aceito por **query param** (vaza em log/Referer) + compare não constant-time. | 🟡 médio | Header-only + comparação constant-time. | `api/index.ts` |
| P6 | `viewAs` (impersonação) persistia no localStorage no logout → próximo login no mesmo navegador caía preso na visão do cliente. | 🟢 baixo | Limpa `VIEW_AS_KEY` no `SIGNED_OUT` e no signOut real. | `AuthContext.tsx` |
| P7 | `_schedule_b2bwave_job` SECURITY DEFINER sem `SET search_path`. | 🟢 baixo | Pina search_path (sem GRANT público hoje). | `20260623070000` |

### Verificado OK nesta parte
- **Checkout RLS (`20260623060000`)**: SEGURO (não vaza opção privada p/ anon/cliente não-atribuído) **e** FUNCIONAL (cliente logado lê tudo que precisa). Confirmado por revisão adversarial.
- Signup, reset de senha (não vaza existência de email), `admin-create-user`/`company-member` (re-validam admin/dono), `get_public_config` (só não-segredos), cart/saved-for-later (namespaced por uid), sem realtime/subscriptions no app.

### ⚠️ PENDENTE — decisão sua (não corrigi sozinho)
- **Bucket `product-images` é público** e guarda também o **PDF de catálogo** e os **arquivos de produto** (`files/`) → qualquer um com o link (estável, sem auth) baixa, furando a privacidade de grupo/price list. Fix = mover catálogo/arquivos privados p/ bucket privado servido por `createSignedUrl` (TTL curto). Imagens de produto podem seguir públicas. **Precisa você decidir o que é privado** antes de eu mexer (não quero quebrar a exibição de imagem do catálogo).
- ~~`api` edge function PUT com body cru~~ → **RESOLVIDO**: allow-list de colunas por
  recurso (products/orders/customers); nunca grava campos sensíveis (price list, parent,
  user_id, total, is_paid, estoque_reservado, b2bwave_*). Só GET + PUT escopado, sem
  create/delete. É a API REST própria do clone (espelha a do B2BWave), pra integrações
  externas; token configurável em admin → Profile. Não é usada internamente pelo app.
