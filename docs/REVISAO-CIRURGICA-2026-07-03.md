# Revisão cirúrgica — handoff (2026-07-03)

> Documento de handoff. Objetivo: quem pegar isto trabalha **exatamente** onde foi mexido,
> com os arquivos, funções e linhas exatas + as funções de referência a comparar.
> Modo: cirúrgico (mínima alteração, não quebrar produção). Commit da correção: `39f041d`.

---

## 1) O que já tínhamos feito ANTES (batch de features, jul/2026)

Todas no `main`. Doc técnico completo: `docs/MUDANCAS-SOLICITADAS.md`.

| # | Mudança | Área | Arquivo(s) | Commit |
|---|---------|------|-----------|--------|
| — | Dropdown de produto agrupa por categoria REAL (path "Estado › One Plus") | Produção | `src/pages/admin/producao/ProducaoEntrada.tsx`, `ProducaoStatus.tsx` | `d1a4164` |
| 1 | Campo "Est Ready" (data) antes do ETA | Produção · New entry | `src/pages/admin/producao/ProducaoEntrada.tsx` | `1ae8d5f` |
| 2 | "Est. delivery" → "ETA" | Produção | `ProducaoEntrada.tsx`, `ProducaoStatus.tsx` | `1ae8d5f` |
| 3 | Seleção dividida: Categoria → Produto (filtrado) | Produção · New entry | `ProducaoEntrada.tsx` | `1ae8d5f` |
| 4 | Remover "Created", pôr "Est Ready" | Produção · Status | `ProducaoStatus.tsx` | `1ae8d5f` |
| 5 | Botão Duplicar entrada | Produção · Status | `ProducaoStatus.tsx` | `1ae8d5f` |
| 6 | Localização → itens inline (não popup) | Produção · Dashboard | `src/pages/admin/producao/ProducaoDashboard.tsx` | `1ae8d5f` |
| 7 | "Arriving" → "On the way" | Produção · Dashboard | `ProducaoDashboard.tsx` | `1ae8d5f` |
| 8 | Est Ready editável no diálogo | Produção · Status | `ProducaoStatus.tsx` | `1ae8d5f` |
| 9 | Add ao carrinho + finalizar sem preço ($0 = cotação) | Portal | `src/pages/portal/ProdutoDetalhe.tsx`, `Catalogo.tsx`, `Checkout.tsx` | `9875188` |
| 10 | "Save" salva+volta / "Save and stay" fica / "Back" só volta | Admin | `src/pages/admin/OrderDetail.tsx`, `CustomerEdit.tsx`, `ProductEdit.tsx` | `9875188` |
| 11 | Remover filtros Phone/Email/Country/Sales Rep/Submitted By | Admin · Pedidos | `src/pages/admin/Pedidos.tsx` | `9875188` |
| 12 | Impersonação ("view as") escopa privacidade por cliente | Portal | `src/components/layouts/PortalLayout.tsx`, `src/pages/portal/Catalogo.tsx` + migração `20260701130000` | `9a539a5` |

**Migrações do batch (já aplicadas):**
- `supabase/migrations/20260701120000_producao_est_ready.sql` — coluna `est_ready date` ✅
- `supabase/migrations/20260701130000_privacy_view_as_target.sql` — funções `categoria_visivel_para` /
  `produto_visivel_para` + RPCs `categorias_visiveis_cliente` / `produtos_visiveis_cliente` (staff-gated) ✅

---

## 2) Bugs ENCONTRADOS na revisão

Ambos **só no item 12** (privacidade da impersonação). Nada mais quebrado. `tsc --noEmit` → exit 0.
Ambos causavam **sobre-restrição no preview "view as"** (mostrava MENOS que a realidade) — **sem vazamento**.

### 🐞 Bug 1 — `categoria_visivel_para` ignorava `subcategorias_herdam`
- **Onde estava:** `supabase/migrations/20260701130000_privacy_view_as_target.sql`, função
  `public.categoria_visivel_para(_cat_id, _cli_id)` — a linha do nó governante era:
  `SELECT id INTO _gov FROM chain WHERE is_private ORDER BY depth LIMIT 1;`
- **Deveria espelhar:** `public.cliente_pode_ver_categoria` em
  `supabase/migrations/20260622200000_fix_subcat_inherit.sql`, que usa
  `WHERE is_private AND (depth = 0 OR subcategorias_herdam)`.
- **Efeito do bug:** categoria com pai privado que **NÃO cascateia** (`subcategorias_herdam = false`)
  era escondida no "view as" mesmo o cliente real vendo.

### 🐞 Bug 2 — `produto_visivel_para` não casava `produto_acesso` por `grupo_nome` (legado)
- **Onde estava:** mesma migração `20260701130000`, função
  `public.produto_visivel_para(_prod_id, _cli_id)` — o `EXISTS` final casava só por
  `cpg.privacy_group_id = pa.privacy_group_id`.
- **Deveria espelhar:** `public.cliente_pode_ver_produto` em
  `supabase/migrations/20260622200725_fbcc1648-9e57-4f01-b6a7-37987ea46f9d.sql`, que casa pelos DOIS
  formatos: `pa.privacy_group_id = pg.id OR lower(trim(pa.grupo_nome)) = lower(trim(pg.nome))`.
- **Efeito do bug:** produto privado cujo `produto_acesso` só tem `grupo_nome` (linha legada, sem
  `privacy_group_id`) sumia no "view as" mesmo o cliente real vendo.

