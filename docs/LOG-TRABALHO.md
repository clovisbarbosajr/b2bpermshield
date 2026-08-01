# Log de trabalho — PermShield

Diário append-only. **Regra do dono (30/jul/2026):** documentar EM PARALELO
qualquer passo, por menor que seja — ao iniciar algo, ao ficar aguardando algo,
ao editar algo. Entrada nova sempre no fim, com hora e estado.

Estados usados: `INICIADO` · `EDITADO` · `AGUARDANDO` · `FEITO` · `BLOQUEADO`

---

## 2026-07-30

### Pedido do dono (3 problemas)
1. e 2. Em Orders, permitir **editar o preço da linha manualmente** (override) —
   "de vez em quando o Paulo faz uns preços especiais".
3. Erro ao acessar **como cliente** ("View as") — resolver definitivamente.
Restrição: **sem explicações**, só o SQL a rodar; o publish é feito pelo dono no
Lovable.

| # | Hora | Estado | O que |
|---|---|---|---|
| 1 | — | `INICIADO` | Leitura de `OrderDetail.tsx` (tabela Products) — célula *Price* confirmada como texto puro `{fmt(item.preco_unitario)}`, sem edição possível |
| 2 | — | `INICIADO` | Leitura dos triggers: `trg_pedido_item_preco` (BEFORE INSERT) e `trg_pedido_recompute_subtotal` (AFTER INSERT OR DELETE) + `fn_pedido_total_appside` (BEFORE INSERT OR UPDATE em `pedidos`) |
| 3 | — | `EDITADO` | `src/pages/admin/OrderDetail.tsx` — nova função `saveItemPrice()`: grava `preco_unitario` + `subtotal` da linha, checa erro, atualiza `pedidos.subtotal`, chama `loadOrder()`; sai sem request se o valor não mudou |
| 4 | — | `EDITADO` | `src/pages/admin/OrderDetail.tsx` — célula *Price* virou `<Input type="number" min=0 step=0.01>`, salva no `blur` e no `Enter` |
| 5 | — | `EDITADO` | `supabase/migrations/20260730120000_recompute_subtotal_on_item_update.sql` — trigger passa a disparar também em `UPDATE` (antes só INSERT/DELETE, então mudar preço não recomputava subtotal/imposto/total do pedido) |
| 6 | — | `INICIADO` | Diagnóstico do problema 3: revisão de `ViewAsRedirect.tsx`, `Clientes.tsx:handleViewAs`, `AuthContext`, e das 6 migrations de `view_as_tokens` |
| 7 | — | `FEITO` | Causa A confirmada: `gen_random_bytes` (pgcrypto, schema `extensions`) invisível sob `SET search_path = public` — já corrigido em `20260727120000_fix_view_as_token_gen.sql` (usa `gen_random_uuid()`) |
| 8 | — | `FEITO` | Causa B encontrada: a aba nova chamava `consume_view_as_token` **antes** de o supabase-js restaurar a sessão do admin → saía com anon key → "Invalid or expired token", e o token queimava. Somado ao `React.StrictMode`, que roda o effect 2× em dev |
| 9 | — | `EDITADO` | `src/pages/ViewAsRedirect.tsx` — espera `supabase.auth.getSession()` antes da RPC; `useRef` garante **uma** tentativa; erro agora aparece na tela com botão "Back to Customers" em vez de redirect calado pro `/login` |
| 10 | — | `FEITO` | `npx tsc --noEmit` → **0 erros** (rodado após as edições de OrderDetail e de ViewAsRedirect) |
| 11 | — | `EDITADO` | `docs/PRECO-OVERRIDE-E-VIEW-AS-2026-07-30.md` — documento dos 3 problemas |
| 12 | — | `FEITO` | Commit `e40ab2c` — `feat(orders): override manual de preco na linha + fix View as em aba nova` |
| 13 | — | `AGUARDANDO` | **Dono rodar o SQL** (bloco `create_view_as_token` idempotente + trigger com `UPDATE`) e depois **publish** no Lovable. Ordem: **1º SQL, 2º publish** |
| 14 | — | `EDITADO` | Criado este `docs/LOG-TRABALHO.md` a pedido do dono (documentar cada passo em paralelo) |
| 15 | — | `EDITADO` | Memória: novo arquivo `documentar-em-paralelo.md` + índice em `MEMORY.md` — a regra passa a valer em qualquer conversa nova, não só nesta |
| 16 | — | `FEITO` | Commit da documentação (log + memória + doc dos 3 problemas) |
| 17 | — | `FEITO` | Dono rodou o SQL no Lovable — **sem retorno é o esperado**: `CREATE OR REPLACE FUNCTION`, `DROP/CREATE TRIGGER`, `REVOKE` e `GRANT` são DDL e não devolvem linhas |
| 18 | — | `FEITO` | Descoberto por que **não aparecia o botão de publish**: os commits `e40ab2c` e `a5efb6e` estavam só no repo LOCAL (`main` 2 commits à frente do `origin`). O Lovable só vê o código depois do push no GitHub. `git push` feito → `7e1f563..a5efb6e main -> main` |
| 19 | — | `FEITO` | Lovable sincronizou, publish apareceu, dono fez o publish |
| 20 | — | `BLOQUEADO` | "View as" continua com erro após o publish. Diagnóstico: o dono rodou a migration **20260723140000** (que ainda tem `gen_random_bytes` quebrado, linha 23) em vez da **20260727120000** (que corrige com `gen_random_uuid`). Mandado o SQL correto. |
| 21 | — | `AGUARDANDO` | Dono rodar o SQL da 120000 (create_view_as_token com gen_random_uuid) e testar "View as" + override de preço |

