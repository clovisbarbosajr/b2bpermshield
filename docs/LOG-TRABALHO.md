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

### Bug de estoque com variantes (corrigido)

| # | Hora | Estado | O que |
|---|---|---|---|
| 68 | — | `EDITADO` | **BUG (estoque, médio→alto) CORRIGIDO** — as 3 validações de estoque comparavam **linha a linha**: `disponivel < item.quantidade`. Como duas variantes do mesmo produto são **linhas separadas** (`cartKey` = produto+variante) que dividem o MESMO `produtos.estoque_total`, um carrinho com 6 "Tam M" + 6 "Tam G" passava nas duas (6 < 10 em cada) e ia pro banco pedindo 12 com 10 em estoque. Agora soma por `produto_id` antes de comparar. Corrigido em: `Carrinho.tsx` (watcher), `Checkout.tsx` (aviso proativo) e `Checkout.tsx` (re-validação do submit) |
| 70 | — | `EDITADO` | **Info leak (menor) na edge `company-member`** — `.ilike("email", emailLc)` com o email vindo do body: `%` e `_` são curinga no `ilike`. Um dono de conta mandando `%@concorrente.com` casava com qualquer email e a mensagem de erro devolvia o **nome da empresa dona** → dava pra varrer a base de clientes pelo formulário "adicionar funcionário". Adicionado `likeEscape()` nas duas consultas. O resto da função está bem guardado (chamador autenticado, staff obrigado a mandar `cliente_id`, sub-login barrado por `owner.parent_customer_id`, todo update com `.eq("parent_customer_id", companyId)`) |
| 71 | — | `FEITO` | **Pedido do dono: checar se outra IA mexeu em algo, principalmente no "ver como cliente".** Resultado: **o código do view-as NÃO foi tocado por ninguém**. `git log` de `ViewAsRedirect.tsx` + `AuthContext.tsx` + migrations `*view_as*` para no commit `e40ab2c` (o meu). Arquivo conferido linha a linha: guarda do `jaTentou` (StrictMode), `await getSession()` antes da RPC, card de erro com "Back to Customers" — tudo no estado correto |
| 72 | — | `FEITO` | **O que MUDOU fora daqui** — 3 commits em cima do meu `09fe09c`, todos batendo com achados que eu já tinha registrado: `633a0aa` (os 3 críticos de trigger: estoque/cupom/imposto), `6f9c4c0` (checar erro nos updates de item do pedido), `c865cbc` (preço do sub-login com `COALESCE(parent_customer_id, id)` + filtro de data no banco = bugs 38/50 e 40/49). **Sem conflito com o que fiz** |
| 73 | — | `AGUARDANDO` | **Trabalho de OUTRA sessão ainda NÃO commitado** (deixei intacto, não é meu): `src/lib/fetchAllRows.ts` (novo) + `src/lib/export-csv.ts` + **14 telas de `admin/reports/`**. É a correção do teto de 1000 linhas do PostgREST nos relatórios. Passa no `tsc --noEmit`. **Não commitei nem sobrescrevi** |
| 74 | — | `FEITO` | **Sobreposição a resolver**: eu tratei o mesmo teto de 1000 no export do portal (`Pedidos.tsx`, entradas 59/63) com um **aviso** (`EXPORT_CAP`), enquanto a outra sessão fez um utilitário melhor (`fetchAllRows`, pagina de verdade). Quando aquilo for commitado, vale trocar o aviso pelo `fetchAllRows` no `Pedidos.tsx`. Os dois também chegaram ao mesmo fix do `URL.revokeObjectURL` com `setTimeout` — sem conflito, arquivos diferentes |
| 75 | — | `FEITO` | **Dono rodou os 2 SQL + push + publish** (`create_view_as_token` com `gen_random_uuid` e a policy `Sub-customer inserts parent addresses`). Local e `origin/main` em `9b25a2c`. **Falha minha antes**: mandei o comando `cat ...` em vez do conteúdo do SQL, e ele colou no runner → `syntax error at or near "cat"`. Reenviado o SQL direto e rodou |
| 76 | — | `AGUARDANDO` | **Teste em produção** (lista completa na resposta ao dono): (1) View as em aba nova + as outras abas continuarem staff; (2) carrinho do view-as isolado por cliente e "DELETE ALL" não apagar o do admin; (3) sub-login salvando endereço novo no checkout; (4) duas variantes do mesmo produto estourando o estoque juntas devem bloquear; (5) Export do histórico trazendo tudo, não só a página; (6) override manual de preço na linha do pedido |
| 77 | — | `AGUARDANDO` | Continua **não commitado** o trabalho da outra sessão (`fetchAllRows.ts` + `export-csv.ts` + 14 telas de `admin/reports/`) — **não foi publicado**, então os relatórios em produção ainda têm o teto de 1000 linhas |
| 78 | — | `FEITO` | **Teste do dono: "View as" avançou e falhou mais adiante** — `Could not open View as: column reference "id" is ambiguous`. **Progresso real**: o token na URL tem 64 chars hex, ou seja, a `20260727120000` (gen_random_uuid) ENTROU e a criação do token funciona. O erro agora é no CONSUMO |
| 79 | — | `FEITO` | **Causa** — `consume_view_as_token` (`20260726120000:26`) declara `RETURNS TABLE (id UUID, user_id UUID, ...)`. Em plpgsql cada coluna do RETURNS TABLE vira **variável de saída visível no corpo**. No `UPDATE public.view_as_tokens SET used_at = now() WHERE id = _token_row.id`, o `id` casa com a coluna E com a variável → erro 42702. Estava latente desde 26/jul; só apareceu agora porque antes o fluxo morria antes, na criação do token |
| 80 | — | `AGUARDANDO` | **SQL criado** — `supabase/migrations/20260802120000_fix_consume_view_as_ambiguous_id.sql`: alias `t` na tabela e `t.id` no WHERE. O SELECT inicial também foi qualificado por precaução. Nada de comportamento muda (uso único + `admin_user_id = auth.uid()` + mensagem genérica). **Falta o dono rodar** |
| 81 | — | `RESOLVIDO` | ✅ **"View as" FUNCIONANDO — confirmado pelo dono em produção** (02/ago). Ele rodou o SQL do 80 e o fluxo abriu. Fecha o **problema 3** da lista original ("erro ao acessar como cliente — resolver definitivamente"), aberto desde 30/jul |
| 82 | — | `FEITO` | **As 2 causas do "View as", pra não se perder**: (a) **criação** do token — `gen_random_bytes` é do pgcrypto, que no Supabase vive no schema `extensions`, invisível sob `SET search_path = public` → trocado por `gen_random_uuid()` (`20260727120000`); (b) **consumo** — `id` ambíguo entre a coluna e a variável de saída do `RETURNS TABLE` → alias `t` na tabela (`20260802120000`). A (b) estava latente desde 26/jul e só apareceu quando a (a) foi corrigida e o fluxo passou a chegar lá |
| 83 | — | `AGUARDANDO` | **Ainda falta testar** (o View as era o item 1 de 6): (2) carrinho do view-as isolado por cliente + "DELETE ALL" não apagar o do admin; (3) sub-login salvando endereço novo no checkout; (4) duas variantes do mesmo produto estourando o estoque juntas devem bloquear; (5) Export do histórico trazendo tudo, não só a página; (6) override manual de preço na linha do pedido |
| 84 | — | `FEITO` | **Revisei o trabalho da outra sessão nos relatórios** (`fetchAllRows.ts` + 13 telas de `admin/reports/`). A lógica está **correta**: cada `.select()` sem `.range()` virou `fetchAllRows`, que pagina de 1000 em 1000 até a última página. Resolve o corte silencioso do PostgREST, que fazia o total sair plausível e errado |
| 85 | — | `EDITADO` | **REGRESSÃO que aquele trabalho introduziu — corrigida.** `fetchAllRows` **lança** em erro, enquanto o código antigo (`.data ?? []`) engolia. Em **12 das 13 telas** o `fetch()` não tinha `catch` → o `setLoading(false)` nunca rodava: **spinner eterno + unhandled rejection**. Adicionado `.catch()` com `console.error` + toast + `setLoading(false)` nas 13 (a 13ª, `OrdersPerMonth`, tinha um catch **mudo** — mostrava gráfico vazio como se não houvesse pedido; agora avisa) |
| 86 | — | `FEITO` | **Validado até onde dá sem login**: `npx tsc --noEmit` limpo · `npx vite build` limpo (2462 módulos) · app sobe em `localhost:8080`, carrega a home, **zero erro de console** · `/admin/reports/inventory-control` redireciona pra home (guarda `<A>` de admin funcionando). **O que falta precisa da conta do dono** — não tenho e não devo usar credencial |
## ⚠️ PENDÊNCIA ABERTA — NÃO ESQUECER

