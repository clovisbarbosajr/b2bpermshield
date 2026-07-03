# Mudanças solicitadas — Produção + Portal + Admin (jul/2026)

> Registro técnico de TODAS as alterações pedidas por screenshot, para revisão.
> Cada item: **o que foi pedido**, **o que mudou** (arquivos/funções/migração), **como conferir**.
> Front sobe no rebuild; itens com "MIGRAÇÃO" precisam do SQL aplicado no banco.

## Migrações a aplicar (SQL)
1. `20260701120000_producao_est_ready.sql` — `ALTER TABLE producao_pedidos ADD COLUMN est_ready date;`
2. `20260701130000_privacy_view_as_target.sql` — funções/RPCs de visibilidade por cliente-alvo (impersonação).

---

## Módulo PRODUÇÃO

| # | Pedido | Implementação | Arquivo |
|---|--------|---------------|---------|
| 1 | Campo "Est Ready" (data) antes do ETA | Novo input date `est_ready` na linha; salvo em `producao_pedidos.est_ready`. **MIGRAÇÃO** | `ProducaoEntrada.tsx` |
| 2 | Renomear "Est. delivery" → "ETA" | Label mudado (coluna `est_entrega` mantida) | `ProducaoEntrada.tsx`, `ProducaoStatus.tsx` |
| 3 | Selecionar Categoria → Produto (filtrado) | 2 selects: `Category` (categorias com produtos) e `Product` (só os `categoria_id` da categoria escolhida). Trocar categoria zera o produto. | `ProducaoEntrada.tsx` |
| 4 | Remover "Created", pôr "Est Ready" | Coluna `Created` (created_at) trocada por `Est Ready` (`est_ready`) | `ProducaoStatus.tsx` |
| 5 | Botão Duplicar entrada | `duplicate(r)` insere novo `producao_pedidos` com mesmos dados, `status='solicitado'`; ícone Copy nas ações | `ProducaoStatus.tsx` |
| 6 | Localização → itens inline (não popup) | `<Dialog>` trocado por painel inline (`{openLoc && <Card>…}`) na mesma página; card selecionado ganha ring; botão "X Close" | `ProducaoDashboard.tsx` |
| 7 | "Arriving" → "On the way" | Texto do badge do card mudado | `ProducaoDashboard.tsx` |
| 8 | (bônus) Est Ready editável | `est_ready` no diálogo de edição (edit form + saveEdit) | `ProducaoStatus.tsx` |

**Dropdown de produto (correção anterior):** agrupa pela categoria REAL (id) com caminho
completo "Estado › … › One Plus" — antes agrupava por NOME e fundia homônimas.

## Módulo PORTAL (cliente)

| # | Pedido | Implementação | Arquivo |
|---|--------|---------------|---------|
| 9 | Adicionar ao carrinho mesmo sem preço | Removidas as 3 travas de preço-zero: `handleAdd` (produto), add do catálogo, e o gate final do checkout. Item $0 vira "cotação"; vendedor ajusta depois. | `ProdutoDetalhe.tsx`, `Catalogo.tsx`, `Checkout.tsx` |
| 12 | **Impersonação escopar privacidade** | Ver seção abaixo (crítico). **MIGRAÇÃO** | `PortalLayout.tsx`, `Catalogo.tsx` + migração |

## Módulo ADMIN

| # | Pedido | Implementação | Arquivo |
|---|--------|---------------|---------|
| 10 | "Save" salva+volta / "Save and stay" só fica | `handleSave(goBack)`: `goBack=true` navega de volta só no SUCESSO. "Save" → `handleSave(true)`; "Save and stay" → `handleSave(false)`; "Back/Cancel" → só volta (sem salvar). Vale p/ ordem, cliente, produto. | `OrderDetail.tsx`, `CustomerEdit.tsx`, `ProductEdit.tsx` |
| 11 | Remover filtros de pedidos | Removidos os campos de filtro **Phone, Email, Country, Sales Rep, Submitted By** do painel de Orders (estado/lógica ficaram inertes; sem impacto). | `Pedidos.tsx` |

---

## Item 12 — CRÍTICO: privacidade na impersonação ("view as customer")

**Bug reportado:** admin usando "view as" de um cliente do grupo *SC Dealers* via **todas**
as categorias (deveria ver só *Ladson SC* e *Accessories - FL*).

**Causa:** o catálogo/sidebar dependem da RLS (`cliente_pode_ver_categoria/produto`), que
checam `auth.uid()`. Na impersonação a sessão continua sendo do **admin** → `has_role(admin)=true`
→ as funções retornam TRUE p/ tudo → mostra tudo. **O cliente REAL (logado) sempre esteve
correto** — a RLS filtra certo pra ele; só o preview do admin não escopava.

**Correção:**
- Migração `20260701130000`: `categoria_visivel_para(cat, cli)` / `produto_visivel_para(prod, cli)`
  — MESMA lógica das funções de RLS (nó privado governante, grupos de privacidade,
  grant/exclude, herança sub-user→pai), mas para um **cliente ALVO** (não `auth.uid()`).
  E RPCs `categorias_visiveis_cliente(cli)` / `produtos_visiveis_cliente(cli)` (retornam
  `uuid[]`, **só STAFF pode chamar** — checam `has_role`).
- `PortalLayout.tsx` (sidebar) e `Catalogo.tsx` (chips + grade): quando `impersonatedCustomer`
  está setado, chamam as RPCs e filtram categorias/produtos pelos IDs visíveis do cliente.

**Como conferir:** entrar em "view as" de um cliente restrito → só as categorias/produtos do
grupo dele aparecem. Logar como o cliente real → mesmo resultado (RLS). Um cliente NÃO-staff
que chame a RPC recebe `[]` (gate de staff).

**Ponto p/ o Lovable revisar:** as funções `_visivel_para` devem espelhar 1:1 a lógica de
`cliente_pode_ver_categoria`/`cliente_pode_ver_produto` (migração `20260622150000` + refino
`20260622160000` do `subcategorias_herdam`). Conferir a herança de subcategoria e o efetivo
`COALESCE(parent_customer_id, id)`.

> **Resíduo conhecido:** a página de produto (`ProdutoDetalhe`) por URL direta na impersonação
> ainda usa a RLS (admin vê). O catálogo já não linka produtos ocultos; fechar via
> `produto_visivel_para` no `ProdutoDetalhe` é um passo extra opcional.