### Aguardando resposta do dono (arrastado de 26/jul)
- Decisão sobre as **3 críticas de trigger** (reserva de estoque com
  `UPDATE...FROM`, cupom revalidado em UPDATE, `tax_customer_group_id` fora do
  lock). Diagnóstico: `docs/VARREDURA-3-SISTEMA-2026-07-26.md` seção 3.
- **Comissão do representante**: sobre mercadoria (subtotal) ou sobre total
  (com imposto e frete)? Hoje usa `total`.
- A tela **OAuth Applications** é usada? Os defaults das colunas
  `client_id`/`client_secret` usam `gen_random_bytes` e podem falhar igual ao
  bug do View as.

### O que ainda não foi testado
- Override de preço **em produção** (só typecheck local; o dev server não foi
  usado com login de admin real).
- "View as" ponta a ponta depois do SQL — depende do publish.

---

## 2026-08-01

### Contexto compactado — retomada da conversa

| # | Hora | Estado | O que |
|---|---|---|---|
| 22 | — | `INICIADO` | Nova conversa iniciada (contexto anterior compactado). Retomada a partir do estado do repo e do log de 30/jul. |
| 23 | — | `INICIADO` | Re-leitura completa de todo o fluxo "View as" para confirmar que nada foi esquecido antes do teste: `ViewAsRedirect.tsx`, `AuthContext.tsx`, `Clientes.tsx:handleViewAs`, `PortalLayout.tsx`, `Catalogo.tsx`, migrations `20260319215104`, `20260723140000`, `20260726120000`, `20260726130000`, `20260727120000` |
| 24 | — | `FEITO` | `npx tsc --noEmit` → **0 erros** (verificação limpa após retomada) |
| 25 | — | `FEITO` | Confirmado: o único SQL ainda pendente é o `20260727120000_fix_view_as_token_gen.sql` (`create_view_as_token` com `gen_random_uuid`). Enviado ao dono novamente. Nenhum arquivo de código foi alterado nesta sessão — só verificação. |
| 26 | — | `EDITADO` | `docs/LOG-TRABALHO.md` — seção 01/ago adicionada; entradas 19-21 (do dia 30/jul) e esta seção estavam uncommitted. Commitando tudo. |
| 27 | — | `FEITO` | Bug identificado em `saveItemPrice`: o código fazia `UPDATE pedidos SET subtotal` manualmente **após** gravar o item — mas o trigger `trg_pedido_recompute_subtotal` (20260730120000) já faz exatamente isso em AFTER UPDATE. Double-write desnecessário + potencial race condition. |
| 28 | — | `EDITADO` | `src/pages/admin/OrderDetail.tsx` — removido o `UPDATE pedidos` manual dentro de `saveItemPrice`; agora só grava `pedido_itens` e deixa o trigger fazer o resto. |
| 29 | — | `FEITO` | `tsc --noEmit` → 0 erros. Commit `7b8222c` + push. |
| 30 | — | `AGUARDANDO` | Publish no Lovable (commit `7b8222c`) + teste do override de preço + teste do "View as" |
| 31 | — | `FEITO` | Varredura completa do fluxo "View as" + itens pendentes. Resultado abaixo. |