| # | Estado | O que |
|---|---|---|
| **P2** | `AGUARDANDO DECISÃO` | **Ciclo de categoria derruba o catálogo (tela branca).** No admin, o select de categoria-pai exclui só a própria categoria, **não os descendentes** (`admin/Categorias.tsx:420`), e não há trava no banco. Pondo "Accessories - FL" como filha de "PermTread" (que é filha dela), `getDescendantIds` (`Catalogo.tsx:164-167`) e o loop do breadcrumb (`:176-179`) recorrem sem guarda → stack overflow → tela branca (não há ErrorBoundary). O mesmo dado quebra o `WITH RECURSIVE` de `cliente_pode_ver_categoria`, que está no RLS de leitura de `categorias`. **Pré-existente, não é da entrega de 03/ago.** Correção = bloquear descendente no select + guarda de profundidade nos 2 laços |
| **P3** | `AGUARDANDO DECISÃO` | **Produto de categoria DESATIVADA aparece na raiz e some dentro do pai.** `Catalogo.tsx:73` filtra categorias por `ativo = true`, `:72` não filtra produtos por isso, e o RLS de produto não olha `categorias.ativo`. Na home do catálogo o produto aparece; clicando no pai ele some. **É decisão de produto**: desativar uma categoria deve esconder os produtos dela ou não? |
| **P4** | `AGUARDANDO` | **Importação de categorias por CSV quebra com "ordem" em branco.** `tools/ImportCategories.tsx:81` grava `null` numa coluna `NOT NULL DEFAULT 0` → o insert inteiro falha. Correção: omitir a chave em vez de mandar `null` |
| ~~**P1**~~ | `RESOLVIDO 03/ago` | **Desconto por quantidade — FECHADO. Resposta do cliente: _"Sempre escolher a tabela de preço"_.** Desconto global (valendo pra todas as tabelas) **não é feature** — o comportamento atual estava certo, o que estava errado era o código morto fingindo que a opção existia. Limpeza feita nas entradas 123-125 |

### Decisões do dono (02/ago) — itens 2 e 3 fechados

| # | Hora | Estado | O que |
|---|---|---|---|
| 100 | — | `RESOLVIDO` | **Item 3 — pedido mínimo: FECHADO.** O dono confirmou: *"Ta correto, não existe pedido mínimo"*. Não é bug, não é pendência, o comportamento atual está certo |
| 101 | — | `FEITO` | **Item 2 — o dono foi MAIS LONGE que a pergunta**: *"Nada pode ser público. Só tem acesso a produto do sistema se tiver login"*. Eu tinha perguntado só sobre 2 tabelas; a resposta vale pro banco inteiro. Fiz o levantamento: cruzando CREATE × DROP POLICY em todas as migrations, sobravam **19** policies `FOR SELECT TO anon USING (true)` das migrations de mar/2026 |
| 102 | — | `FEITO` | **O que dava pra ler SEM LOGIN** — além das 2 que eu já sabia (`produto_descontos`, `produto_arquivos`): `produto_imagens`, `produto_variantes` (**incluindo a quantidade em estoque de cada tamanho/cor**), `produtos_relacionados`, `produto_opcoes`, as **4 tabelas de imposto**, `coupons` com `ativo = true` (**dava pra pescar código de cupom válido**), `brands`, `product_statuses`, `measurement_units`, `extra_fields`, `privacy_groups`, `banners`, `noticias`, `quick_links`. As mais graves (clientes, pedidos, pedido_itens, enderecos, produtos, tabelas_preco) já tinham sido fechadas em 18-19/jun — estas escaparam |
| 103 | — | `FEITO` | **Conferi ANTES de fechar que nada público quebra**: `/` não consulta o banco · `/login`, `/customers-login`, `/admin-login`, `/recuperar-senha`, `/reset-password` só usam `supabase.auth.*` · `/cadastro` usa `auth.signUp` + a edge `register-customer` (service role, não passa por RLS) · `/pending-approval` lê `clientes` já logado · a config pública do portal vem da RPC `get_public_config`, que não depende dessas policies. As policies de `authenticated` e de staff seguem intactas |
| 104 | — | `AGUARDANDO` | **SQL criado** — `supabase/migrations/20260802140000_fechar_leitura_anonima.sql`, com os 19 DROP POLICY e, no rodapé, a consulta de conferência em `pg_policies` (tem que voltar vazia). **Falta o dono rodar** |

| 105 | — | `FEITO` | **O dono rodou a parte 1 e mandou o CSV da conferência: voltaram 4 linhas.** Ou seja, o meu levantamento por nome (`"Anon can read ..."`) era **incompleto** — e o que escapou é o mais grave de tudo: `produtos`, `categorias`, `payment_options`, `shipping_options`, todas com `roles = {anon,authenticated}`. Escaparam porque as policies "scoped" criadas depois concedem aos DOIS papéis na mesma linha, com outro padrão de nome |
| 106 | — | `FEITO` | **Por que era grave** — `"Read produtos scoped"` (`20260622191614:154`) usa `cliente_pode_ver_produto`, que para item NÃO-privado faz `IF NOT COALESCE(_priv, false) THEN RETURN true` (`:118-120`): devolve **true sem olhar quem chamou**. Como `is_private` é false por padrão, **o catálogo inteiro — nome, SKU, preço base, estoque — era legível sem login**. A privacidade por grupo funcionava; o resto ficava aberto. Idem `categorias`. E `payment_options`/`shipping_options` (`20260623060000:36,43`) entregavam as opções públicas ao anônimo, **incluindo preço de frete e a regra de frete grátis** |
| 107 | — | `AGUARDANDO` | **SQL da parte 2 criado** — `supabase/migrations/20260802150000_fechar_leitura_anonima_parte2.sql`: recria as 4 policies **idênticas**, só trocando `TO authenticated, anon` por `TO authenticated`. O `USING` não muda em nada (privacidade por grupo, grant/exclude, `ativo`, `show_to_customers`). **Falta o dono rodar** e repetir a conferência |
| 108 | — | `FEITO` | **Lição pro futuro**: procurar policy anônima **por nome** não basta. O certo é sempre `SELECT ... FROM pg_policies WHERE 'anon' = ANY(roles)` — foi o que o CSV do dono provou |

| 109 | — | `RESOLVIDO` | ✅ **LEITURA ANÔNIMA FECHADA — confirmado pelo dono.** Ele rodou a parte 2 e repetiu a conferência: `SELECT ... FROM pg_policies WHERE 'anon' = ANY(roles)` **voltou vazia**. Nenhuma policy do schema `public` concede mais nada ao papel `anon`. Fecha o item 2 da conversa de 02/ago ("Nada pode ser público") |
| 110 | — | `FEITO` | **Placar do fechamento**: 19 policies na parte 1 (`20260802140000`) + 4 na parte 2 (`20260802150000`) = **23 aberturas anônimas removidas**. As 4 da parte 2 eram as piores (catálogo, frete, pagamento) e só apareceram porque o dono rodou a conferência — meu levantamento por nome não as pegou |
| 111 | — | `AGUARDANDO` | **Ainda na fila**: (1) SQL do `pedido_itens.variante_id` (`20260802130000`) — **não rodado**; (2) **publish** no Lovable, que leva TUDO que está no GitHub e ainda não foi publicado: estoque por variante (`src/lib/stock.ts` + 18 testes), variante no re-order, validação do `ProductEdit` antes do delete, relatórios paginados com tratamento de erro, export do histórico, canais Realtime, vazamentos do view-as. **O SQL da leitura anônima já está valendo em produção sem depender do publish** (é só banco) |

## 2026-08-03 — barra de subcategorias somia (pedido do dono)

| # | Hora | Estado | O que |
|---|---|---|---|
| 117 | — | `FEITO` | **Pedido do dono, com 2 prints**: ao clicar numa subcategoria (Accessories - FL › PermTread) os botões das outras subcategorias somem, e pra pedir em mais de uma ele tem que voltar em "Accessories - FL" a cada troca. **Causa**: `Catalogo.tsx:181` era `categoryParam ? childrenOf(categoryParam) : rootCats` — PermTread é FOLHA, `childrenOf` devolve `[]`, e o bloco `{subCategories.length > 0 && ...}` não renderiza nada |
| 118 | — | `EDITADO` | **Corrigido** — regra extraída pra `catalogCategoryButtons()` em `src/lib/categoryTree.ts`: sem categoria → raízes; categoria COM filhas → filhas (desce um nível, como antes); categoria FOLHA → **irmãs**, com a atual destacada pelo `variant` que já existia. Tirei do componente pra poder testar |
| 119 | — | `FEITO` | **Agentes (pedido do dono): caçador + cético.** Caçador levantou 8 achados. Cético leu o código e derrubou: **0 regressões da mudança**. Falsos: 5 e 6 (preferência de design, contradita pelo `variant` da `:298` e pelo breadcrumb/sidebar que não somem), 7 (premissa falsa — breadcrumb e sidebar não dependem de `search`), 8 (o próprio caçador já tinha descartado). Reais mas **pré-existentes e fora desta entrega**: 2 (ciclo → **P2**), 3 (id inexistente na URL — e o cético notou que a mudança MELHORA esse caso: antes barra vazia, agora mostra as raízes), 4 (categoria desativada → **P3**) |
| 120 | — | `EDITADO` | **Único achado que valia agora (o 1, com a atribuição corrigida pelo cético)** — categoria ÓRFÃ. A lista chega filtrada por `ativo = true` + visibilidade, então basta **desativar a categoria-pai** pra todas as filhas ficarem apontando pra um pai que sumiu: nenhuma tinha `parent_id` nulo, `roots` vinha vazio e a barra sumia na HOME. Criada `rootCategories()` (raiz = sem pai **ou** pai fora da lista). **O cético cobrou espelhar em `PortalLayout.tsx:57`** — feito, senão a árvore inteira da sidebar sumia do mesmo jeito e o conserto ficava pela metade. Também removi o `rootCats` que ficou morto no `Catalogo.tsx` |
| 121 | — | `FEITO` | **Validado**: `tsc --noEmit` limpo · **36 testes passando** (24 novos: 12 da barra + os da órfã e da `rootCategories`) · `vite build` limpo. Os testes travam o pedido do dono como caso nomeado: *"PEDIDO DO DONO — categoria folha mostra as IRMAS, nao lista vazia"* e *"da pra pular direto de uma folha para outra sem passar pelo pai"* |
| 122 | — | `AGUARDANDO` | **Publish** (só código, sem SQL). Teste real: abrir Accessories - FL › PermTread e conferir que a barra continua lá, dá pra pular direto pra Reducer/End Cap, e a atual fica destacada |

