/**
 * As guardas dos relatorios, do export de produtos e da tela de reguas de preco.
 *
 * Cada `expect` nasceu de um mutante que reprova o defeito que ele nomeia. E
 * teste de FIACAO, e sabe disso: protege contra reversao, e so. O que pode sair
 * do componente ja saiu e tem teste que EXECUTA — `fetchAllRows.test.ts` (o
 * aviso de dedupe desligado), `dataLocal.test.ts` (o fuso) e
 * `ordemCategorias.test.ts` (a reordenacao).
 *
 * Os asserts sao por SUBSTRING, e nao por regex: regex escrito por gerador ja
 * chegou a este repositorio sem as barras de escape, virando assert que passava
 * sem proteger nada.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const ler = (f: string) => readFileSync(f, "utf-8");
const semComentario = (f: string) =>
  ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("`fetchAllRows`: quem pagina precisa trazer `id`", () => {
  // O dedupe e por `linha.id`. Sem a coluna no `select`, a protecao fica
  // desligada — e numa tabela com escrita concorrente a linha da fronteira volta
  // duas vezes e o relatorio soma a mesma venda duas vezes. `pedido_itens.id` e
  // uuid ALEATORIO, entao `.order("id")` nao ajuda: a insercao concorrente cai em
  // posicao arbitraria, inclusive antes do offset ja percorrido.
  const chamadores: [string, string][] = [
    ["src/pages/admin/Relatorios.tsx", "pedido_itens"],
    ["src/pages/admin/reports/CustomerProductSales.tsx", "pedido_itens"],
    ["src/pages/admin/reports/InventoryControl.tsx", "pedido_itens"],
    ["src/pages/admin/reports/OrdersSummary.tsx", "pedido_itens"],
    ["src/pages/admin/reports/ProductSales.tsx", "pedido_itens"],
    ["src/pages/admin/reports/ProductsByOrderStatus.tsx", "pedido_itens"],
    ["src/pages/admin/reports/SalesPerCategory.tsx", "pedido_itens"],
    ["src/pages/admin/reports/SalesPerProduct.tsx", "pedido_itens"],
  ];
  for (const [arquivo, tabela] of chamadores) {
    it(`${arquivo}: o select de \`${tabela}\` traz \`id\``, () => {
      const src = semComentario(arquivo);
      expect(src, `nao achei o select de ${tabela}`).toContain(`from("${tabela}").select("`);
      expect(src, "o dedupe do fetchAllRows voltou a ficar desligado nesta leitura")
        .toContain(`from("${tabela}").select("id, `);
    });
  }

  it("Dashboard, Produtos e ProducaoEntrada tambem", () => {
    expect(semComentario("src/pages/admin/Dashboard.tsx"))
      .toContain('.select("id, created_at, total, subtotal, status")');
    expect(semComentario("src/pages/admin/Produtos.tsx"))
      .toContain('.select("id, produto_id, privacy_group_id, grupo_nome")');
    // Esta e a pior das tres: ordenava por `categoria_id`, coluna NAO unica —
    // sem `id`, nem ordem estavel havia.
    expect(semComentario("src/pages/admin/producao/ProducaoEntrada.tsx"))
      .toContain('.select("id, categoria_id")');
  });
});

describe("Relatorios: o numero exibido nao pode ser outra coisa", () => {
  it("`Low Stock` ignora produto desativado e sem monitor de estoque", () => {
    // Produto desativado com estoque 0 e `quantidade_minima` no default 1
    // satisfazia `0 - 0 <= 1` e entrava: centenas de desativados afogavam o
    // sinal real. `rastrear_estoque = false` e ruido por definicao.
    const src = semComentario("src/pages/admin/Relatorios.tsx");
    expect(src, "a leitura parou de trazer as colunas do filtro")
      .toContain("quantidade_minima, ativo, rastrear_estoque");
    expect(src, "o Low Stock voltou a contar produto desativado / sem monitor")
      .toContain("p.ativo && (p.rastrear_estoque ?? true) &&");
  });

  it("o filtro de data do InventoryControl passa pelo helper de fuso", () => {
    // `new Date("2026-08-30")` cru e meia-noite UTC — 21h do dia ANTERIOR no
    // Brasil. Cinco telas irmas ja tinham resolvido isso duplicando
    // `+ "T00:00:00"` na mao, e foi essa duplicacao que deixou a sexta escapar.
    const src = semComentario("src/pages/admin/reports/InventoryControl.tsx");
    expect(src, "voltou a parsear a data do filtro como UTC")
      .not.toContain("new Date(appliedFilters.lastModified)");
    expect(src, "sumiu o helper de fuso, que tem teste que executa")
      .toContain('paraInstanteLocal(appliedFilters.lastModified, "00:00:00")');
  });

  it("`Sales per Category` agrega por ID, e rotula com o caminho", () => {
    // Nome de categoria nao e unico entre nos de pais diferentes: "Accessories"
    // sob Doors e sob Windows viravam UMA linha somada, sem como separar.
    const src = semComentario("src/pages/admin/reports/SalesPerCategory.tsx");
    expect(src, "a agregacao voltou a ser chaveada pelo nome").not.toContain("map[catName]");
    expect(src, "a agregacao deixou de ser por id").toContain("map[catId][d.getMonth()]");
    expect(src, "o rotulo deixou de desambiguar pelo caminho da arvore")
      .toContain("categoryPath(categories as any, catId)");
    expect(src, "a leitura de categorias nao traz `parent_id`, entao o caminho fica raso")
      .toContain('from("categorias").select("id, nome, parent_id")');
  });

  it("o CSV nao discorda da tela: status e data", () => {
    // O admin filtrava "Submitted", via "Submitted", e recebia um CSV com
    // `recebido` misturado a `submitted`. E as datas cruas ISO trocavam o DIA.
    expect(semComentario("src/pages/admin/reports/OrdersSummary.tsx"),
      "o export voltou a mandar o status cru").toContain("status: statusLabel(o.status)");
    const ca = semComentario("src/pages/admin/reports/CustomerActivity.tsx");
    expect(ca, "o export voltou a mandar data ISO crua").toContain("firstOrder: soDataLocal(d.firstOrder)");
    expect(ca).toContain("registered: soDataLocal(d.registered)");
  });

  it("os cards de resumo nao mostram $0.00 durante a carga", () => {
    // Ficavam FORA do ramo de `loading`: em TODA abertura a tela exibia zero
    // como se fosse o numero final, com o spinner logo abaixo.
    expect(semComentario("src/pages/admin/reports/OrdersSummary.tsx"))
      .toContain("{!loading && (");
    expect(semComentario("src/pages/admin/reports/PaymentActivity.tsx"))
      .toContain("{!loading && (");
  });
});

describe("ProductExport: o CSV nao pode ter coluna com valor de outra", () => {
  const f = () => semComentario("src/pages/admin/ProductExport.tsx");

  it("o desempate de rotulo compara com as COLUNAS FIXAS tambem", () => {
    // `exportToCSV` e chamado sem `columns`, entao as colunas saem de
    // `Object.keys(row)`: uma regua chamada `product_sku` nao virava duas
    // colunas, virava UMA — o preco entrava por cima do SKU. E uma chamada
    // `length`/`brand` era sobrescrita pelo `Object.assign`, sumindo do CSV.
    const src = f();
    expect(src, "sumiu a lista de colunas fixas").toContain("COLUNAS_FIXAS");
    expect(src, "o desempate voltou a so olhar entre reguas")
      .toContain("COLUNAS_FIXAS.includes(nome)");
    for (const col of ["product_sku", "category_path", "length", "brand", "quantity", "barcode"]) {
      expect(src, `\`${col}\` saiu da lista de colunas fixas`).toContain(`"${col}"`);
    }
  });

  it("a regua escolhida e conferida como ATIVA na hora do export", () => {
    // O dropdown filtra `ativo`, mas e carregado UMA vez no mount e o sync do
    // B2BWave desativa regua sozinho: com a tela aberta durante um sync, o
    // export saia com preco de regua MORTA. O ramo "all" ja filtrava; este nao.
    expect(f(), "o ramo de regua especifica voltou a exportar regua desativada")
      .toContain('.eq("id", selectedPriceList).eq("ativo", true).maybeSingle()');
    expect(f(), "sumiu a recusa quando a regua nao esta mais ativa")
      .toContain("no longer active");
  });
});

describe("TabelasPreco: copia inteira, cascata contada e escrita confirmada", () => {
  const f = () => semComentario("src/pages/admin/TabelasPreco.tsx");

  it("a leitura da copia traz `id`, senao o dedupe fica desligado", () => {
    // Sem `id`, uma insercao concorrente duplica a linha da fronteira, o insert
    // viola `UNIQUE(tabela_preco_id, produto_id)` e sobra uma regua criada e
    // VAZIA na grade, pronta para alguem amarrar um cliente nela.
    expect(f(), "o dedupe voltou a ficar desligado na duplicacao de regua")
      .toContain('from("tabela_preco_itens").select("id, produto_id, preco")');
  });

  it("o delete conta a cascata antes de perguntar, e recusa se nao conseguir contar", () => {
    // O efeito mais grave e o silencioso: `clientes.tabela_preco_id ON DELETE
    // SET NULL` — cada cliente amarrado passa a comprar pelo preco de balcao,
    // sem nada aparecer na ficha dele.
    const src = f();
    for (const tabela of ["tabela_preco_itens", "variante_precos", "produto_descontos", "clientes"]) {
      expect(src, `sumiu a contagem de \`${tabela}\` antes do delete`)
        .toContain(`from("${tabela}").select("id", { count: "exact", head: true }).eq("tabela_preco_id", id)`);
    }
    expect(src, "a falha ao contar voltou a deixar o delete passar")
      .toContain("Could not check what this price list is used by");
    expect(src, "sumiu o aviso de que o cliente cai no preco base")
      .toContain("they will be charged the base price");
  });

  it("update, insert e delete confirmam a linha", () => {
    const src = f();
    expect(src, "o update voltou a afirmar gravacao que nao houve")
      .toContain('.update(form).eq("id", editing.id).select("id").maybeSingle()');
    expect(src, "o delete voltou a afirmar remocao que nao houve")
      .toContain('.delete().eq("id", id).select("id").maybeSingle()');
    expect(src, "o insert voltou a nao confirmar")
      .toContain('.insert(form).select("id").maybeSingle()');
  });

  it("a limpeza de precos vai em LOTES, senao a URL estoura", () => {
    // O `in.(...)` viaja na query string, ~37 bytes por uuid: ~200 precos ja
    // passam de 7 KB e batem em 414. E o upsert anterior JA foi commitado —
    // a regua ficava meio-aplicada e a retentativa refazia o mesmo delete.
    expect(f(), "o delete em massa voltou a mandar todos os ids de uma vez")
      .toContain("removes.slice(i, i + 100)");
  });
});

describe("Categorias: a leitura pagina antes de reescrever `ordem`", () => {
  it("`fetchData` usa `fetchAllRows`", () => {
    // O `.select("*")` solto corta em 1000 SEM erro, e `moveCategory` e
    // `sortAlphabetically` REESCREVEM `ordem` por cima do que leram: o irmao que
    // ficou fora do corte volta a colidir, que e o empate que a reindexacao veio
    // resolver. O mesmo arquivo ja paginava `clientes` e `produtos`.
    const src = semComentario("src/pages/admin/Categorias.tsx");
    expect(src, "a leitura de categorias voltou a ser um select solto")
      .toContain('fetchAllRows<Categoria>((from, to) => supabase');
    expect(src, "sumiu o desempate que o `range` por offset exige")
      .toContain('.order("ordem").order("nome").order("id", { ascending: true })');
  });
});

describe("Options: remover valor nao pode apagar a linha errada", () => {
  it("o filtro e pela REFERENCIA da linha, nunca pela posicao", () => {
    // A forma funcional consertou o array velho, mas `idx` continua sendo o do
    // render ANTERIOR ao await do delete, e a lixeira nunca fica desabilitada:
    // dois cliques com rede lenta faziam o segundo filtro rodar sobre o array JA
    // encurtado — sumia da tela a linha VIVA e ficava a que ja foi apagada.
    const src = semComentario("src/pages/admin/Options.tsx");
    expect(src, "voltou a remover por posicao, com indice do render anterior")
      .not.toContain("prev.filter((_, i) => i !== idx)");
    expect(src, "sumiu o filtro por referencia da linha")
      .toContain("setValues((prev: any[]) => prev.filter((x) => x !== v));");
  });
});