---

## 3) CORREÇÃO aplicada (exatamente onde mexi)

**Único arquivo criado/tocado por mim:**
`supabase/migrations/20260703120000_privacy_view_as_mirror_fix.sql` (commit `39f041d`, pushed).

Faz `CREATE OR REPLACE` das 2 funções, agora espelhando 1:1 a RLS real:
1. `categoria_visivel_para` → adiciona `subcategorias_herdam` na CTE recursiva e no WHERE do nó governante.
2. `produto_visivel_para` → troca o `EXISTS` final para o match duplo `privacy_group_id OR grupo_nome`.

As RPCs staff-gated (`categorias_visiveis_cliente` / `produtos_visiveis_cliente`) **NÃO** foram alteradas.
Nenhum arquivo de frontend foi tocado — o front já chamava as RPCs certas; o defeito era só no SQL.

**SQL já aplicado no banco (2026-07-03).** Migração idempotente (CREATE OR REPLACE) — pode rodar de novo sem risco.

---

## 4) Verificado e OK — NÃO mexer (conservação do código)

- **Produção (itens 1–8):** `user` em escopo, validações intactas, sem refs quebradas.
- **Portal $0 (item 9):** remoção das travas de preço é intencional; sem quebra a jusante.
- **Admin Save (item 10):** `handleSave(goBack)` navega só no sucesso nos 3 arquivos.
- **Pedidos filtros (item 11):** os campos removidos nunca eram aplicados na query (UI decorativa).
  `reps` em `src/pages/admin/Pedidos.tsx` (declarado linha ~57, setado ~91) virou **dead code inofensivo**
  — deixado de propósito (remover seria mexer sem necessidade técnica).

---

## 5) Pendência = teste manual

"View as" do cliente do grupo **SC Dealers** deve mostrar **só** Ladson SC + Accessories - FL.
Conferir também: subcategoria pública sob pai privado agora aparece (Bug 1); logar como cliente real
dá o mesmo resultado (RLS).

**Resíduo conhecido (opcional):** `src/pages/portal/ProdutoDetalhe.tsx` por URL direta na impersonação
ainda usa RLS (admin vê). Fechar via `produto_visivel_para` seria mudança de comportamento — decisão do dono.

---

## 6) Rodada 2 da auditoria (mesmo dia) — Bug 3 + limpeza pré-go-live

### 🐞 Bug 3 — funções `_visivel_para` executáveis por qualquer role via PostgREST (CORRIGIDO)
- **Onde:** `categoria_visivel_para`/`produto_visivel_para` recebem o cliente-alvo como PARÂMETRO e
  não têm gate interno (o gate fica nas RPCs). `CREATE FUNCTION` concede EXECUTE a PUBLIC por default
  e nenhuma migração revogava → qualquer usuário (authenticated/anon) podia sondar via
  `/rest/v1/rpc/...` a visibilidade de OUTROS clientes (information disclosure da config de privacidade).
- **Fix:** migração `20260703130000_revoke_visivel_para_exec.sql` (2 REVOKEs). **Aplicada no banco ✅**
  ("No rows returned" é o retorno normal de DDL). RPCs staff-gated (SECURITY DEFINER) inalteradas.

### Varredura fake-data / fake-buttons (a pedido do dono)
- ZERO mock/lorem/dummy; ZERO botões sem ação. Troca de senha é REAL (`supabase.auth.updateUser`);
  "saved for later" do carrinho é REAL (localStorage por usuário + moveToCart).
- **Ocultado:** cards "Files" e "Messages" ("coming soon") em `src/pages/admin/OrderDetail.tsx` —
  NADA implementado por trás (sem tabela/upload/mensagens). Comentados no JSX com instrução de
  reativação; decisão do dono (não exibir seção vazia em produção).
- **Removido:** modo demo (`loginAsDemo` + caminho `sessionStorage "demo_role"`) em
  `src/contexts/AuthContext.tsx` — era dead code (nenhum botão chamava) e permitia abrir o shell
  da UI sem login (dados sempre bloqueados por RLS). `isDemo` FOI MANTIDO: o "view as"
  (impersonação) usa pra marcar sessão sintética (`applyViewAsSession`), e `ProtectedRoute`/
  `Index`/`EditPassword` dependem dele. O bloco `if (isDemo)` do `signOut` saiu por ficar
  inalcançável (isDemo=true agora implica impersonatedCustomer, tratado no 1º branch).
  Logins reais (ex.: Jess) intocados — demo não tinha relação com usuários do banco.
- **Validação:** `tsc --noEmit` exit 0 + `npm run build` OK.

### Resíduo do ProdutoDetalhe FECHADO (rodada 3)
- No "view as", URL direta `/portal/produto/:id` de produto oculto ainda abria (RLS libera admin).
- Fix mínimo em `src/pages/portal/ProdutoDetalhe.tsx` (useEffect `checkAccess`): na impersonação,
  decide pela RPC staff-gated `produtos_visiveis_cliente` (a MESMA do catálogo — cobre categoria
  privada, grant/exclude, herança sub-user→pai e grupo_nome legado) e usa o `accessDenied` que já
  existia (página "not found"). Cliente real: comportamento intocado (RLS + check existente).
  Zero migração nova. Preview do "view as" agora é 100% fiel em todas as superfícies.