### P1 fechada + P2/P3/P4 corrigidas (03/ago)

| # | Hora | Estado | O que |
|---|---|---|---|
| 123 | — | `FEITO` | **P1 RESOLVIDA — resposta do cliente: _"Sempre escolher a tabela de preço"_.** Desconto global não é feature. O comportamento em produção já estava certo; o errado era o código morto sugerindo que a opção existia |
| 124 | — | `EDITADO` | **Código morto removido** — `src/lib/pricing.ts`: caiu a perna `tabela_preco_id.is.null` do `or()` e o ramo `else query.is("tabela_preco_id", null)` (que **nunca casava**, a coluna é NOT NULL). Agora, sem tabela de preço, `resolveDiscount` retorna `null` de saída. Caiu junto o `specific`/`candidates`, que existia só pra desempatar específico × global — sem global, a primeira linha (já ordenada por `quantidade_minima` desc) é a resposta |
| 125 | — | `EDITADO` | **UI honesta** — `ProductEdit.tsx`: a coluna virou **"Price List \*"** e o select fica com borda vermelha enquanto estiver vazio. O select nunca ofereceu "global" (só lista tabelas reais), então não havia mentira ali; o que faltava era deixar claro que é obrigatório. Somado à validação de 02/ago (entrada 95), o admin não consegue mais salvar desconto sem tabela **nem apagar os antigos por engano** |
| 126 | — | `FEITO` | **NÃO mexi na função do banco.** `_resolve_desconto` (`20260622220000:19`, `20260623000000:117`) tem a mesma perna morta `d.tabela_preco_id IS NULL`. Deixei como está de propósito: ela é inofensiva (nunca casa) e mexer exigiria rodar SQL que altera o cálculo de preço — risco real por ganho zero. **Registrado aqui pra não parecer esquecimento** |
| 127 | — | `EDITADO` | **P2 CORRIGIDA (ciclo de categoria)** — 4 frentes: (a) `lib/categoryTree.ts` ganhou `descendantIds()` e `ancestorChain()`, ambas com `Set` de visitados + corte de profundidade; (b) `Catalogo.tsx` trocou a recursão `getDescendantIds` e o `while` do breadcrumb por elas — **ciclo já gravado no banco não derruba mais a tela**; (c) `admin/Categorias.tsx` passa a excluir do select de pai a própria categoria **e todos os descendentes** (`parentesProibidos`), com trava também no `handleSave`; (d) `PortalLayout.renderCatItem` ganhou `depth` com corte em 12 |
| 128 | — | `EDITADO` | **P3 CORRIGIDA (produto de categoria desativada)** — `Catalogo.tsx` filtra produto cuja categoria não está na lista de ativas. **Assumi que desativar categoria esconde os produtos dela** — é o significado usual e já era o que acontecia ao navegar pelo pai; o defeito era a INCONSISTÊNCIA (aparecia na home, sumia no pai). Produto sem categoria continua aparecendo. **Se o dono quiser o contrário, é uma linha** |
| 129 | — | `EDITADO` | **P4 CORRIGIDA (import de categorias)** — `ImportCategories.tsx`: `ordem` em branco agora é **omitida** (o `DEFAULT 0` age) em vez de mandar `null` numa coluna NOT NULL. Valor não-numérico ("abc") também vira omissão, em vez de `NaN` |
| 130 | — | `FEITO` | **Validado**: `tsc --noEmit` limpo · **46 testes** passando (10 novos, incluindo ciclo A↔B e ciclo de 3 categorias, que antes travariam) · `vite build` limpo |
| 131 | — | `FEITO` | **Agentes rodaram sobre P2/P3/P4** (caçador + cético). Diferente da rodada anterior, desta vez **o caçador achou falha real minha** e o cético confirmou |
| 132 | — | `CORRIGIDO` | **Eu tinha corrigido a P2 PELA METADE.** Tirei o laço perigoso do `Catalogo.tsx` e esqueci os iguais em **3 outras telas**: `ProdutoDetalhe.tsx:156-163` (breadcrumb, o MESMO `while` que removi), `ProducaoDashboard.tsx:92` e `ProducaoEntrada.tsx:55` (`while (cur.parent_id && catById.get(cur.parent_id))`). Corrigidos: o primeiro usa `ancestorChain`, os outros dois ganharam `guard < 12` |
| 133 | — | `FEITO` | **Detalhe que muda a gravidade** (o cético viu, o caçador não): nessas telas o sintoma é **pior** que tela branca — por serem `while` e não recursão, é **loop infinito, a aba congela**. E `has_role(admin/manager/warehouse)` retorna `true` **antes** da CTE recursiva de `cliente_pode_ver_categoria` (`20260622150000:92`), então o staff **recebe** as linhas do ciclo. As telas de Produção são admin-only: é exatamente onde o travamento é alcançável |
| 134 | — | `FEITO` | **`PdfCatalog.tsx:97` conferido e está OK** — a recursão parte de `parent_id = null`, e como cada nó tem um só pai, um ciclo é sempre um componente desconectado da floresta enraizada: nó de ciclo nunca é alcançado a partir da raiz. Não precisa de guarda |
| 135 | — | `CORRIGIDO` | **Regressão MINHA, apontada pelo caçador**: ao trocar `categoryIds` de `categoryParam` para `selectedCategory`, uma URL com categoria inexistente passou de "lista vazia" para **`null` = catálogo INTEIRO**, numa tela que diz estar dentro de uma categoria. Reproduzível pelo botão "View as" do admin (`Categorias.tsx:376`), já que a lista de lá mostra categorias inativas de propósito (`:83-90`). Agora `categoryIds = []` (não casa com nada) + aviso "This category is no longer available" com link pro catálogo |
| 136 | — | `CORRIGIDO` | **Frase cortada (pré-existente)** — o guard era `{categoryParam && ...}` mas o nome vinha de `selectedCategory?.nome`, então renderizava "…sub-categories in " terminando no nada. Trocado para `{selectedCategory && ...}` |
| 137 | — | `EDITADO` | **Blindagem do filtro da P3** — `cats` vazio (erro/timeout na query) NÃO é "tudo desativado". Sem guarda, uma falha ali esconderia todo produto com categoria e o cliente veria "No products found" com o banco cheio. Agora o filtro só roda com `!catRes.error && cats.length > 0`. O cético classificou como blindagem barata, não bug demonstrado |
| 138 | — | `FEITO` | **Confirmado pelo cético que o filtro da P3 NÃO esconde por privacidade** — `cliente_pode_ver_produto` (`20260622150000:147-149`) já exige a categoria visível, então produto visível ⟹ categoria visível. O filtro só morde no `ativo`, sem conflitar com o `okP` do view-as |
| 139 | — | `CORRIGIDO NO TEXTO` | **Ressalva do cético à minha entrada 127(d)**: a guarda de `depth` que pus no `PortalLayout.renderCatItem` é **inalcançável** — `rootCategories()` já exclui nó de ciclo da raiz da sidebar. É inofensiva, mas **não conta como correção**. Deixei no código como defesa em profundidade, registrando aqui que não é o que resolve |
| 140 | — | `FEITO` | **Validado depois das correções**: `tsc --noEmit` limpo · 46 testes passando · `vite build` limpo · `grep` confirma que **não sobrou nenhum `while` de categoria sem guarda** em `src/` |

### Varredura das 4 telas admin que NUNCA tinham sido olhadas (03/ago)