### Aguardando
- **Publish** do commit `7b8222c` (fix double-write saveItemPrice) no Lovable.
- Testar "View as" e override de preço em produção depois do publish.
- Decisão do dono sobre as 3 críticas de trigger.

### Resultado da varredura (01/ago)

| Componente | Estado | Detalhe |
|---|---|---|
| `ViewAsRedirect.tsx` | ✅ OK | `jaTentou` ref, `await getSession()`, consume token, sessionStorage, redirect `/portal` |
| `Clientes.tsx handleViewAs` | ✅ OK | Abre aba antes do await (evita popup blocker), cria token, navega |
| `AuthContext.tsx` | ✅ OK | Lê sessionStorage, valida sessão admin real, limpa em SIGNED_OUT cross-tab |
| `App.tsx rota /view-as` | ✅ OK | Rota pública — correto; `ViewAsRedirect` faz a guarda internamente |
| Migration `20260727120000` | ✅ OK | `create_view_as_token` com `gen_random_uuid()` (sem pgcrypto) |
| `OauthApplications.tsx` | ✅ OK | `client_id`/`client_secret` gerados no frontend com `crypto.getRandomValues` — defaults de `gen_random_bytes` na coluna nunca são invocados no INSERT. Sem bug. |
| `saveItemPrice` | ✅ CORRIGIDO | Double-write removido (commit `7b8222c`); trigger cuida do subtotal |

---

### Busca de bugs (pedido do dono: "dar uma volta e buscar bugs")

