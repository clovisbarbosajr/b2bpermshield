# REVIEW — Parte 3: Admin — Catálogo & Comercial

**Data:** 2026-06-17
**Escopo:** `Produtos`, `ProductEdit`, `Categorias`, `Brands`, `Estoque`, `Options`, `TabelasPreco`, `Banners`, `Noticias`, `Paginas`, `ProductImport`, `ProductExport`.
**Método:** revisão estática (eu li ProductEdit/Produtos/TabelasPreco/Estoque; subagente varreu Categorias/Brands/Options/Banners/Noticias/Paginas/ProductImport/ProductExport).

---

## Veredito rápido
A maior parte é **CRUD real, completo e bem feito** — `ProductEdit` (13 abas, todas gravando no banco), `Produtos`, `TabelasPreco`, `Estoque`, `Categorias`, `Brands`, `Options`, `Banners`, `Noticias`, `Paginas`, `ProductExport` funcionam de verdade. **Um único arquivo é uma tela 100% falsa** (`ProductImport`), e há alguns **controles cosméticos** que não entregam.

---

## ACHADOS

| # | Severidade | Achado |
|---|-----------|--------|
| 3-1 | 🟠 Alto | `ProductImport` é tela placeholder inteira — 3 botões sem ação, sem input de arquivo, sem lógica |
| 3-2 | 🟠 Médio | `Produtos`: filtros Brand / Privacy group / Allow Backorder existem mas **não filtram** |
| 3-3 | 🟡 Médio | `Categorias`: filtro `ativo=true` esconde categoria desativada — não dá pra reeditar pela UI |
| 3-4 | 🟡 Médio | `Noticias`: `publicado_em` não é setado no insert → data/ordem podem quebrar (depende do schema) |
| 3-5 | 🟡 Baixo | `ProductEdit`: "Created/Last update" sempre mostram a data de HOJE (timestamps falsos) |
| 3-6 | 🟡 Baixo | `ProductEdit.saveSubData`: delete-then-insert não transacional + sem checagem de erro |
| 3-7 | 🟡 Baixo | `TabelasPreco`: marcar "Default" não desmarca as outras (pode haver múltiplas default) |
| 3-8 | ⚪ Info | `Produtos`: estado `priceData`/colunas de price list declarado mas nunca usado (código morto) |
| 3-9 | ⚪ Info | `Options`: coluna "Sort" mostra número de linha mas não há reordenação |

---

### 🟠 3-1 — `ProductImport.tsx` é uma tela falsa
Mockup estático. Nenhum botão tem ação:
- "Choose File" (l.21) — sem handler, sem `<input type="file">`; o drag&drop é decorativo.
- "Download Products Template" (l.29) — sem handler.
- "View Import Guide" (l.30) — sem handler.
Nenhuma chamada a supabase, nenhum parse de CSV. A tela promete importação em massa de produtos e **não faz nada**. (Há outras telas de import reais em `tools/`, mas esta de produtos é casca.) **Decidir:** implementar de verdade ou remover do menu para não enganar o operador.

### 🟠 3-2 — Filtros de Produtos que não filtram
`Produtos.tsx:84-92` (`filtered`) aplica só name/code/category/isActive/status. Os selects **Brand** (l.173), **Privacy group** (l.186) e **Allow Backorder** (l.196) atualizam o estado mas são ignorados na filtragem → o usuário escolhe e a lista não muda. Controles "falsos". Implementar a filtragem ou remover os campos.

### 🟡 3-3 — Categoria desativada some e não volta
`Categorias.tsx:40` busca só `ativo=true`, mas o form deixa desmarcar "Active" (l.340). Ao desativar, a categoria desaparece da lista e não há como reabri-la/reeditá-la pela UI. O toggle "Active" vira "ocultar permanente". Mostrar inativas (com filtro) ou impedir desativar sem caminho de volta.

### 🟡 3-4 — Notícia sem `publicado_em`
`Noticias.tsx:39` não inclui `publicado_em` no insert, mas a lista ordena/exibe por ele (l.23/84). Se a coluna não tiver `DEFAULT now()`, a data sai "Invalid Date". Verificar schema na Parte 6/7.

### 🟡 3-5/3-6 — `ProductEdit` detalhes
- l.316: `Created: {new Date()} · Last update: {new Date()}` — ambos sempre hoje. Deveria usar `created_at`/`updated_at` do registro.
- `saveSubData` apaga e reinsere todas as sub-tabelas sem transação e sem checar erro; se um insert falhar no meio, dados antigos já foram apagados (ex.: galeria/preços de cliente perdidos). Robustez.

---

## Confirmado OK (CRUD entrega de verdade)
- **`ProductEdit`** — insert/update de `produtos` + 13 sub-tabelas (imagens, arquivos, descontos, preços por cliente, relacionados, opções, variantes, regras de status, price lists, acesso) via delete+insert; upload real ao storage; log de atividade. Robusto.
- **`Produtos`** — lista paginada, delete com confirm, mudança inline de status/active, preview no portal, navegação p/ edição. (Salvo os 3 filtros do 3-2.)
- **`TabelasPreco`** — CRUD de tabelas + edição de preço por produto (`upsert`/delete em `tabela_preco_itens`).
- **`Estoque`** — ajuste de quantidade gravando `estoque_log` + update do produto, com histórico.
- **`Categorias / Brands / Options / Banners / Noticias / Paginas`** — CRUD completo com supabase, confirm no delete, uploads reais onde aplicável.
- **`ProductExport`** — export CSV real com join, price maps, filtro por privacy group e registro em `export_logs`.

---

## Levado para a Parte 6/7
- 3-4: schema de `noticias.publicado_em` (default?).
- RLS de escrita: como nas migrations a maioria das policies é `has_role(admin)`, confirmar que `manager`/`warehouse` (que acessam estas telas via guard `<AW>`/`<S>`) conseguem ou não gravar — senão vira "salvar que não salva" para esses papéis (ligado ao achado 0-4).

## Veredito
Catálogo/comercial é a parte mais madura do app. Risco real baixo. Ações: implementar/remover `ProductImport` (3-1), ligar ou remover os filtros mortos de Produtos (3-2), e tratar a categoria desativada (3-3).