| # | Hora | Estado | O que |
|---|---|---|---|
| 159 | — | `FEITO` | **Caçador + cético nas telas nunca revisadas** (`admin/Pedidos`, `admin/Estoque`, `admin/Produtos`, `InventoryAdjustment`). Caçador achou 18; cético **confirmou os 18 como reais no mecanismo** (não derrubou nenhum), mas reclassificou gravidade e corrigiu **2 diagnósticos** dele |
| 160 | — | `EDITADO` | **P2 (o pior) — desfazer conclusão de pedido não devolvia estoque.** `fn_adjust_stock_on_order_status` tinha ramo pra "entrou em concluído" e nenhum pra "saiu de concluído". Marcar Complete no pedido errado baixava o estoque; voltar o status **não devolvia**; e reconcluir baixava **de novo**. Tudo por um `<Select>` na LINHA da tabela, sem confirmação. **SQL**: `20260803120000_desfazer_conclusao_devolve_estoque.sql` (ramo novo `_old_done AND NOT _new_done`; e o ramo de cancelado ganhou `AND NOT _old_done` pra não tirar reserva que ainda não existia). **App**: `confirm()` explicando que o clique mexe em estoque |
| 161 | — | `EDITADO` | **P1 — 6 filtros apareciam na tela e não filtravam NADA** (`admin/Pedidos`). Implementados 5: `isPaid`, `productSku`, `containsProductSku`, `withBackorderedItems` (a query de `pedido_itens` já rodava — só passou a pedir `sku`/`backorder`/`produto_id`) e `category` (com subcategorias). **"Has Invoice?" foi REMOVIDO** — o cético provou que não é filtro esquecido, é **impossível**: não existe dado de nota por pedido, `enable_invoice` é config global |
| 162 | — | `EDITADO` | **PR1 — filtro de privacy group nunca achava nada** (`admin/Produtos`): o mapa era montado por `grupo_nome` e o filtro compara com o **id** do grupo. Agora traz `privacy_group_id` e indexa pelos dois (id + nome resolvido, pra linhas antigas). **`BUGS.md:85` marca isso como corrigido — está mentindo** |
| 163 | — | `EDITADO` | **PR4 — filtro de categoria no admin ignorava subcategorias.** O dropdown mostra a árvore inteira, mas comparava exato: escolher a categoria-pai devolvia quase nada, enquanto o portal (que usa `descendantIds`) mostra dezenas. Agora usa o mesmo `descendantIds` |
| 164 | — | `EDITADO` | **P3 + P5 + PR2 + E3 + I2 — teto de 1000 do PostgREST** em `admin/Pedidos`, `admin/Produtos`, `admin/Estoque` e `InventoryAdjustment`. Todas passaram a usar `fetchAllRows` (que já existia e já rodava nos 13 relatórios). **A base já tem ~884 pedidos** (`docs/AUDITORIA-SEGURANCA.md:46`) — não é hipótese, é o teto batendo em semanas. O `Total Quantity` também saía menor que o real: lote de 200 pedidos × 6 itens estoura 1000 |
| 165 | — | `EDITADO` | **E1 — dava pra salvar estoque NEGATIVO** e pra derrubar o total abaixo do reservado (produto ficava não comprável). Não há CHECK no banco. Agora: `min={0}`, validação no save, **releitura antes de gravar** e bloqueio quando `novaQtd < estoque_reservado`, com aviso na tela de quantas unidades já estão reservadas. Ironia que o cético apontou: a OUTRA tela de estoque já fazia isso — duas telas gravando a mesma coluna com regras opostas |
| 166 | — | `EDITADO` | **E2 + I1 — save absoluto sobre dado velho.** As duas telas gravam `estoque_total` ABSOLUTO usando o valor carregado no mount/abertura do diálogo: um pedido concluído no intervalo tinha a baixa **desfeita**, e o `estoque_log` registrava um "anterior" que nunca foi verdade. Agora as duas **releem antes de gravar** e recusam se o valor mudou, mandando reabrir. (O conserto definitivo é uma RPC de delta — anotado como assunto separado, não improvisei) |
| 167 | — | `EDITADO` | **I4 — sucesso parcial apagava o trabalho.** Falhando 3 de 30 linhas, a grade era limpa inteira e as 3 voltavam ao valor antigo sem marcação; o toast nomeava só a primeira. Agora as falhas aparecem **listadas na tela**, e só as linhas que realmente entraram são limpas |
| 168 | — | `EDITADO` | **P4 + PR3 + E3 + I3 — erro de fetch virando "vazio".** Os 4 são o mesmo defeito: query falha → lista vazia → tela diz "No orders/products found", indistinguível de banco vazio. Feito num passe só, com `try/catch` + toast |
| 169 | — | `FEITO` | **Ruído, conforme o cético — NÃO mexi**: P6 (o `toggleAll` está errado, mas `selected` **não é consumido por nada** — a coluna de checkbox é decorativa; o achado real é UI morta), E4 (a causa concreta já foi fechada em `20260706120000`), P7 (`p.total || p.subtotal` só engana com cupom de 100% e sem frete), I4-parcial |
| 170 | — | `FEITO` | **Validado**: `npm run typecheck` (comando CERTO) 0 erros · 46 testes · `npm run build` (agora typechecando) limpo |

### Configurações — varredura com 2 caçadores + cético (03/ago)

| # | Hora | Estado | O que |
|---|---|---|---|
| 171 | — | `FEITO` | 2 caçadores (notificações/e-mail e imposto/frete/pagamento/cupom) + 1 cético. **Cético derrubou 2 de 20**; os outros 18 se sustentaram. Ele revisou também as MINHAS correções — nenhuma quebrou lógica |
| 172 | — | `EDITADO` | **IMPOSTO (cobrança errada)** — marcar classe/grupo como padrão não desmarcava os outros. Com 2 padrões, o checkout usa `.maybeSingle()`, ERRA, e a tela mostra imposto ZERO; o trigger usa `LIMIT 1`, calcula, e o checkout cobra o total do banco → **cliente pagava mais do que via**. Dono conferiu no banco: 1 e 1, **nunca chegou a acontecer**. Correção é preventiva |
| 173 | — | `EDITADO` | **FRETE GRÁTIS POR ENGANO** — `Checkout.tsx:421` comparava país com o literal "United States"; regra de Canada/UK nunca casava e caía no fallback = 0. Agora compara com `clientes.pais` |
| 174 | — | `EDITADO` | **FRETE NÃO ERA VALIDADO NO SERVIDOR** (`20260803130000`) — o trigger só calculava frete pra opção SEM condições, e toda opção criada pela tela TEM (o form nasce com uma linha). Na prática 100% do frete vinha do navegador. **Reprovado na 1ª revisão**: recalcular em todo UPDATE re-precificaria pedido JÁ PAGO e apagaria o frete manual do admin. Corrigido com guarda de UPDATE + desempate determinístico (`WITH ORDINALITY`) + estado só do endereço de entrega + arredondamento em 2 casas. **2ª revisão: aprovado** |
| 175 | — | `EDITADO` | **REGRA DE IMPOSTO EM CLASSE ERRADA = imposto zero em silêncio.** Diálogo agora lista só a classe padrão. **O cético pegou que a minha 1ª correção CRIARIA o bug**: o preset era `classes[0]` (ordem por nome), não a padrão. A classe da regra atual continua visível ao editar, marcada como não usada |
| 176 | — | `EDITADO` | **CUPOM morria 1 dia antes** — data final virava 00:00. Agora grava fim do dia |
| 177 | — | `EDITADO` | **9 telas com save/delete MUDO** (diziam "Updated"/"Deleted" sem checar erro): SalesTax, Coupons, PaymentOptions, PrivacyGroups, QuickLinks, MeasurementUnit, ApiKeys, CompanyActivities, ProductStatuses. As 2 que mais pesam: **grupo de privacidade** (decide quem vê o quê) e **chave de API** (achar que revogou acesso que continua valendo) |
| 178 | — | `FEITO` | **Dono corrigiu uma premissa minha**: pagamento por lá não processa nada, o cliente só escolhe a forma. Então `gateway_config` não guarda segredo — o achado de vazamento vira precaução. Mantida a restrição de colunas no `select` do checkout |
| 179 | — | `FEITO` | **Dono rodou os 2 SQL** (`20260803120000` desfazer conclusão + `20260803130000` frete), as verificações voltaram vazias, e **fez o publish** |

### ⚠️ CONFIRMADO PELO CÉTICO E NÃO CORRIGIDO (mudam comportamento — decisão do dono)

| # | O que |
|---|---|
| N1 | **Aba Events não controla os e-mails de pedido.** Desmarcar "Email"/"Notify customer" em New order salva e não para nada — os e-mails saem por `send-email`, que só lê `configuracoes.email_on_*` |
| N2 | **Campos de SMTP da tela são decorativos** — `send-email` só lê os secrets do Supabase. Trocar de servidor pela tela é impossível |
| N3 | **Remetente da aba Channels** só vale pra low_stock/teste; e-mail de pedido usa `configuracoes.email_from` |
| N4 | **Religar o canal Email ressuscita os 5 gatilhos** que o admin tinha desmarcado em Email Settings |
| N5 | **"Send test" não testa o caminho real** (só Resend, sem o fallback Office365 que o envio de produção tem) |
| N6 | **"Excluir" a config de e-mail não para os envios** — o diálogo afirma que para |
| N7 | **Histórico de notificações**: erro de leitura vira "nenhuma notificação"; e `skip:` (canal desligado de propósito) aparece com selo vermelho de falha |
| N8 | **"Rule Type" do frete (por item) é gravado e ignorado** — configurar "por item $10" cobra $10 num pedido de 20 itens |
| N9 | **Taxa de pagamento (% ou valor), `cobrar_checkout`, `due_in_days`** — gravados, nunca entram no total |
| N10 | **"Set default" do frete** grava `padrao`, que o checkout não lê (não pré-seleciona nada) |
| N11 | **Config de gateway** (`gateway_type`/`gateway_config`) não é lida por nada — inofensivo, já que o pagamento não é processado no sistema |
| N12 | Cartão cobra o total do BANCO sem avisar se diferir do exibido (janela estreita; o valor cobrado é o correto) |
| N13 | Tela do pedido mostra frete manual que o trigger descartou (número gravado certo, tela mente até recarregar) |
| N14 | **Opção de frete sem condições**: abrir e salvar no admin injeta uma condição padrão e o "grátis acima de X" para de valer |