| # | Hora | Estado | O que |
|---|---|---|---|
| 32 | — | `INICIADO` | Varredura geral de bugs a pedido do dono. Leitura integral de `Carrinho.tsx` (359), `CartContext.tsx` (166), `Pedidos.tsx` (296), `Team.tsx` (170), `Checkout.tsx` (1008), `src/lib/pricing.ts` (136) |
| 33 | — | `FEITO` | **BUG CONFIRMADO (crítico)** — `CartContext.clearCart()` apaga `b2b_cart_<userId>` em vez da chave efetiva `cartStorageKey`. Em "View as", `userId` é o do ADMIN → limpar o carrinho do cliente impersonado (`Carrinho.tsx:181` "DELETE ALL") ou finalizar um pedido impersonado (`Checkout.tsx:693` e `:721`) **apaga o carrinho pessoal do admin** |
| 34 | — | `FEITO` | **BUG CONFIRMADO** — `Carrinho.tsx savedKey(user?.id)` ("Saved for Later") não é ciente de impersonação: a lista é compartilhada entre todos os clientes vistos com "View as" e se mistura com a do próprio admin. O `impersonatedCustomer` já está disponível na linha 21 do arquivo |
| 35 | — | `FEITO` | **BUG CONFIRMADO** — disponibilidade calculada por **produto**, não por variante, e as quantidades de variantes do mesmo produto nunca são somadas contra o estoque compartilhado. 3 + 3 de duas variantes contra estoque 5 passa em TODAS as camadas: badge do carrinho, aviso do checkout (`Checkout.tsx:453`) e revalidação no submit (`Checkout.tsx:518`) |
| 36 | — | `FEITO` | **CAUSA RAIZ (schema)** — grep de `variante_id` em `supabase/migrations`: único hit é `20260318202244:128` (tabela `produto_variantes`). **`pedido_itens` NÃO tem coluna `variante_id`.** A variante só chega ao pedido como texto em `nome_produto` + `sku`. Explica: (a) recompra perder a variante, (b) por que o defeito do `UPDATE...FROM` em `fn_adjust_stock_on_order_status` é muito alcançável — duas linhas de variante compartilham o mesmo `produto_id` |
| 37 | — | `FEITO` | **BUG** — `getProductPrice({productId, customerId, quantity})` não recebe variante. A recalculação do checkout (`Checkout.tsx:540-546`) **sobrescreve o preço da variante** pelo preço do produto pai |
| 38 | — | `FEITO` | **BUG** — `getProductPrice` não faz fallback para `parent_customer_id`: um **sub-login é precificado pela própria linha em `clientes`** e perde o `produto_precos_cliente` / `tabela_preco_id` negociado para a empresa. Endereços (`Checkout.tsx:122`) e formas de pagamento/frete (`:154`) JÁ fazem esse fallback — só o preço não |
| 39 | — | `FEITO` | **BUG** — Stripe: pedido + itens são inseridos (disparando a reserva de estoque) **antes** da cobrança; cartão recusado apenas faz `status: "cancelled"` (`Checkout.tsx:654`/`:667`). A devolução do estoque depende inteiramente de `fn_adjust_stock_on_order_status` — a mesma função com o defeito do `UPDATE...FROM` |
| 40 | — | `FEITO` | **BUG** — `resolveDiscount` (`pricing.ts:92-106`) aplica `.order("quantidade_minima", desc).limit(50)` **antes** do filtro de data em JS. Com >50 descontos no mesmo produto, linhas expiradas de alta quantidade ocupam o limite e descontos válidos são descartados |
| 41 | — | `FEITO` | **BUG (menor)** — `Team.tsx` usa `useEffect(() => { load(); }, [])` (dep array vazio): o primeiro `load()` pode rodar antes de `impersonatedCustomer` resolver, mandando `target` vazio pra edge function |
| 42 | — | `FEITO` | **Menores** — (a) `Pedidos.tsx handleReorder` usa `prod.preco` (preço base) em vez do preço do cliente e cai pra qtd 1 com estoque zero; (b) `handleExport` monta CSV com `r.join(",")` sem escapar vírgulas/aspas; (c) canais Realtime `cart-stock-${ids.length}` / `checkout-stock-${ids.length}` colidem entre carrinhos com o mesmo nº de itens; (d) logout do `CartContext` remove só `ANON_KEY`; (e) `resolveEnderecoEntregaId` casa o endereço da empresa só por rua + cidade |
| 43 | — | `FEITO` | **Observação** — grep `valor_minimo\|minimo_pedido\|min_order` em todo o repo → **nenhum resultado**. Não existe regra de pedido mínimo em lugar nenhum. Possivelmente intencional |

### Correções aplicadas (bugs 33, 34, 41)

| # | Hora | Estado | O que |
|---|---|---|---|
| 44 | — | `EDITADO` | `src/contexts/CartContext.tsx` — **fix do bug 33**: `clearCart()` agora apaga `cartStorageKey` (chave EFETIVA) em vez de `storageKey(userId)`. Em "View as", "DELETE ALL" / checkout apagavam o carrinho pessoal do ADMIN e deixavam o do cliente impersonado intacto |
| 45 | — | `EDITADO` | `src/pages/portal/Carrinho.tsx` — **fix do bug 34**: novo `savedViewAsKey(customerId)` + `effectiveSavedKey`; usado no efeito de carga e em `persistSaved`. "Saved for Later" deixa de ser compartilhado entre todos os clientes vistos e de se misturar com a lista do admin. Chave global legada (`cart_saved_for_later`) é removida na carga |
| 46 | — | `EDITADO` | `src/pages/portal/Team.tsx` — **fix do bug 41**: `useEffect(() => { load(); }, [impersonatedCustomer?.id, user?.id])`. Com `[]` o primeiro `load()` podia rodar antes de `impersonatedCustomer`/`user` resolverem, mandando `target` vazio pra edge function (lista da empresa errada / vazia até refresh manual) |

