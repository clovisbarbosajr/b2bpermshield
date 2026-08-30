/**
 * Guardas das telas de `admin/settings`, de `ProductEdit`/`CustomerEdit` e do
 * relatorio de desempenho de clientes.
 *
 * Cada `expect` nasceu de um defeito que ESTAVA no arquivo, validado por um
 * cetico. E teste de FIACAO, e sabe disso: protege contra reversao, e so. O que
 * podia sair do componente saiu — `lib/percentual.ts`, `lib/paginacao.ts` e
 * `lib/gravarComToken.ts` tem teste que EXECUTA.
 *
 * Asserts por SUBSTRING sempre que da: regex escrito por gerador ja chegou a este
 * repositorio sem as barras de escape, virando assert que passava sem proteger
 * nada — e ja chegou tambem com um backspace virado em byte 0x08.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { NOMES_DE_SISTEMA } from "./stock";

const ler = (f: string) => readFileSync(f, "utf-8");
const semComentario = (f: string) =>
  ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("CompanyActivities: a tela enxerga o que ela mesma cria", () => {
  const f = () => semComentario("src/pages/admin/settings/CompanyActivities.tsx");

  it("nao filtra `customer_name IS NULL` no servidor", () => {
    // A coluna e `customer_name text DEFAULT` com string vazia, e o insert manda
    // so `{ tipo }` — entao o Postgres grava a STRING VAZIA, que `IS NULL` nao
    // casa. Toda atividade criada aqui nascia invisivel para a propria tela: o
    // admin salvava, via "Created", a lista voltava identica, e recriava o mesmo
    // nome N vezes. Nenhuma delas podia ser editada nem apagada por aqui.
    const src = f();
    expect(src, "voltou o filtro de servidor que nao casa a string vazia")
      .not.toContain('.is("customer_name", null)');
    // A negacao cobre NULL e string vazia de uma vez, e conserta as ja gravadas.
    expect(src, "sumiu o filtro que cobre os dois casos")
      .toContain("filter((a: any) => !a.customer_name)");
  });

  it("falha de leitura nao vira 'nao existe nada'", () => {
    const src = f();
    expect(src, "o error da leitura voltou a ser descartado")
      .toContain("setLoadError(error ? error.message : null)");
    expect(src, "falha de leitura voltou a preencher a lista").toContain("setActivities(error ? []");
    expect(src, "o loadError nao e renderizado").toContain("{loadError ? (");
  });

  it("o Enter do campo respeita o `saving`", () => {
    // O `disabled` do botao nao alcanca o `onKeyDown`. A auto-repeticao da tecla
    // disparava `handleSave` varias vezes antes de o dialogo fechar, e cada uma
    // fazia seu insert — sem UNIQUE em `tipo` para barrar, e as linhas duplicadas
    // nascendo invisiveis por causa do defeito acima.
    expect(f(), "o Enter voltou a ignorar o `saving`")
      .toContain('if (e.key === "Enter" && !saving) handleSave();');
  });
});

describe("ProductStatuses: o nome e chave de sistema", () => {
  const f = () => semComentario("src/pages/admin/settings/ProductStatuses.tsx");

  it("avisa antes de renomear ou apagar um dos seis de fabrica", () => {
    // Nao existe FK: `produtos.status_produto` e `text`, e os TRES consumidores
    // falham ABRINDO — `stock.ts` devolve `true` no `??`, `Catalogo.tsx` cai num
    // objeto que permite tudo, e o gatilho `fn_item_produto_valido` e denylist com
    // `LIMIT 1`. Renomear "Sold Out" devolve ao catalogo, comprável, todo produto
    // que o admin tirou de venda DE PROPOSITO com estoque em caixa.
    const src = f();
    expect(src, "sumiu a lista de nomes de sistema").toContain("NOMES_DE_SISTEMA");
    expect(src, "o rename de um status de fabrica voltou a ser silencioso")
      .toContain("Products are matched to this status BY NAME");
    expect(src, "o delete de um status de fabrica voltou a ser silencioso")
      .toContain("THIS IS A BUILT-IN STATUS");
    // A guarda tem que ABORTAR: comparar posicao nao mata o mutante que apaga o
    // `return`, e foi exatamente esse mutante que sobreviveu em `Categorias`.
    expect(src, "o aviso de rename nao interrompe mais o save")
      .toMatch(/if \(eraDeSistema[\s\S]{0,600}?return;\s*\n\s*\}/);
  });

  it("o comentario nao afirma mais uma FK que nao existe", () => {
    // A frase anterior ("status em uso por produto tem FK") era falsa, e era ela
    // que fazia o revisor pular o defeito acima.
    expect(ler("src/pages/admin/settings/ProductStatuses.tsx"),
      "voltou a afirmar que existe FK protegendo o delete")
      .not.toContain("Status em uso por produto tem FK");
  });

  it("recusa nome duplicado e confirma a escrita", () => {
    // Navegador (`Map`, ultima vence) e banco (`LIMIT 1` sem `ORDER BY`) podem
    // decidir coisas opostas para o mesmo produto. Nao ha UNIQUE no banco.
    const src = f();
    expect(src, "sumiu a checagem de nome duplicado").toContain("const repetido = items.find(");
    expect(src, "a checagem de duplicata acusa a propria linha em edicao")
      .toContain("i.id !== editing?.id");
    expect(src, "a gravacao voltou a nao confirmar a linha").toContain('.select("id").maybeSingle()');
    expect(src, "o delete voltou a nao confirmar a linha")
      .toContain('.delete().eq("id", r.id).select("id").maybeSingle()');
  });

  it("a coluna que esconde o produto usa icone explicito", () => {
    // Celula em BRANCO numa coluna booleana le-se como "sem dado", e esta e
    // justamente a coluna que tira o produto da loja.
    expect(f(), "a coluna 'Shows in store' voltou a ter celula em branco")
      .toContain("<BoolIcon val={r.permite_visualizar ?? true} />");
  });

  it("o texto de ajuda do `Active` nao promete o que nao existe", () => {
    // `ativo` nao e lido por ninguem: o dropdown do `ProductEdit` e uma lista
    // FIXA de seis que nunca consulta esta tabela.
    expect(ler("src/pages/admin/settings/ProductStatuses.tsx"))
      .not.toContain("no longer offered when editing a product");
  });
});

describe("os seis nomes de sistema batem com o mapa que os traduz", () => {
  it("`NOMES_DE_SISTEMA` cobre exatamente o `NAME_MAP`", () => {
    // Se alguem acrescentar um status ao `NAME_MAP` e esquecer desta lista, o
    // aviso de rename para de cobrir esse status em silencio — e ele volta a ser
    // renomeavel sem uma palavra.
    const src = semComentario("src/lib/stock.ts");
    const mapa = src.match(/const NAME_MAP: Record<string, string> = \{([\s\S]*?)\};/);
    expect(mapa, "nao achei o NAME_MAP").toBeTruthy();
    const valores = [...mapa![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(valores.length, "o NAME_MAP encolheu").toBeGreaterThan(0);
    expect([...NOMES_DE_SISTEMA].sort(), "a lista de nomes de sistema divergiu do NAME_MAP")
      .toEqual([...valores].sort());
  });
});

describe("o menu nao aponta mais para rota comentada", () => {
  it("os tres itens de 404 sairam do AdminLayout e do Profile", () => {
    // `Quick Links`, `Measurement Unit` e `Extra Fields` tinham rota comentada em
    // `App.tsx` e item vivo no menu — os tres caiam no `path="*"`. Era o mesmo
    // erro que o comentario do proprio `AdminLayout` documenta ter sido cometido
    // com "Oauth Applications" e "API Keys": corrigiram dois e deixaram tres, na
    // mesma lista, logo abaixo da explicacao.
    const menu = semComentario("src/components/layouts/AdminLayout.tsx");
    for (const rota of ["quick-links", "measurement-unit", "extra-fields"]) {
      expect(menu, `o item de menu para ${rota} voltou — a rota esta comentada, entao e 404`)
        .not.toContain(`/admin/settings/${rota}`);
    }
    expect(semComentario("src/pages/admin/settings/Profile.tsx"),
      "voltou o link direto para `extra-fields`, cuja rota esta comentada")
      .not.toContain("/admin/settings/extra-fields");
  });

  it("os comentarios de App.tsx nao afirmam mais o que era falso", () => {
    expect(ler("src/App.tsx"), "voltou a afirmar que os itens ja estavam fora do menu")
      .not.toContain("Ja estava fora do menu; isto fecha o link direto.");
  });
});

describe("ProductEdit: privacidade por cliente e trava de reservado", () => {
  const f = () => semComentario("src/pages/admin/ProductEdit.tsx");

  it("Grant e Exclude nao podem oferecer o mesmo cliente", () => {
    // `produto_cliente_acesso` tem `UNIQUE(produto_id, cliente_id)`. Com o mesmo
    // cliente nos dois, a ordem era: `produtos` commita; `delOrFail` APAGA todas
    // as linhas de acesso por cliente e commita; o insert estoura 23505 e lanca.
    // Fica ZERO linha no banco, a tela segue mostrando as listas em memoria, e o
    // toast diz "Failed to save" — nao "apaguei tudo". Reenviar falha igual.
    expect(f(), "cada Select voltou a filtrar so a propria lista")
      .toContain("clientes.filter((c) => !accGrant.includes(c.id) && !accExclude.includes(c.id))");
  });

  it("o save passa a trava de `estoque_reservado` no MESMO statement", () => {
    // O gatilho de reserva escreve SO em `estoque_reservado`, invisivel para o
    // `admin_rev`. Entre carregar a ficha e clicar Save, um checkout reserva mais
    // unidades; o token continua valendo e o save gravava `estoque_total` MENOR
    // que o reservado. O produto TRAVA e nao se recupera sozinho.
    const src = f();
    expect(src, "sumiu a trava de reservado do save do produto")
      .toContain('q.lte("estoque_reservado", form.estoque_total)');
    // E A MENSAGEM TEM QUE DIZER A VERDADE. Sem `porFiltroExtra`, zero linhas
    // virava "someone else changed this product" e o admin recarregava a ficha
    // para ver exatamente o mesmo numero.
    expect(src, "o conflito por trava de estoque voltou a acusar um colega que nao existe")
      .toContain("r.porFiltroExtra");
  });
});

describe("CustomerEdit: os toggles do funcionario confirmam a escrita", () => {
  const f = () => semComentario("src/pages/admin/CustomerEdit.tsx");

  it("os tres passam pelo helper que confere a linha", () => {
    // A rota exige so `view_customers`, que o WAREHOUSE tem, enquanto no banco ele
    // so tem SELECT. UPDATE barrado por RLS afeta zero linhas com `error: null`:
    // ele marcava "Confirm orders" — o que libera o funcionario a COMPRAR — e nada
    // acontecia, com a tela dizendo que sim.
    const src = f();
    expect(src, "sumiu o helper de gravacao confirmada").toContain("const gravarNoContato = async");
    expect(src, "o helper voltou a nao confirmar a linha")
      .toContain('.update(patch).eq("id", id).select("id").maybeSingle()');
    // Os TRES. Cobrir dois deixa o terceiro mentindo.
    const usos = src.match(/await gravarNoContato\(/g) ?? [];
    expect(usos.length, "um dos tres toggles voltou a gravar direto, sem confirmar").toBe(3);
    expect(src, "voltou um update cru de `clientes` na tabela de contatos")
      .not.toMatch(/from\("clientes"\)\.update\(\{ can_/);
  });

  it("o Add Address le o error", () => {
    // O `error` era descartado: para quem a RLS barra, o botao simplesmente nao
    // fazia nada, em silencio.
    expect(f(), "o insert do endereco voltou a descartar o error")
      .toContain('const { data, error } = await supabase.from("enderecos").insert(');
  });

  it("o campo morto 'Specify activity' nao voltou", () => {
    // Era um input sem `value`, sem `onChange` e sem coluna: o admin digitava,
    // salvava, lia "Customer saved" e o texto sumia no reload.
    expect(f(), "voltou o campo que nao grava em lugar nenhum").not.toContain("Specify activity");
  });
});

describe("CustomersPerformance: o contador nao pode imprimir numero que nao existe", () => {
  it("os tres pontos usam a pagina limitada", () => {
    // O filtro de nome resetava a pagina; os dois inputs de data nao. Admin na
    // pagina 5 de 12 aplica um intervalo que reduz para 50 linhas: a fatia fica
    // vazia ("No data available."), o contador imprime "101–50 of 50", e
    // `page === totalPages` e falso — o Next fica HABILITADO e aprofunda o beco.
    const src = semComentario("src/pages/admin/reports/CustomersPerformance.tsx");
    expect(src, "a tela parou de limitar a pagina").toContain("paginaValida(page, totalPages)");
    expect(src, "a fatia voltou a usar a pagina nao limitada")
      .toContain("reportData.slice((pageOk - 1) * PAGE_SIZE, pageOk * PAGE_SIZE)");
    expect(src, "o contador voltou a poder imprimir um intervalo que nao existe")
      .toContain("{(pageOk - 1) * PAGE_SIZE + 1}");
    expect(src, "o Next voltou a ficar habilitado alem da ultima pagina")
      .toContain("disabled={pageOk >= totalPages}");
    expect(src, "o Previous voltou a comparar com a pagina nao limitada")
      .toContain("disabled={pageOk <= 1}");
  });
});

describe("logs de import/export: falha de leitura nao vira 'nunca aconteceu nada'", () => {
  it("ImportsLog: o erro sai do silencio, e a barra de paginacao some junto", () => {
    // Sem `else`, falha de leitura deixava `logs`/`total` INTACTOS. Na 1a carga
    // isso imprime "(0 total)" e "No imports yet." — indistinguivel de "nunca
    // importaram nada", numa tela de AUDITORIA. Ao PAGINAR e pior: `page` ja
    // avancou (e o gatilho do efeito) e as linhas sao as da pagina anterior, entao
    // a pagina 1 aparecia rotulada "Page 2 of N".
    const src = semComentario("src/pages/admin/tools/ImportsLog.tsx");
    expect(src, "o error da leitura voltou a ser descartado")
      .toContain("setErro(error ? error.message : null)");
    expect(src, "falha de leitura voltou a manter a lista e o total antigos")
      .toContain("if (error) { setLogs([]); setTotal(0); }");
    expect(src, "o erro nao e renderizado").toContain("{erro && (");
    // A BARRA TEM QUE SAIR JUNTO: senao ela volta a rotular "Page 2 of N" sobre
    // uma lista que nao e da pagina 2.
    expect(src, "a barra de paginacao voltou a aparecer com a leitura falhada")
      .toContain("{!erro && totalPages > 1 && (");
    // E o contador do cabecalho nao pode afirmar "0 total" sem ter lido.
    expect(src, "o cabecalho voltou a afirmar um total que nao foi lido")
      .toContain("{erro ? \"\" : ` (${total} total)`}");
  });

  it("ExportsLog: as duas abas leem o error, e o corte silencioso saiu", () => {
    const src = semComentario("src/pages/admin/tools/ExportsLog.tsx");
    expect(src, "os dois error voltaram a ser descartados")
      .toContain("setErro(e.error || i.error ?");
    expect(src, "falha de leitura voltou a preencher as listas")
      .toContain("setExports(e.error ? [] : (e.data ?? []))");
    expect(src, "o erro nao e renderizado").toContain("{erro && (");
    // O `Select` nao era tamanho de pagina — nao ha paginacao aqui. Ele cortava
    // `slice(0, pageSize)` sobre linhas ja limitadas em 100: com o padrao 25, as
    // linhas 26 a 100 ficavam invisiveis nas DUAS abas, sem controle nenhum para
    // chegar nelas, e o seletor so aparecia numa.
    expect(src, "voltou o corte silencioso das linhas 26 a 100")
      .not.toContain("slice(0, pageSize)");
    expect(src, "voltou o seletor que so governava uma das abas").not.toContain("setPageSize");
  });

  it("ExportsLog: o badge de import reconhece os status que os importadores gravam", () => {
    // `"concluido"` e o valor do EXPORT. Os seis importadores gravam
    // `success`/`partial`/`failed`, entao a comparacao era falsa em 100% das
    // linhas reais — inclusive para `failed`, que saia cinza. A cor tinha deixado
    // de significar qualquer coisa, e a MESMA linha aparecia verde em `ImportsLog`.
    const src = semComentario("src/pages/admin/tools/ExportsLog.tsx");
    expect(src, "o badge de import voltou a comparar com o valor do export")
      .toContain('r.status === "success" ? "default" : r.status === "failed" ? "destructive" : "secondary"');
  });

  it("ExportsLog: a coluna Download, que era sempre um traco, saiu", () => {
    // `arquivo_url` nunca e populada: o unico gravador de `export_logs` nao manda
    // a coluna, e o export e blob no navegador — nao existe arquivo guardado para
    // a URL apontar.
    const src = semComentario("src/pages/admin/tools/ExportsLog.tsx");
    expect(src, "voltou a coluna Download, que nada popula").not.toContain("arquivo_url");
  });

  it("o realce da aba nao aponta mais para a aba errada", () => {
    // A classe-base do `TabsTrigger` e `data-[state=active]:bg-background`, que tem
    // especificidade MAIOR que um `bg-primary` injetado — entao o primary so vencia
    // com a aba DESLIGADA.
    const src = semComentario("src/pages/admin/tools/ExportsLog.tsx");
    expect(src, "voltou o realce hardcoded, que pinta a aba inativa")
      .not.toContain('value="imports" className="bg-primary');
  });
});

describe("OrdersPerMonth: o CSV leva o que a tela mostra", () => {
  it("`Avg Order` e derivado no dado, e nao so no JSX", () => {
    // A tabela mostra quatro colunas e o CSV levava tres: quem exportava para
    // conferir o ticket medio refazia a conta, sem saber que ela ficara de fora.
    const src = semComentario("src/pages/admin/reports/OrdersPerMonth.tsx");
    expect(src, "o avgOrder voltou a ser calculado so no JSX")
      .toContain("avgOrder: m.orders > 0 ? m.revenue / m.orders : 0");
    expect(src, "o CSV voltou a perder a coluna de ticket medio")
      .toContain('{ key: "avgOrder", label: "Avg Order" }');
  });
});