### 🔍 NUNCA VARRIDOS
Profile · UsersManagement · ExtraFields · SetupApp · WarehouseSettings · B2BWaveSync · OauthApplications · ActivityLogs · edge functions além de `company-member` · `producao/*` · `reports/*`

### 🔴 CARRINHO QUEBRADO PRA TODO MUNDO — erro meu, achado pelo agente

| # | Hora | Estado | O que |
|---|---|---|---|
| 147 | — | `FEITO` | **Dono relatou: no "View as" não consegue adicionar nada ao carrinho.** Não era do view-as: **o carrinho estava quebrado para TODOS** — cliente real, sub-login, todo mundo. Ele é admin e testa por ali, então foi por ali que apareceu |
| 148 | — | `FEITO` | **CAUSA — erro meu no commit `b3d7a59`.** Ao mover `cartKey` pra `@/lib/stock`, escrevi `export { cartKey } from "@/lib/stock"` no `CartContext`. Re-export **repassa o símbolo pra quem importa, mas NÃO cria binding local** (regra da spec ESM). O `cartKey` usado DENTRO do próprio arquivo (`addItem`, `removeItem`, `updateQuantity`) virou global inexistente → `ReferenceError: cartKey is not defined` a cada clique |
| 149 | — | `FEITO` | **Por que ninguém viu erro na tela**: `handleAdd` é `async`, então o ReferenceError vira **unhandled rejection** — não derruba nada, não mostra nada. E o `toast.success` está **depois** do `addItem`, então o aviso verde nunca aparecia. Botão habilitado, clique, e nada acontece. O contador do carrinho ficava em 0 |
| 150 | — | `FEITO` | **PROVA no bundle de produção**: no `dist`, tudo minificado em letras únicas **menos `cartKey`**, que sobrou com o nome cru porque o bundler o tratou como global externo. Não era teoria — era o código rodando |
| 151 | — | `EDITADO` | **Corrigido**: `import { cartKey } from "@/lib/stock"; export { cartKey };`. Precisa das duas linhas — o `import` cria o binding local, o `export` mantém `Carrinho.tsx`/`Checkout.tsx` funcionando. Conferido no bundle novo: `grep -c cartKey dist/assets/*.js` → **0** (agora minifica junto) |
| 152 | — | `FEITO` | **CAUSA RAIZ DE EU NÃO TER PEGO: meu `npx tsc --noEmit` não verificava NADA.** O `tsconfig.json` da raiz tem `"files": []` + `references`, então ele sai com **exit 0 sem compilar uma linha**. Eu venho reportando "typecheck limpo" há dias com base nisso. O comando real é `tsc -p tsconfig.app.json --noEmit` — e ele acusava **14 erros**, incluindo os 5 do `cartKey` |
| 153 | — | `EDITADO` | **Fechada a causa raiz**: `package.json` → `"build": "tsc -p tsconfig.app.json --noEmit && vite build"` e novo script `"typecheck"`. Antes o build era só `vite build`, que **não typecheca** — por isso um `ReferenceError` garantido foi pro ar |
| 154 | — | `EDITADO` | **Zerados os 14 erros.** Meus: `cartKey` (5), `PortalLayout:198` (`CatNode` × `Categoria`), `Checkout:600` e `Pedidos:130-138` (`variante_id` não está nos types gerados — a migration `20260802130000` rodou mas o `types.ts` não foi regerado). Pré-existentes: `CustomerEdit:195` (enum de `status`) e `Relatorios:53` (acumulador do `reduce` inferido do `{}` vazio) |
| 155 | — | `AGUARDANDO` | **Regerar `src/integrations/supabase/types.ts`** contra o schema atual — hoje ele não conhece `pedido_itens.variante_id` e por isso precisei de `as any` em 2 pontos. Não é urgente, mas o cast esconde erro de verdade |
| 156 | — | `FEITO` | **Validado com o comando CERTO**: `tsc -p tsconfig.app.json --noEmit` **0 erros** · `npm run build` (agora com typecheck) limpo · 46 testes passando |

| 157 | — | `FEITO` | **Dono publicou ANTES do fix** (o publish pegou o commit `6ca86cd`, ainda com o carrinho quebrado). Avisado na hora; ele republicou com o `b11fcc3`. **Publish atual = b11fcc3** |
| 158 | — | `AGUARDANDO` | **Confirmar em produção que o carrinho voltou**: adicionar produto → aviso verde + contador subindo. Junto, o que foi ao ar neste publish e nunca foi testado: barra de subcategorias na folha, guarda de ciclo, produto de categoria desativada, importação de categorias e de clientes (as duas estavam 100% quebradas), estoque por variante, re-order com variante, validação do ProductEdit |

### P5 confirmada pelo banco — as DUAS importações estavam quebradas

| # | Hora | Estado | O que |
|---|---|---|---|
| 141 | — | `FEITO` | **Prova do banco** (dono rodou `pg_indexes`): `categorias` → só `categorias_pkey (id)`. `clientes` → só `clientes_pkey (id)` e `clientes_user_id_unique (user_id)`. Confirma o cético: **não existe UNIQUE em `categorias.nome` nem em `clientes.email`**, logo `ON CONFLICT` nesses campos dá `42P10` em toda linha |
| 142 | — | `FEITO` | **Consequência**: `ImportCategories` e `ImportCustomers` **nunca funcionaram**, para nenhuma linha. A P4 que eu tinha "corrigido" (omitir `ordem`) era irrelevante — o código nem chegava ao insert. Registro do meu erro: escrevi no comentário do fix um erro de NOT NULL que **nunca foi observado rodando**; foi dedução minha, e o cético cobrou a prova antes do publish. Estava certo |
| 143 | — | `EDITADO` | **`ImportCategories` refeito** — busca por **(nome, parent_id)** e faz UPDATE ou INSERT. Criar UNIQUE em `nome` seria **ERRADO**: o sistema tem categorias homônimas de propósito em locais diferentes ("One Plus" em 3 estados — o próprio código de Produção comenta isso). Nome não identifica categoria; nome + pai identifica. `ordem` em branco é omitida no insert (o `DEFAULT 0` age) e **não é tocada** no update, preservando o valor atual |
| 144 | — | `EDITADO` | **`ImportCustomers` refeito** — mesmo defeito, mesmo remédio: UPDATE quando o e-mail já existe (usando o `existingEmails` que a tela **já carregava** logo acima) e INSERT quando não. Não criei UNIQUE em `email` porque isso exigiria decidir o que fazer com duplicatas que já estejam na base — decisão do dono, não minha |
| 145 | — | `FEITO` | **Os outros importadores estão OK** — conferi contra as migrations: `ImportProductDiscounts` e `TabelasPreco` gravam em `tabela_preco_itens`, que **tem** `UNIQUE(tabela_preco_id, produto_id)` (`20260318182853:28`); `ImportCustomerPrices` grava em `produto_precos_cliente`, que tem `UNIQUE(produto_id, cliente_id)`; os `onConflict: "user_id"` batem com `user_roles_user_id_unique`. Só os dois acima estavam quebrados |
| 146 | — | `FEITO` | **Achado de fundo**: a `UNIQUE (email)` que aparece nas migrations é da **`company_contacts`** (`20260408000001:20`), tabela **dropada** em `20260622000000`. Provavelmente foi de onde veio a suposição de que `clientes.email` era único |

### ⚠️ Duas coisas que o cético deixou EM ABERTO