### Verificações de schema (fecham pendências da varredura)

| # | Hora | Estado | O que |
|---|---|---|---|
| 47 | — | `FEITO` | **CONFIRMADO (schema)** — grep `DROP NOT NULL\|ALTER COLUMN` em TODAS as migrations: só 4 hits (`grupo_nome`, `pedidos.status` default ×2, `produtos.sku`). **Nenhuma migration relaxa `produto_descontos.tabela_preco_id NOT NULL`** (declarada em `20260318202244:57`). Fechado também contra o banco VIVO: `src/integrations/supabase/types.ts:1970` traz `tabela_preco_id: string` (não `string \| null`) e obrigatório no `Insert` |
| 48 | — | `FEITO` | **Consequência do 47 — dos DOIS lados**: (a) cliente — `pricing.ts:99` `query.is("tabela_preco_id", null)` **nunca casa** → cliente sem `tabela_preco_id` não recebe NENHUM desconto por quantidade; (b) servidor — a perna `d.tabela_preco_id IS NULL` de `_resolve_desconto` (`20260622220000:19` e `20260623000000:117`) é igualmente morta. **Desconto "global" (valendo pra todas as tabelas) é inexpressável no schema atual**, embora as duas camadas tenham sido escritas esperando que existisse |
| 49 | — | `FEITO` | **Divergência cliente × servidor no desconto** — `pricing.ts:92-106` faz `.limit(50)` **antes** e filtra data em JS **depois**; o servidor (`_resolve_desconto`, autoritativo) filtra data **em SQL sem LIMIT**. Além do bug 40, isso significa que o preço mostrado pode não ser o gravado no pedido |
| 50 | — | `FEITO` | **Bug 38 espelhado no SERVIDOR** — `20260622220000:36`: `SELECT tabela_preco_id INTO _tpid FROM public.clientes WHERE id = _cliente_id;` — **sem** `COALESCE(parent_customer_id, id)`, que é a convenção do repo inteiro (privacidade + RLS `20260623060000:19,28`). O que hoje MASCARA isso é o trigger `20260622000000:19-28`, que copia `tabela_preco_id` do pai **no INSERT do sub-login** — snapshot, fica velho se o pai trocar de tabela depois. E `produto_precos_cliente` não é coberto por nada |
| 51 | — | `FEITO` | **Crítico #3 re-confirmado na fonte** — `fn_lock_privileged_cliente_cols` (`20260623020000`) fixa `tabela_preco_id` (`:27`) e `parent_customer_id` (`:29`), mas **não** `tax_customer_group_id` → cliente/sub-login pode zerar o próprio imposto |
| 52 | — | `FEITO` | **Bug (menor)** — `Pedidos.tsx handleExport` exporta **só a página atual** (`.range((page-1)*PAGE_SIZE, page*PAGE_SIZE-1)`, `PAGE_SIZE = 10`). O botão diz "Export" e o cliente acha que baixou o histórico todo |
| 53 | — | `FEITO` | **Observação (RLS)** — `produto_descontos` e `produto_arquivos` têm policy `TO anon USING (true)` (`20260318202244:67` e `:51`): tabela de descontos por quantidade e arquivos de produto são legíveis **sem login**. Possivelmente intencional (catálogo público), mas expõe a régua de preços |

### Varredura do Admin (Produtos)

