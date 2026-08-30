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

  it("as leituras que SOMAM: contagem de produto por categoria, e quantidade do pedido", () => {
    // Estas duas o aviso do `fetchAllRows` revelou, e nao sao "duplicata
    // inofensiva": as duas SOMAM. `Categorias` faz `counts[cat] = ... + 1` (badge
    // de produtos por categoria inflado) e `Pedidos` faz `qtyMap[ped] = ... +
    // quantidade`, que vira a coluna de quantidade da lista de pedidos. Linha de
    // fronteira servida duas vezes = numero plausivel e errado.
    expect(semComentario("src/pages/admin/Categorias.tsx"))
      .toContain('from("produtos").select("id, categoria_id").eq("ativo", true)');
    expect(semComentario("src/pages/admin/Pedidos.tsx"))
      .toContain('.select("id, pedido_id, produto_id, quantidade, sku, backorder")');
  });

  it("e as leituras onde a duplicata seria inofensiva tambem trazem `id`", () => {
    // Aqui o consumo e Map/Set/first-wins, entao duplicata nao mudaria o
    // resultado. Trazem `id` mesmo assim por um motivo pratico: um aviso com
    // falso positivo para de ser lido, e foi o aviso que achou as duas de cima.
    // A alternativa — uma flag "sem dedupe, de proposito" — custaria mais codigo
    // e criaria um jeito de mentir no dia em que o consumo virasse uma soma.
    const alvos: [string, string][] = [
      ["src/pages/admin/ProductExport.tsx", '.select("id, produto_id, preco, tabela_preco_id, tabelas_preco(nome, ativo)")'],
      ["src/pages/admin/ProductExport.tsx", 'from("tabela_preco_itens").select("id, produto_id, preco")'],
      ["src/pages/admin/ProductExport.tsx", 'from("produto_acesso").select("id, produto_id")'],
      ["src/pages/admin/Clientes.tsx", '.select("id, cliente_id, privacy_group_id")'],
      ["src/pages/admin/Clientes.tsx", 'from("pedidos").select("id, cliente_id, created_at")'],
      ["src/pages/admin/tools/ImportCustomers.tsx", 'from("clientes").select("id, email")'],
      ["src/pages/portal/Catalogo.tsx", 'from("produto_variantes").select("id, produto_id")'],
    ];
    for (const [arquivo, trecho] of alvos) {
      expect(semComentario(arquivo), `${arquivo}: o dedupe voltou a ficar desligado`).toContain(trecho);
    }
  });

  it("Dashboard, Produtos e ProducaoEntrada tambem", () => {
    expect(semComentario("src/pages/admin/Dashboard.tsx"))
      .toContain('.select("id, created_at, total, subtotal, status")');
    expect(semComentario("src/pages/admin/Produtos.tsx"))
      .toContain('.select("id, produto_id, privacy_group_id, grupo_nome")');
    // Esta e a pior das tres: ordena por `categoria_id`, coluna NAO unica.
    //
    // E TRAZER `id` NAO CONSERTA A ORDEM — a afirmacao anterior aqui era falsa.
    // Acrescentar coluna ao `select` nao muda o `ORDER BY` do servidor. Com
    // empate no `ORDER BY` sob LIMIT/OFFSET o Postgres pode servir a mesma
    // posicao com linha diferente a cada pagina, e isso PULA linha — que e
    // justamente o que o dedupe do `fetchAllRows` nao resolve nem finge resolver
    // (ele so remove repetida). O que conserta e o desempate no `order`.
    //
    // Era o unico dos ~55 chamadores de `fetchAllRows` sem coluna unica no
    // desempate. Linha perdida encolhe `allowedLocs` e esconde produto do
    // operador de producao; se cair a zero, `restringeLocais` ABRE a tela inteira.
    const prod = semComentario("src/pages/admin/producao/ProducaoEntrada.tsx");
    expect(prod, "o select de user_locations parou de trazer `id`")
      .toContain('.select("id, categoria_id")');
    expect(prod, "sumiu o desempate por coluna unica — a paginacao volta a poder PULAR linha")
      .toContain('.order("categoria_id", { ascending: true }).order("id", { ascending: true })');
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
      .toContain("categoryPath(categories as any, id)");
    expect(src, "a leitura de categorias nao traz `parent_id`, entao o caminho fica raso")
      .toContain('from("categorias").select("id, nome, parent_id")');
    // O CAMINHO ainda empata entre irmas de mesmo nome sob o mesmo pai — dado
    // legal aqui (o UNIQUE de 20260827010000 cobre so `b2bwave_id`). Sem
    // desempate, voltavam duas linhas indistinguiveis e com `key` repetida.
    expect(src, "sumiu o desempate por id quando o caminho empata")
      .toContain("vezes[caminhoDe(catId)] > 1");
    expect(src, "a linha voltou a ser chaveada pelo rotulo, que pode repetir")
      .toContain("<TableRow key={r.id}>");
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
      .toContain('.update(payload).eq("id", editing.id).select("id").maybeSingle()');
    expect(src, "o delete voltou a afirmar remocao que nao houve")
      .toContain('.delete().eq("id", id).select("id").maybeSingle()');
    expect(src, "o insert voltou a nao confirmar")
      .toContain('.insert(payload).select("id").maybeSingle()');
  });

  it("a limpeza de precos vai em LOTES, senao a URL estoura", () => {
    // O `in.(...)` viaja na query string, ~37 bytes por uuid: ~200 precos ja
    // passam de 7 KB e batem em 414. E o upsert anterior JA foi commitado —
    // a regua ficava meio-aplicada e a retentativa refazia o mesmo delete.
    expect(f(), "o delete em massa voltou a mandar todos os ids de uma vez")
      .toContain("removes.slice(i, i + 100)");
    // E a mensagem de falha parcial diz ATE ONDE FOI: com erro num lote do meio,
    // o upsert e os lotes anteriores JA foram commitados, e um `error.message`
    // cru nao deixava o admin saber que parte dos precos ja tinha sumido.
    expect(f(), "a falha parcial voltou a nao dizer quanto ja foi gravado")
      .toContain("then stopped:");
    expect(f(), "sumiu o contador de lotes que a mensagem usa").toContain("lotesFeitos");
    // E o upsert so entra na conta se ELE tiver passado: quando e o upsert que
    // falha, o laco de delete nem roda e a mensagem dizia "Saved 5 of 5, then
    // stopped" com ZERO gravado — invertendo o fato que ela existe para contar.
    expect(f(), "a contagem voltou a somar o upsert que falhou")
      .toContain("(upsertOk ? upserts.length : 0)");
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

describe("SalesTax: a tela nao pode criar a configuracao que faz o checkout mentir", () => {
  const f = () => semComentario("src/pages/admin/settings/SalesTax.tsx");

  it("recusa DUAS regras para o mesmo par (classe, grupo)", () => {
    // `tax_rules` nao tem UNIQUE em `(tax_class_id, tax_customer_group_id)`, e o
    // `Checkout` le a regra com `.maybeSingle()`, que ERRA com mais de uma linha:
    // `taxLookupOk` vira false, `taxRate` fica 0, a linha "Sales Tax" some da
    // tela. O banco resolve a mesma consulta com `LIMIT 1` e cobra de verdade.
    //
    // E o caminho para cair nisso e o NATURAL: o admin cria "TX 8.25%" e "FL 6%"
    // e amarra as duas ao mesmo grupo padrao, porque imposto para ele e por
    // estado — so que o calculo ignora estado por completo.
    const src = f();
    expect(src, "sumiu a checagem de regra duplicada").toContain("const duplicada = rules.find(");
    // O par TEM que ser (classe, grupo) — comparar so um dos dois nao acha nada.
    expect(src, "a checagem de duplicata parou de comparar a classe")
      .toContain("r.tax_class_id === ruleForm.tax_class_id");
    expect(src, "a checagem de duplicata parou de comparar o grupo")
      .toContain("r.tax_customer_group_id === ruleForm.tax_customer_group_id");
    // E TEM QUE IGNORAR A PROPRIA LINHA em edicao, senao editar uma regra
    // existente acusa ela mesma de duplicata e nada mais pode ser salvo.
    expect(src, "a checagem acusa a propria regra em edicao")
      .toContain("r.id !== editingRule?.id");
    expect(src, "a duplicata e detectada mas salva assim mesmo")
      .toMatch(/if \(duplicada\) \{[\s\S]{0,400}?return;/);
  });

  it("as quatro gravacoes confirmam a linha", () => {
    // UPDATE que casa zero linhas volta 204 com `error: null`. Duas das quatro
    // (`saveClass`/`saveGroup`) ja confirmavam; `saveRate`/`saveRule` nao — e o
    // CASCADE de `tax_classes` torna "outro admin apagou no meio" bem provavel:
    // um delete de classe leva TODAS as taxas e regras de uma vez.
    //
    // Por SUBSTRING, e nao por regex: o regex desta guarda chegou aqui com as
    // barras comidas (`[sS]` no lugar de `[\s\S]`) e reprovou codigo correto — a
    // mesma classe de acidente que o cabecalho deste arquivo ja registra.
    //
    // Conta CADA uma das oito, e nao "existe um `.select("id")` no arquivo":
    // deixar uma de fora e exatamente como estava antes (duas telas confirmavam,
    // duas nao).
    const src = f();
    const gravacoes = [
      '.from("tax_classes").update(classForm).eq("id", editingClass.id).select("id").maybeSingle()',
      '.from("tax_classes").insert(classForm).select("id").maybeSingle()',
      '.from("tax_customer_groups").update(groupForm).eq("id", editingGroup.id).select("id").maybeSingle()',
      '.from("tax_customer_groups").insert(groupForm).select("id").maybeSingle()',
      '.eq("id", editingRate.id).select("id").maybeSingle()',
      '.from("tax_rates").insert(payload).select("id").maybeSingle()',
      '.from("tax_rules").update(ruleForm).eq("id", editingRule.id).select("id").maybeSingle()',
      '.from("tax_rules").insert(ruleForm).select("id").maybeSingle()',
    ];
    for (const g of gravacoes) {
      expect(src, `esta gravacao voltou a nao confirmar a linha: ${g}`).toContain(g);
    }
    // E O ZERO LINHAS TEM QUE SER TRATADO. Confirmar e ignorar o resultado e o
    // mesmo defeito com uma chamada a mais.
    const semLinha = src.match(/if \(!data\) \{ toast\.error\(/g) ?? [];
    expect(semLinha.length, "uma das gravacoes confirma a linha mas ignora o zero")
      .toBeGreaterThanOrEqual(2);
  });

  it("o percentual passa pela faixa compartilhada", () => {
    // `parseFloat(x) || 0` NAO pega negativo. Sem CHECK no banco, aliquota
    // negativa faz o trigger SUBTRAIR do total — e `Checkout` so imprime a linha
    // "Sales Tax" quando `salesTax > 0`, entao some dinheiro sem rastro na tela.
    const src = f();
    expect(src, "voltou o `parseFloat(...) || 0`, que deixa negativo passar")
      .not.toMatch(/percentual: parseFloat\([^)]*\) \|\| 0/);
    expect(src, "sumiu a faixa compartilhada, que tem teste que EXECUTA")
      .toContain("percentual: percentualEmFaixa(e.target.value)");
    expect(src).toContain('type="number" min="0" max="100" step="0.1"');
  });

  it("os deletes contam a cascata e avisam do caso que zera o imposto", () => {
    const src = f();
    // Classe: `tax_rates` e `tax_rules` caem em CASCADE, e sem classe padrao o
    // gatilho grava `sales_tax := 0` em TODO pedido seguinte, calado.
    expect(src, "o delete de tax_class parou de contar as taxas")
      .toContain('from("tax_rates").select("id", { count: "exact", head: true }).eq("tax_class_id"');
    expect(src, "o delete de tax_class parou de contar as regras")
      .toContain('from("tax_rules").select("id", { count: "exact", head: true }).eq("tax_class_id"');
    expect(src, "sumiu o aviso de que apagar a classe PADRAO zera o imposto de todo pedido")
      .toContain("THIS IS THE DEFAULT TAX CLASS");
    // Taxa: as regras que a usam caem junto, e o grupo daqueles clientes passa a
    // nao ter regra — imposto zero, sem aviso.
    expect(src, "o delete de tax_rate parou de contar as regras que caem junto")
      .toContain('.eq("tax_rate_id", r.id)');
    // Falha ao contar tem que RECUSAR: nao da para avisar do estrago que nao se
    // conseguiu medir.
    expect(src, "falha ao contar deixou de recusar o delete da classe")
      .toMatch(/if \(tr\.error \|\| tru\.error\) \{[\s\S]{0,250}?return;/);
    expect(src, "falha ao contar deixou de recusar o delete da taxa")
      .toMatch(/if \(usos\.error\) \{[\s\S]{0,250}?return;/);
  });
});

describe("Coupons e TabelasPreco: erro de leitura e FK traduzido", () => {
  it("Coupons: o 23503 vira frase, e a gravacao confirma a linha", () => {
    // O FK de `pedidos.coupon_id` e NO ACTION e esta CERTO: protege o historico.
    // Nao ha cascata a avisar — so faltava traduzir, porque o toast despejava
    // `pedidos_coupon_id_fkey` na cara do admin.
    const src = semComentario("src/pages/admin/settings/Coupons.tsx");
    expect(src, "o erro de FK voltou a ser despejado cru").toContain('error.code === "23503"');
    expect(src, "a mensagem nao diz o que fazer").toContain("Set it to Inactive instead");
    expect(src, "a gravacao voltou a nao confirmar a linha")
      .toMatch(/from\("coupons"\)[\s\S]{0,200}?\.select\("id"\)/);
    expect(src, "falha de leitura voltou a preencher a lista").toContain("setItems(error ? [] : (data ?? []))");
  });

  it("TabelasPreco: nome vazio recusado e duplicar travado por REF", () => {
    const src = semComentario("src/pages/admin/TabelasPreco.tsx");
    // `NOT NULL` nao barra string vazia: regua sem nome vira linha em branco nos
    // seletores de seis telas, inclusive no de atribuir cliente.
    expect(src, "voltou a aceitar regua sem nome")
      .toMatch(/const nome = form\.nome\.trim\(\);[\s\S]{0,120}?if \(!nome\)[\s\S]{0,80}?return;/);
    // E TEM QUE GRAVAR O APARADO. Checar `trim()` e gravar `form` deixava passar
    // um nome so de espacos, que produz a mesma linha em branco.
    expect(src, "a gravacao voltou a mandar o nome sem aparar").toContain("const payload = { ...form, nome };");
    // O botao de duplicar e um icone MUDO e a operacao sao 4+ idas ao servidor:
    // segundo clique cria uma regua a mais com ~2 mil linhas de preco. `useState`
    // nao serve — a leitura cairia depois de um await.
    expect(src, "sumiu a trava por ref do duplicar").toContain("if (duplicandoRef.current) return;");
    // ANTES DO PRIMEIRO AWAIT, e nao so "as duas linhas juntas". Medido: mover o
    // par inteiro para depois do insert da regua mantinha a adjacencia e nao
    // travava nada — o segundo clique voltava a criar a regua com ~2 mil linhas.
    // A guarda irma de `Produtos` ja comparava posicao; esta nao comparava.
    expect(src, "a trava e marcada depois de algum await")
      .toMatch(/if \(duplicandoRef\.current\) return;\s*\n\s*duplicandoRef\.current = true;/);
    const marca = src.indexOf("duplicandoRef.current = true;");
    const primeiroAwait = src.indexOf("await", src.indexOf("const handleDuplicate"));
    expect(marca, "nao achei a marcacao da trava").toBeGreaterThan(-1);
    expect(primeiroAwait, "nao achei o primeiro await do handleDuplicate").toBeGreaterThan(-1);
    expect(marca, "a trava e marcada DEPOIS do primeiro await — nao trava nada")
      .toBeLessThan(primeiroAwait);
    expect(src, "a trava nunca e liberada — o botao morre ate o F5")
      .toMatch(/finally \{[\s\S]{0,200}?duplicandoRef\.current = false;/);
  });
});