| # | Estado | O que |
|---|---|---|
| ~~**P5**~~ | `RESOLVIDO 03/ago` | ✅ **CONFIRMADO PELO BANCO e corrigido — era MUITO pior que a P4.** O dono rodou as duas queries: `categorias` só tem `categorias_pkey` (em `id`); `clientes` só tem `clientes_pkey` e `clientes_user_id_unique`. **Nenhuma UNIQUE em `categorias.nome` nem em `clientes.email`** → o `onConflict` rejeitava TODA linha com 42P10 e **as duas importações estavam 100% quebradas** — não só quando `ordem` vinha vazia. O cético estava certo em exigir a prova antes de eu dar a P4 por corrigida. Detalhes em 141-144 |
| ~~**P5-antigo**~~ | `HISTÓRICO` | **A P4 pode não estar corrigida — e a P4 nunca foi reproduzida.** `ImportCategories.tsx` usa `{ onConflict: "nome" }`, mas varrendo as **147 migrations não existe UNIQUE em `categorias.nome`**. Sem esse índice, o upsert falha com `42P10` em TODA linha e o ajuste do `ordem` é irrelevante. O cético foi honesto: o erro de NOT NULL que motivou a P4 **nunca foi visto rodando** — a P4 é análise estática, e o comentário que escrevi no código afirma um erro não observado. Como o SQL vai direto no Lovable, o índice pode existir fora do repo. **Resolver com uma query antes do publish**: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'categorias';` — se não vier índice único em `nome`, a P4 volta pra fila. **Mesma dúvida em `ImportCustomers.tsx:101`** (`onConflict: "email"`, e `clientes.email` também não tem UNIQUE nas migrations) |
| **P6** | `AGUARDANDO DECISÃO` | **A trava de ciclo é só de UI, e o ciclo VELHO é insalvável pelo admin.** (a) O importador de CSV continua podendo **criar** ciclo: o upsert por nome re-parenteia pra qualquer `parent_name`, inclusive uma descendente, sem validação. (b) Se já existir um ciclo hoje, as categorias envolvidas **não aparecem na lista do admin** (`Categorias.tsx:238` monta a tabela só a partir de `rootCats`, e nó de ciclo não tem `parent_id` nulo) — sem botão de editar, só SQL resolve. Assimetria que reforça: o portal usa `rootCategories()` (conta órfã como raiz), o admin usa o `filter` cru — o único lugar que precisava é o único que não tem. **Decisão**: entra trava no banco (trigger/CHECK)? Antes disso vale rodar a detecção pra saber se existe ciclo hoje |


### Fim do dia 02/ago — tudo aplicado, testes ficam pra 03/ago

| # | Hora | Estado | O que |
|---|---|---|---|
| 112 | — | `FEITO` | **Dono rodou o SQL do `variante_id` E fez o publish.** Ou seja: **não há mais SQL pendente** e o código do GitHub está em produção. Palavras dele: *"JA fiz os dois...vamos esperar os testes amanha"* |
| 113 | — | `AGUARDANDO` | **Testes reais em produção ficam pra 03/ago**, com o dono. Lista do que precisa de login e eu não consigo validar daqui: (1) carrinho do view-as isolado por cliente + "DELETE ALL" não apagar o do admin; (2) sub-login salvando endereço novo no checkout; (3) duas variantes do mesmo produto estourando o estoque juntas → tem que bloquear; (4) 10 de um tamanho que só tem 2 → tem que bloquear (bug 35); (5) re-order trazendo a variante certa (bug 36); (6) export do histórico completo; (7) override manual de preço na linha do pedido; (8) ProductEdit: clicar "Add discount" e salvar SEM escolher a tabela → tem que avisar e **não apagar** os descontos existentes; (9) relatórios do admin carregando com dados reais |
| 114 | — | `AGUARDANDO` | **Teste extra que o SQL de hoje exige** — a leitura anônima fechou `produtos`, `categorias`, `payment_options` e `shipping_options`. Cliente **logado** não deveria sentir diferença nenhuma, mas catálogo e checkout precisam ser abertos pra confirmar que continuam normais |
| 115 | — | `AGUARDANDO` | **Continua sem varredura nenhuma** (os agentes morreram por quota, ninguém olhou): admin Pedidos, admin Estoque, lista de Produtos, `tools/Import*`, e as edge functions fora da `company-member` |
| 116 | — | `LEMBRETE` | **A pendência P1 (desconto por quantidade) segue ABERTA e no topo deste arquivo.** O dono pediu explicitamente pra não deixar cair: *"coloque como pendencia..?NAo pode esqeucer"*. Ele vai testar e responder em 03/ago |

### Correção dos 3 riscos que sobraram (02/ago)

| # | Hora | Estado | O que |
|---|---|---|---|
| 87 | — | `FEITO` | **Dono mandou corrigir tudo. Comissão: IGNORAR** — ele confirmou que a comissão do representante **não é calculada no sistema**. Pendência encerrada, não é bug |
| 88 | — | `EDITADO` | **BUG 35 CORRIGIDO — estoque por variante.** Criado `src/lib/stock.ts` com `checkCartStock()`, **regra única** para os 3 pontos que antes validavam cada um do seu jeito (watcher do Carrinho, aviso do Checkout, re-validação do submit). Agora valem as DUAS regras juntas: (a) a linha não passa de `produto_variantes.quantidade`; (b) a SOMA das linhas do mesmo produto não passa de `estoque_total - estoque_reservado`. Pré-venda ignora as duas, de propósito |
| 89 | — | `EDITADO` | **`unavailableItems`/`insufficientItems` re-chaveados de `produto_id` para `cartKey`** — com duas variantes do mesmo produto, chavear por produto marcava as DUAS linhas quando só uma estava sem estoque |
| 90 | — | `EDITADO` | **`cartKey` mudou de casa** — saiu do `CartContext` (que importa o cliente Supabase) para `@/lib/stock`, e o CartContext **re-exporta**. Sem isso o teste não rodava: importar a chave arrastava o `createClient` junto e quebrava com "supabaseUrl is required" |
| 91 | — | `FEITO` | **18 testes novos** em `src/lib/stock.test.ts`, cobrindo os dois bugs de estoque como caso nomeado: "6+6 com estoque 10 acusa as duas linhas", "10 do tamanho M que só tem 2 acusa com teto 2", "a outra variante do mesmo produto continua livre", "variante apagada bloqueia e não vira estoque do produto", "pré-venda ignora os dois tetos". **19/19 passando** (com o example.test.ts) |
| 92 | — | `AGUARDANDO` | **BUG 36 — SQL criado**: `supabase/migrations/20260802130000_pedido_itens_variante_id.sql` adiciona `pedido_itens.variante_id` (uuid, anulável, FK `ON DELETE SET NULL`). **Sem backfill de propósito** — a variante dos pedidos antigos só existe como texto no `nome_produto`, e chutar seria pior que deixar NULL. **Falta o dono rodar** |
| 93 | — | `EDITADO` | **Bug 36, lado do app** — o Checkout agora grava `variante_id` na linha do pedido, e o RE-ORDER passou a usar essa coluna nos DOIS lugares (`Pedidos.tsx:handleReorder` e `PedidoDetalhe.tsx:handleAddToOrder`): remonta a variante certa, o rótulo, o SKU, a imagem e o estoque com o teto da variante. Se a variante foi apagada/desativada desde o pedido, a linha **não** é re-adicionada — avisa em vez de mandar o produto errado de novo |
| 94 | — | `EDITADO` | **`formatOpcao` promovido a `src/lib/variants.ts`** — morava dentro do `ProdutoDetalhe.tsx`, e o re-order precisava do mesmo rótulo pra remontar a variante |
| 95 | — | `EDITADO` | **BUGS 54/55/56 CORRIGIDOS — `ProductEdit.saveSubData`.** (a) **Validação ANTES de qualquer DELETE**: os botões "Add" criam a linha com o campo-chave **vazio** (`tabela_preco_id: ""` na linha 606, `cliente_id: ""` na 651, `tabela_preco_id: ""` na 922, `status_nome: ""` na 967) e `""` não é uuid válido — bastava clicar Add e salvar sem escolher pra **apagar os descontos** e o insert falhar. Agora lança antes, com a lista do que corrigir e **nada é apagado**. (b) Os **11 DELETE** passaram a ser checados (`delOrFail`): um delete barrado por RLS passava calado e o INSERT batia em chave duplicada (`tabela_preco_itens` tem `UNIQUE(tabela_preco_id, produto_id)`) com mensagem que não explicava nada |
| 96 | — | `FEITO` | **Validado**: `npx tsc --noEmit` limpo · **19/19 testes** passando · `npx vite build` limpo · dev server sobe, home carrega, **zero erro de console e zero erro de servidor**. O caminho de erro do `handleSave` conferido linha a linha: o `catch` sai **antes** do `toast.success` e antes do `log()` — não declara sucesso falso |
| 97 | — | `AGUARDANDO` | **Não corrigi, precisa de decisão sua**: (a) desconto "global" — `produto_descontos.tabela_preco_id` é NOT NULL e os dois lados têm código morto esperando o NULL; tornar anulável muda a semântica de preço, não faço sem seu aval; (b) `produto_descontos` e `produto_arquivos` legíveis **sem login** — pode ser catálogo público de propósito; (c) pedido mínimo — não existe em lugar nenhum, é feature; (d) ~~Stripe reserva estoque antes de cobrar~~ — **ver 99** |
| 99 | — | `CORRIGIDO NO TEXTO` | **Ressalva ao 97(d) — erro meu.** Listei o Stripe como risco em aberto sem conferir a documentação. O dono apontou que não usam pagamento por lá, e **já estava escrito**: `docs/STATUS-GO-LIVE.md:82` ("Stripe desligado de propósito (criado, desabilitado). Reativar quando for usar") e `docs/HANDOFF-2026-07-26.md:17` ("o Stripe não processa pagamento de verdade"). No código o caminho é fechado por flag: `Checkout.tsx:224` só entra em `if (cfg?.stripe_enabled && cfg?.stripe_publishable_key)`, e `stripe_enabled` nasce `DEFAULT false` (`20260408000002:15`). **Com o Stripe desligado o bug 39 é inalcançável** — vira pré-requisito de quando/se ligarem, não pendência atual |
| 98 | — | `AGUARDANDO` | **Nunca varridos** (os agentes morreram por quota): admin Pedidos, admin Estoque, lista de Produtos, `tools/Import*`, edge functions além da `company-member` |

| 69 | — | `FEITO` | **Nota**: isso é DIFERENTE do bug 35/57 (estoque por variante ignorado). O 68 é o mesmo produto contado duas vezes; o 35 continua aberto — `produto_variantes.quantidade` existe e o carrinho não olha. Só a página do produto olha (`ProdutoDetalhe.tsx:171` `effectiveDisponivel`), então o furo é entrar pela página (que valida certo), mudar a quantidade **no carrinho** e passar |

### Os 3 críticos de trigger — SQL escrito (pendente do dono rodar)

| # | Hora | Estado | O que |
|---|---|---|---|
| 70 | — | `AGUARDANDO` | **SQL dos 3 críticos** — `supabase/migrations/20260801130000_fix_3_trigger_criticals.sql`. Estavam abertos desde 26/jul esperando decisão; escrevi os três de uma vez porque nenhum tem alternativa razoável (não é questão de preferência, é bug). **Falta o dono rodar no Lovable** |
| 71 | — | `FEITO` | **Crítico 1 (estoque) — como corrigi**: `UPDATE produtos p ... FROM pedido_itens pi` aplica **uma linha só por alvo** quando o produto se repete no pedido. Troquei o `FROM pedido_itens` por um subselect `SELECT produto_id, SUM(quantidade) ... GROUP BY produto_id` nas 3 pernas (cancelado / concluído / reativado) + nos 3 `estoque_log`. Assim o produto repetido vira uma linha só e o UPDATE volta a ser correto. **Isso conecta com o 68**: como variante não tem coluna em `pedido_itens`, produto repetido é o caso COMUM, não a exceção |
| 72 | — | `FEITO` | **Crítico 2 (cupom) — como corrigi**: `fn_pedido_total_appside` revalidava `uso_atual < uso_maximo` em TODO UPDATE, mas o checkout incrementa `uso_atual` **depois** do insert do pedido → num cupom de uso único, a 1ª mudança de status não achava mais o cupom, `NEW.desconto := 0` e **o total do cliente subia sozinho depois de ele já ter pago**. Agora a checagem de elegibilidade (ativo/datas/uso) roda **só no INSERT** (`TG_OP <> 'INSERT' OR (...)`); no UPDATE o valor é recalculado sobre o subtotal novo, sem re-validar |
| 73 | — | `FEITO` | **Crítico 3 (imposto) — como corrigi**: acrescentei `NEW.tax_customer_group_id := OLD.tax_customer_group_id;` em `fn_lock_privileged_cliente_cols`. Era a única coluna que o trigger de total de `pedidos` consulta e que o cliente ainda podia editar na própria linha |
| 74 | — | `FEITO` | **Achei mais um caminho pro crítico 2 (cupom) — pior que o suposto** — não é só mudança de STATUS. `OrderDetail.tsx:920` (Shipped qty) e `:929` (status da linha) dão `UPDATE` em `pedido_itens`; desde `20260730120000` o `trg_pedido_recompute_subtotal` é `AFTER INSERT OR UPDATE OR DELETE`, então **qualquer** um desses dá `UPDATE pedidos SET subtotal`, que roda `fn_pedido_total_appside` e zerava o desconto. Ou seja: o admin digitando a quantidade enviada **aumentava o total do cliente**. O fix do 72 fecha esse caminho junto |
| 75 | — | `FEITO` | **BUG (menor) — `OrderDetail.tsx` 3 updates fire-and-forget** — `:908` (backorder), `:920` (quantidade_enviada) e `:929` (status_linha) chamam `supabase.from("pedido_itens").update(...)` **sem `await` e sem checar erro**. Se a RLS/rede falhar, a tela mostra o valor novo e o banco fica com o antigo, sem aviso nenhum. O `saveItemPrice` logo acima faz certo (checa `error` e recarrega) — os três vizinhos não |
| 76 | — | `FEITO` | **Idem (menor) — `quantidade_enviada` grava a cada tecla** — `:917` é `onChange`, não `onBlur`: digitar "10" manda um UPDATE com 1 e outro com 10, e cada um dispara a cascata de triggers (subtotal → total). O campo de preço ao lado já usa `onBlur`/Enter — o padrão certo está no mesmo arquivo |
| 77 | — | `EDITADO` | **75 e 76 corrigidos** — `OrderDetail.tsx`: criei o helper `patchItem(itemId, patch, what)` (checa `error`, avisa e recarrega, igual ao `saveItemPrice`) e troquei os 3 updates soltos por ele. O `quantidade_enviada` passou pra `onBlur`+Enter e agora clampa em `[0, quantidade]` na gravação (o `max` do input só limita a setinha, não o que se digita) |

### Preço do sub-login (bugs 38/50 e 40/49)

| # | Hora | Estado | O que |
|---|---|---|---|
| 78 | — | `EDITADO` | **38 corrigido no CLIENTE** — `src/lib/pricing.ts`: resolve a conta com `parent_customer_id ?? id` e busca `produto_precos_cliente` pela conta da EMPRESA. O preço negociado é do PAI; o funcionário não casava nessa linha e via preço de tabela/base — **mesma compra, dois preços**. A tabela de preço usa a do próprio sub-login se houver, senão a da empresa (o trigger `trg_subuser_inherit_pricelist` copia no INSERT, mas é snapshot e fica velho) |
| 79 | — | `AGUARDANDO` | **38 corrigido no SERVIDOR (que é quem grava)** — `supabase/migrations/20260801140000_preco_subuser_parent_account.sql` reescreve `preco_autoritativo` com a mesma regra. **Este é o que importa de verdade**: `trg_pedido_item_preco` recalcula no INSERT do item, então sem esta migration o preço do pedido continua errado mesmo com o frontend certo. **Falta o dono rodar no Lovable** |
| 80 | — | `EDITADO` | **40/49 corrigido** — `resolveDiscount` filtrava as datas **em JS depois** do `.limit(50)`: 50 faixas expiradas do mesmo produto escondiam a válida e o cliente perdia o desconto. Agora filtra no banco (`.or("data_inicio.is.null,data_inicio.lte.…")`), igual ao servidor. Tirei os milissegundos do ISO porque o `.` é separador na sintaxe `col.op.valor` do PostgREST |
| 81 | — | `FEITO` | **48 revisto (não é bug do código, é do schema)** — mantive a perna `tabela_preco_id.is.null` no OR de propósito, com comentário: `produto_descontos.tabela_preco_id` é NOT NULL, então desconto "global" é inexpressável hoje; se a coluna virar nullable, o código já funciona. **Cliente sem tabela de preço continua sem nenhum desconto por quantidade** — decisão de schema, precisa o dono dizer se quer desconto global de verdade (aí é `ALTER COLUMN ... DROP NOT NULL`) |

## 2026-08-25 - Integracao ETA com o CONTAINER ZAP

- **FEITO** - commit `d84d7ce`. Rodada 3 do cacador/cetico fechada sem itens abertos.
- **FEITO** - `docs/integracao-container-zap/01-RODAR-NO-CONTAINER-ZAP.sql`: RPC `eta_por_containers`
  no projeto do tracker. Recebe a lista de containers, normaliza e devolve a melhor data.
- **FEITO** - `supabase/functions/sync-container-eta/index.ts`: leitura paginada, pula entregues,
  nao sobrescreve ETA manual quando a origem e a planilha.
- **FEITO** - `supabase/migrations/20260825120000_sync_eta_container.sql`: colunas + log + cron 06:20 UTC,
  em blocos separados (falha do cron nao derruba as colunas).
- **FEITO** - `supabase/config.toml`: `verify_jwt = false` pra funcao (senao o cron toma 401 no gateway).
- **FEITO** - `ProducaoStatus.tsx`: painel do ultimo sync + selo de origem no ETA, com fallback
  na leitura E na escrita (publicar a UI antes do SQL nao quebra a tela nem perde o save).
- **AGUARDANDO** - dono rodar: SQL nos dois projetos -> secrets -> deploy da edge -> publish.
- **PENDENTE** - P-A: Container # e Tracking # ainda nao se espelham (`docs/integracao-container-zap/PENDENCIAS.md`).

### 25/08 15:35 UTC - FUNCIONANDO EM PRODUCAO

- **FEITO** - dono rodou SQL 1 (tracker), SQL 2 e SQL 3 (PermShield), criou os 2 secrets do tracker
  e pediu o deploy da edge pelo chat do Lovable.
- **FEITO** - teste ponta a ponta: `16 lidos / 13 casados / 13 atualizados / 0 erros / ok = true`.
- **BLOQUEIO RESOLVIDO** - 1a tentativa deu 404: o Lovable nao tinha deployado a edge function
  mesmo com o commit no GitHub. Resolvido pedindo o deploy no chat do Lovable.
- **BLOQUEIO RESOLVIDO** - 2a tentativa deu `Invalid URL` — o secret TRACKER_SUPABASE_URL foi
  salvo COM aspas (`"https://..."`), copiado direto do .env. Corrigido no painel + commit `c63ce1e`
  faz a funcao tolerar aspas nos dois secrets do tracker.
- **NOTA** - o log foi o que permitiu achar as duas falhas em minutos: sem ele, o sintoma seria
  "o ETA nao atualiza" sem nenhuma pista.
- **PENDENTE** - P-A: Container # e Tracking # ainda nao se espelham na tela.

### 25/08 - P-A: espelhar Container # e Tracking #

- **FEITO** - regra extraida para `src/lib/espelhoContainer.ts` + 19 testes.
  Editor espelha Container->Tracking; lista espelha Tracking->Container so quando
  o container esta VAZIO.
- **BLOQUEIO RESOLVIDO** - 1a versao (simetrica) DESTRUIA o container real:
  depois do 1o espelho os campos ficam iguais e a regra `outro === antigo` nao
  distingue mais "acompanhando" de "digitado de proposito". Salvar um numero de
  courier no Tracking apagava o container — num campo que a lista nem exibe, e
  que e a chave do sync de ETA.
- **FEITO** - 3 rodadas cacador/cetico. Fechado sem itens abertos.
- **AGUARDANDO** - dono publicar. NAO precisa de SQL nem de secret.

### 25/08 17:00 UTC - INCIDENTE: 1281 SMS disparados (CAUSA MINHA)

- **BLOQUEIO** - corrigi a paginacao da API de pedidos do B2BWave (que so trazia
  9 pedidos porque `?page=N` e ignorado; o certo e `paginated=1&per_page=500`).
  O sync passou a reconciliar 1.147 pedidos de uma vez, e o gatilho
  `trg_order_status_notify` mandou 1 SMS POR PEDIDO. 1281 aceitos pela Twilio,
  227 falhados — e cada falha gerou um e-mail de alerta ao admin, sem teto.
  Custo real para o dono.
- **FEITO** - estancado: fila do pg_net esvaziada, canais/eventos desligados,
  gatilho desabilitado, todos os crons removidos.
- **FEITO** - `docs/INCIDENTE-2026-08-25-sms.md` com a analise completa.
- **FEITO** - `20260825180000_teto_notificacao.sql`: supressao em massa + teto
  sincrono (20/h order_status, 10/h low_stock) + teto no alerta ao admin (5/h).
  O gatilho fica DESLIGADO; religar e passo manual verificado.
- **FEITO** - cabecalho obrigatorio em `b2bwave-sync/index.ts` e em
  `_shared/dispatch.ts`: operacao que toca mais de um pedido TEM que suprimir
  notificacao antes.
- **NOTA** - a 1a versao das travas foi REPROVADA na revisao e nao chegou a ser
  executada: a supressao era codigo morto, o teto lia o log (1-3s de atraso) e
  deixaria passar ~100 SMS, e o ENABLE TRIGGER podia abortar a migration.
- **AGUARDANDO** - dono: teto de gasto na Twilio (Billing > Usage triggers).
  E a unica protecao que nao depende deste codigo estar certo.
- **AGUARDANDO** - revisao da 2a versao antes de qualquer SQL ser rodado.

### 25/08 - Varredura ampla (notificacoes, seguranca, carrinho)

- **FEITO** - item 1 (barreira de idade / nada retroativo) FECHADO apos 7 rodadas
  de cacador+cetico e 10 versoes minhas reprovadas. Ressalva do cetico registrada:
  a marca `notificavel` e pegajosa, o teto de 7 dias protege o MOMENTO da
  importacao e nao a vida do pedido. Falta a prova real (um ciclo de sync com zero
  envios no log).
- **FEITO** - `docs/PENDENCIAS-2026-08-25.md` com a fila completa, 11 itens.
- **CONFIRMADO NO BANCO** - vazamento de `produto_descontos` e satelites: qualquer
  cadastrado le a regua de desconto e o preco final de TODAS as tabelas de preco.
  A migration de isolamento de price list esqueceu essa tabela.
- **CONFIRMADO** - validacao de cupom morta em 100% dos pedidos (elegibilidade so
  checada no INSERT, e o recalculo de subtotal reaplica sem conferir).
- **CONFIRMADO** - preco exibido pode divergir do cobrado; sem comparacao antes do
  Stripe.
- **NOTA DO DONO** - o sistema NAO esta no ar ainda. Nada esta sangrando hoje;
  tudo vira prejuizo no lancamento.
- **PROXIMO** - item 2: fechar o vazamento das tabelas satelite.


### 25/08 (noite) - Achado mais grave do dia: cliente escolhia o proprio preco

- **ACHADO** - `pedidos.b2bwave_order_id` e gravavel pelo CLIENTE, e e o predicado
  de isencao de meia duzia de triggers: preco autoritativo do item, recalculo de
  subtotal, desconto/imposto/frete/total, reserva de estoque, e a nova exigencia
  de variante. Mandando essa coluna no insert, o cliente ficava isento de TODOS os
  recalculos: preco vira campo livre e o estoque nao e reservado.
  Existe desde 20260622220000 - NAO e regressao minha.
  Encontrado pelo cetico enquanto revisava OUTRA coisa (o gatilho de variante).
- **FEITO** - `20260825230000_trava_b2bwave_order_id.sql`: trigger BEFORE
  INSERT/UPDATE que zera o campo quando `auth.role()` nao e `service_role`.
  Prefixo `a_` no nome para rodar antes dos demais BEFORE (ordem alfabetica),
  senao os outros leriam o valor antes de ser zerado.
- **FEITO** - corrigido rodape de `20260825220000`: eu tinha escrito que o gatilho
  de variante "fecha o caminho do CLIENTE". Era falso - pela mesma isencao o
  cliente escapava dele tambem.
- **FEITO** - `ITEM_VARIANT_MISMATCH` traduzido no Checkout e no admin (antes caia
  no else e mostrava a mensagem crua do banco na tela).
- **VERIFICADO NO BANCO (dono rodou)** - `SELECT ... WHERE b2bwave_order_id IS NOT
  NULL AND numero IS DISTINCT FROM b2bwave_order_id` = **zero linhas**. Ninguem
  explorou a brecha; todo pedido com esse campo veio do sync.
- **AGUARDANDO** - cacador na trava (auth.role() em cada caminho, ordem dos
  triggers BEFORE, e busca por OUTRA coluna com o mesmo problema).
- Commit `daf5595`, empurrado. Migration NAO rodada ainda.

### 25/08 (noite, cont.) - O cacador achou 2 furos MAIORES na mesma porta

O furo do `b2bwave_order_id` era um sintoma. A doenca e a policy de INSERT do
cliente em `pedidos`: ela so valida "o pedido e meu" e nao diz NADA sobre quais
colunas. O Checkout manda um conjunto educado; um POST cru manda o que quiser.

- **CRITICO** - `is_paid` gravavel no INSERT: pedido NASCE PAGO. Nenhum trigger
  le ou escreve essa coluna (procurado nas 158 migrations). Agrava: o
  `stripe-checkout` e idempotente por `.eq("is_paid", false)`, entao o webhook
  legitimo vira no-op e nao da nem para reconciliar depois.
- **CRITICO** - `status` gravavel no INSERT: pedido NASCE 'complete'. E
  `fn_adjust_stock_on_order_status` e AFTER **UPDATE** — nascer completo nunca
  dispara a baixa, e a reserva feita no item fica presa PARA SEMPRE.
  As revisoes anteriores olharam o caminho de UPDATE dessas duas colunas e
  concluiram "a RLS bloqueia" (e bloqueia). Ninguem olhou o INSERT.
- **FEITO** - `20260825240000_trava_colunas_pedido.sql`: BEFORE INSERT que forca
  is_paid=false, payment_intent_id=NULL, status='recebido', notificavel=true,
  data_origem=NULL, tracking_number/admin_notes=NULL, created_at=now().
  Isenta service_role, conexao direta e admin/manager (a tela de admin cria com
  status 'submitted' de proposito). O Checkout do cliente nao manda essas
  colunas, entao o caminho legitimo do portal nao muda.

- **FURO NA MINHA PROPRIA TRAVA** - `auth.role()` e NULL no SQL editor do Lovable
  (conexao direta nao passa por PostgREST). O ramo de UPDATE da 20260825230000
  RESTAURA o valor antigo, entao `UPDATE pedidos SET b2bwave_order_id = NULL`
  rodado no editor seria silenciosamente revertido — e o editor e o unico
  caminho que o dono usa. A trava viraria armadilha: a propria consulta de
  diagnostico manda procurar pedidos forjados e depois nao deixaria limpa-los.
  Corrigido com `auth.role() IS NULL OR auth.role() = 'service_role'`.

- **CONFIRMADO POR MIM (grep nas 11 policies)** - o desfazer do checkout NUNCA
  funcionou. `Checkout.tsx` fazia `.delete()` e `.update({status:'cancelled'})`
  direto na tabela em 3 pontos; o cliente nao tem policy de DELETE nem de UPDATE
  em `pedidos`, e o supabase-js nao levanta erro quando a RLS filtra tudo.
  Toda falha no insert dos itens deixava um PEDIDO ORFAO com o total que o
  navegador mandou e zero itens, visivel no historico e na lista do admin.
  E ficou mais provavel com o `trg_item_exige_variante` de hoje.
- **FEITO** - `20260825250000_rollback_checkout.sql`: RPC
  `pedido_rollback_checkout` (SECURITY DEFINER) que confere posse, idade < 30min
  e contagem de itens; apaga o pedido vazio, ou marca 'cancelled' JUNTO com
  `notificavel = false` — senao o cancelamento dispararia SMS para o cliente que
  esta parado na tela de erro. Checkout religado nos 3 pontos.

- **VIGIA PROVADA (mutantes)** - plantei 2 defeitos em `src/lib/stock.ts:123`:
  (1) protecao desligada (`else if (false)`) -> 1 teste acendeu;
  (2) condicao invertida -> 4 testes acenderam, incluindo os de CONTROLE que
  provam que produto sem opcao continua passando. Arquivo restaurado, 68 verdes.

- **AGUARDANDO** - cetico nas migrations 230000 e 240000.