| # | Hora | Estado | O que |
|---|---|---|---|
| 54 | — | `FEITO` | **BUG (perda de dados, médio)** — `ProductEdit.tsx:283-339`: TODAS as tabelas-filhas são salvas com `DELETE` incondicional **seguido** de `INSERT`, **sem transação**. Se o INSERT falhar (RLS/constraint/rede), as linhas **já foram apagadas no banco** e não há rollback |
| 54b | — | `CORRIGIDO NO TEXTO` | **Ressalva ao 54 (eu tinha exagerado a gravidade)** — o autor já mitigou: `ProductEdit.tsx:273-281` cria o `orFail`, que **lança** no insert com falha, e o `handleSave` sai antes do toast de sucesso (não diz "Product saved"). Como o estado do formulário **continua em memória**, o admin recupera clicando Save de novo **sem recarregar a página**. Perda definitiva só se ele recarregar/sair. Continua bug (o banco fica temporariamente sem os dados e um F5 consolida a perda), mas **não** é "apagado de vez, sem restore" como escrevi na linha 54 |
| 55 | — | `FEITO` | **BUG (menor, mesmo arquivo)** — os `DELETE` não passam pelo `orFail`: um DELETE que falha é ignorado em silêncio e depois o INSERT bate em chave duplicada (ex.: `tabela_preco_itens` tem `UNIQUE(tabela_preco_id, produto_id)` — `20260318182853:28`) |
| 56 | — | `FEITO` | **Liga 47/48 a uma falha visível no admin** — o insert de descontos faz `{ ...d, produto_id: pid }`. Se a UI deixar a linha de desconto sem `tabela_preco_id` (plausível: os dois comentários do código tratam "global (null)" como opção real), o INSERT viola NOT NULL → "Failed to save discounts" → **e os descontos antigos já foram deletados**. `produtos_relacionados` é a ÚNICA filha que pré-filtra linha inválida (`relValid`, comentário "ignora linhas sem produto escolhido (FK invalida)") — o autor conhecia essa classe de erro em um ponto e não nos outros |
| 57 | — | `FEITO` | **Bug 35 REFORÇADO** — `ProductEdit.tsx:344-358` grava `produto_variantes` com coluna **`quantidade` por variante**. Ou seja: o estoque por variante **existe no banco** e o carrinho/checkout **ignora ele** (só olha `produtos.estoque_total - estoque_reservado`). Dá pra pedir 10 "Camiseta M" com 10 no total da camiseta mas 2 de M — passa na validação da tela |
| 58 | — | `FEITO` | **Catalogadas as 2 filhas que faltavam do `saveSubData`** — `produto_variantes` (`:344-358`, comentário do autor diz que essa tabela era read-only e a edição de variante sumia em silêncio) e `produto_acesso` (`:364+`). Ambas seguem o mesmo DELETE→INSERT do bug 54 |

### Correções menores aplicadas (42b, 42c, 42d, 52)

| # | Hora | Estado | O que |
|---|---|---|---|
| 59 | — | `EDITADO` | **52 + 42b corrigidos** — `src/pages/portal/Pedidos.tsx` `handleExport`: (a) agora consulta o banco de novo **sem `.range()`**, reaplicando os MESMOS filtros da tela → exporta o histórico inteiro, não só os 10 da página; (b) novo `csvCell` põe aspas/escapa `"` quando o campo tem vírgula, aspas ou quebra de linha (antes um `po_number` com vírgula deslocava as colunas); (c) troquei `data:text/csv` por `Blob` + `URL.createObjectURL` (URL de dados estoura em histórico grande) com BOM UTF-8 pro Excel não quebrar acento; (d) `status` agora sai como rótulo (`statusLabel`) e não como enum cru; (e) botão desabilita e mostra `EXPORTING...`, com toast do total exportado |
| 60 | — | `EDITADO` | **42d corrigido** — `src/contexts/CartContext.tsx`: no logout, além do `ANON_KEY`, agora roda `purgeViewAsCarts()`, que varre o `localStorage` e apaga TODAS as chaves `b2b_cart_viewas_*` e `cart_saved_for_later_viewas_*`. Motivo: carrinho de "View as" é rascunho da sessão do admin — ficava na máquina depois que ele saía e reaparecia pro próximo admin. O carrinho **pessoal** (`b2b_cart_<uid>`) continua sendo preservado de propósito |
| 61 | — | `EDITADO` | **42c corrigido** — nome de canal Realtime único: `Carrinho.tsx:117` e `Checkout.tsx:469` usavam `` `cart-stock-${ids.length}` `` / `` `checkout-stock-${ids.length}` ``. Dois efeitos com a mesma quantidade de itens (ou carrinho + checkout abertos juntos) geravam o MESMO topic, e o `removeChannel` do cleanup antigo derrubava o canal novo → parava de chegar mudança de estoque em tempo real (só o polling de 10s segurava). Agora usa `crypto.randomUUID()` |
| 62 | — | `FEITO` | **Verificado que os outros 2 canais NÃO têm o problema** — `Catalogo.tsx:120` (`portal-catalogo-estoque`) e `admin/Estoque.tsx:39` (`admin-estoque-produtos`) usam nome fixo, mas são telas únicas por aba e o efeito roda uma vez — sem colisão |
| 63 | — | `EDITADO` | **Ressalvas do próprio 59** — (a) `URL.revokeObjectURL` na linha seguinte ao `a.click()` cancelava o download em alguns navegadores; agora revoga com `setTimeout` de 10s; (b) o PostgREST corta em `db-max-rows` (1000 no Supabase) — se vier exatamente no teto, o CSV está truncado e o cliente não saberia. Agora mostra aviso pedindo pra estreitar o período (`EXPORT_CAP`) |

### Bug NOVO encontrado (sub-usuário não fecha pedido)

| # | Hora | Estado | O que |
|---|---|---|---|
| 64 | — | `FEITO` | **BUG CRÍTICO (funcional) — sub-usuário NÃO consegue salvar endereço de entrega no checkout.** O portal grava endereço com o `cliente_id` do PAI (`Checkout.tsx:122` → `addressClienteId = parent_customer_id ?? cliente.id`), tanto no "Add address" (`saveNewAddress:251`) quanto no default "__company__" (`resolveEnderecoEntregaId:277`). Mas na RLS de `enderecos` o sub-usuário só tem **SELECT** do pai (`20260622000000:141-144`, "Sub-customer reads parent addresses"). A única policy de escrita que serve é `"Clients can manage own enderecos"` (`20260317043654:189`), `FOR ALL USING (clientes.user_id = auth.uid())` — **sem `WITH CHECK`**, então o Postgres reusa o USING no INSERT e o sub-usuário só grava com o **próprio** id, nunca com o do pai → INSERT barrado |
| 65 | — | `FEITO` | **Por que ninguém tinha visto**: existia uma migration pra exatamente isso — `20260716130000_contacts_insert_enderecos.sql` — mas ela **nasceu morta**. É um `DO $$ ... IF EXISTS (company_contacts)`, e rodou DEPOIS de `20260622000000`, que faz `DROP TABLE company_contacts CASCADE` + `DROP FUNCTION is_company_buyer`. A tabela já não existia → caiu no `ELSE` com `RAISE NOTICE 'company_contacts nao existe...'` e **não criou policy nenhuma**. O comentário do arquivo até diz "sem a tabela não há sub-usuários" — o que deixou de ser verdade quando o modelo virou `clientes.parent_customer_id` |
| 66 | — | `AGUARDANDO` | **SQL criado** — `supabase/migrations/20260801120000_subuser_insert_enderecos.sql`: cria `"Sub-customer inserts parent addresses"` (`FOR INSERT ... WITH CHECK (public.is_subcustomer_of(cliente_id))`) e dropa a policy natimorta. UPDATE/DELETE seguem só com o titular/admin **de propósito** (funcionário adiciona local de entrega, não mexe nos endereços da empresa). **Falta o dono rodar no Lovable** |
| 67 | — | `FEITO` | **Confirmado que o app avisa** (não é falha silenciosa) — `Checkout.tsx:283-291` já checa `addrErr` e bloqueia o pedido com mensagem; `saveNewAddress:258` idem. Ou seja: hoje o sub-usuário vê um erro de permissão e **não consegue prosseguir** — não fecha pedido sem endereço |

