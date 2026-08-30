import { describe, it, expect } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do Node
// nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o
// modulo existe (vitest roda em Node). Mesma nota de
// `src/pages/admin/estoqueUpdateCondicional.test.ts`.
// @ts-expect-error
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

// TESTE DE FIACAO, pelo mesmo motivo do `estoqueUpdateCondicional.test.ts`: as
// guardas moram DENTRO de componentes de pagina, e importar o modulo arrastaria
// layout, router, contexto de auth e o cliente Supabase. O que da para afirmar
// sem montar a tela e a FORMA do trecho perigoso — que e exatamente o que a
// mutacao apaga.
//
// Cada assert abaixo corresponde a um defeito que ESTAVA no arquivo e que voltar
// atras reintroduz. Nenhum e estilo.

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

/**
 * Codigo sem os comentarios de linha. Os comentarios destes arquivos CITAM o
 * defeito antigo ("`parseFloat` le o prefixo..."), e a primeira versao deste
 * teste reprovou por causa da propria explicacao do conserto. Um assert que
 * confunde o codigo com o comentario sobre o codigo nao prova nada.
 */
const semComentarios = (fonte: string) => fonte.replace(/^\s*\/\/.*$/gm, "");

describe("importadores de lote: numero vindo de planilha e lido por inteiro", () => {
  // `parseInt`/`parseFloat` leem o PREFIXO e descartam o resto sem erro:
  // "1001abc" -> 1001 (pedido ERRADO atualizado, "Updated" em verde) e "45x" ->
  // 45 (preco errado num pedido historico). O conserto e `Number` + checagem.
  it("BulkUpdateOrders nao usa parseInt no order_number", () => {
    const fonte = ler("./BulkUpdateOrders.tsx");
    expect(semComentarios(fonte)).not.toMatch(/parseInt\s*\(/);
    expect(fonte).toMatch(/Number\.isInteger\(orderNumber\)/);
  });

  it("ImportOrders nao usa parseFloat no price", () => {
    const fonte = ler("./ImportOrders.tsx");
    expect(semComentarios(fonte)).not.toMatch(/parseFloat\s*\(/);
    // Celula vazia nao pode virar preco zero: `Number("")` e 0.
    expect(fonte).toMatch(/priceRaw === ""/);
  });
});

describe("importadores de lote: leitura que falha nao vira silencio", () => {
  // `fetchAllRows` LANCA. Solto, depois de `setImporting(true)`, deixava a tela
  // presa em "Importing..." para sempre, sem toast.
  it("ImportRelatedProducts pega o throw do fetchAllRows e destrava a tela", () => {
    const fonte = ler("./ImportRelatedProducts.tsx");
    const bloco = fonte.match(/try \{[\s\S]*?fetchAllRows[\s\S]*?\} catch[\s\S]*?\}/);
    expect(bloco, "fetchAllRows precisa estar dentro de try/catch").toBeTruthy();
    expect(bloco![0]).toMatch(/setImporting\(false\)/);
  });

  // `file.text()`/`file.arrayBuffer()` rejeitam e `XLSX.read` lanca: sem catch,
  // soltar o arquivo nao fazia NADA e nao dizia nada.
  // Os quatro ultimos entraram depois: `parseCSV` passou a LANCAR em cabecalho
  // repetido, e nestas telas `handleFile(f)` e chamada solta do `onChange`/`onDrop`
  // (`if (f) handleFile(f)`), sem `.catch()`. O `setFileName` roda antes do parse,
  // entao o admin via o nome do arquivo aparecer e NADA acontecia — sem toast, sem
  // erro. O assert deste laco ja existia; faltava incluir os arquivos.
  for (const arquivo of ["./BulkUpdateOrders.tsx", "./ImportProductVariants.tsx", "./ImportRelatedProducts.tsx", "./ImportOrders.tsx",
                         "./ImportCustomers.tsx", "./ImportAddresses.tsx", "./ImportCategories.tsx", "./ImportCustomerPrices.tsx"]) {
    it(`${arquivo}: leitura do arquivo esta protegida e avisa`, () => {
      const fonte = ler(arquivo);
      const bloco = fonte.match(/try \{[\s\S]{0,600}?await file\.(text|arrayBuffer)\(\)[\s\S]*?\} catch[\s\S]*?\}/);
      expect(bloco, "a leitura do File precisa estar dentro de try/catch").toBeTruthy();
      expect(bloco![0]).toMatch(/toast\.error/);
    });
  }
});

describe("importadores de lote: um lote por vez", () => {
  // So o `<Button>` interno estava desabilitado — a moldura continuava clicavel
  // e aceitando drop. Dois `handleFile` concorrentes duplicam variante (nao ha
  // UNIQUE em produto_variantes) e embaralham o relatorio.
  for (const arquivo of ["./BulkUpdateOrders.tsx", "./ImportProductVariants.tsx", "./ImportOrders.tsx"]) {
    it(`${arquivo}: a area de drop inteira recusa enquanto importa`, () => {
      const fonte = ler(arquivo);
      expect(fonte).toMatch(/onClick=\{\(\) => \{ if \(!importing\)/);
      expect(fonte).toMatch(/onDrop=\{\(e\) => \{ e\.preventDefault\(\); if \(importing\) return;/);
    });
  }
});

describe("importadores de lote: janela de silencio cobre o lote", () => {
  // `desde` e compartilhado e ancorado no PRIMEIRO incremento da sequencia
  // (20260826010000). Herdando um `desde` velho, um piso de 10 minutos morre no
  // meio da planilha e o gatilho de notificacao volta a falar — o formato do
  // incidente de 25/ago.
  for (const arquivo of ["./BulkUpdateOrders.tsx", "./ImportOrders.tsx"]) {
    it(`${arquivo}: piso de 30 minutos`, () => {
      expect(ler(arquivo)).toMatch(/Math\.max\(30,/);
    });
  }
});

describe("ImportProductVariants nao promete coluna que a tabela nao tem", () => {
  // `produto_variantes` nao tem coluna de preco nem de nome; o codigo nunca as
  // gravou, mas o modelo e a ajuda as ofereciam e a tela dizia "Inserted".
  it("o modelo nao oferece price nem variant_name", () => {
    const fonte = ler("./ImportProductVariants.tsx");
    const modelo = fonte.match(/const TEMPLATE_HEADERS = \[[^\]]*\]/)![0];
    expect(modelo).not.toMatch(/price|variant_name/);
    // E o que vier no arquivo e reportado como descartado, nao engolido.
    expect(fonte).toMatch(/COLUNAS_SEM_DESTINO/);
  });
});

// ---------------------------------------------------------------------------
// ImportOrders: pedido sem item nao pode sobreviver ao lote.
//
// O caminho de erro dos itens deixava o `pedidos` ja criado no banco, com o total
// que a planilha mandou e no status que o CSV pediu — inclusive `complete`. E o
// operador, lendo "Order created but items failed", reimportava a planilha
// corrigida e criava outro.
//
// Estes testes sao sobre a FIACAO do caminho de erro, que e onde o defeito estava.
// ---------------------------------------------------------------------------
describe("ImportOrders: pedido orfao", () => {
  const fonte = readFileSync("src/pages/admin/tools/ImportOrders.tsx", "utf8");
  const ramoErro = fatiaEntre(
    fonte,
    "if (itensError) {",
    "} else {",
  );

  it("apaga o pedido quando os itens falham", () => {
    expect(ramoErro).toMatch(/\.from\("pedidos"\)\.delete\(\)\.eq\("id", pedido\.id\)/);
  });

  it("le o erro da limpeza — senao o lixo fica e ninguem sabe", () => {
    // Destruturado E usado depois. Sem a segunda ocorrencia, o delete falharia em
    // silencio e o pedido vazio continuaria no banco com a mensagem de sucesso.
    expect(ramoErro).toMatch(/const \{ error: limpezaErr \}/);
    const usos = ramoErro.match(/limpezaErr/g) ?? [];
    expect(usos.length, "`limpezaErr` foi lido mas nunca usado").toBeGreaterThan(1);
  });

  it("a mensagem MUDA quando a limpeza falha, e entrega o id para apagar a mao", () => {
    expect(ramoErro).toMatch(/could NOT be removed/);
    expect(ramoErro).toMatch(/\$\{pedido\.id\}/);
  });

  it("nao afirma mais que o pedido foi criado quando nada foi importado", () => {
    expect(ramoErro).not.toMatch(/Order created but items failed/);
  });
});

// ---------------------------------------------------------------------------
// ImportRelatedProducts: foto antes do DELETE, restauracao se o INSERT falhar.
//
// `produtos_relacionados` NAO tem outra fonte — a API do B2BWave nao expoe related
// products, entao esses vinculos so existem porque alguem importou este arquivo um
// dia. Sem transacao, delete + insert falhando no meio apaga o que nao volta.
// ---------------------------------------------------------------------------
describe("ImportRelatedProducts: perda entre o delete e o insert", () => {
  const fonte = readFileSync("src/pages/admin/tools/ImportRelatedProducts.tsx", "utf8");
  const iFoto = fonte.indexOf('.select("produto_relacionado_id, comprar_junto")');
  const iDelete = fonte.indexOf('.from("produtos_relacionados").delete()');

  it("le o estado anterior ANTES de apagar", () => {
    expect(iFoto, "sumiu a leitura do estado anterior").toBeGreaterThan(-1);
    expect(iDelete, "sumiu o delete").toBeGreaterThan(-1);
    expect(iFoto, "a foto tem que vir ANTES do delete, senao nao ha o que restaurar")
      .toBeLessThan(iDelete);
  });

  it("nao apaga se a foto falhar", () => {
    const bloco = fonte.slice(iFoto, iDelete);
    expect(bloco).toMatch(/antesErr/);
    expect(bloco).toMatch(/nothing was changed/);
    expect(bloco, "falha ao ler tem que interromper antes do delete").toMatch(/continue;/);
  });

  it("tenta restaurar quando o insert falha", () => {
    const ramo = fatiaEntre(
      fonte.slice(iDelete),
      "if (error) {",
      "continue;",
      // 60, e nao 40: o ramo real ja tem 31 linhas — 78% do teto — e um quarto
      // desfecho reprovaria com "recorte grande demais", alarme falso sobre
      // edicao legitima. O cap pega recorte que FUGIU; nao congela o tamanho.
      60,
    );
    expect(ramo).toMatch(/restaurar/);
    expect(ramo).toMatch(/\.from\("produtos_relacionados"\)\.insert\(restaurar\)/);
  });

  it("a mensagem distingue os tres desfechos, e nao afirma perda quando nao houve", () => {
    const ramo = fatiaEntre(
      fonte.slice(iDelete),
      "if (error) {",
      "continue;",
      // 60, e nao 40: o ramo real ja tem 31 linhas — 78% do teto — e um quarto
      // desfecho reprovaria com "recorte grande demais", alarme falso sobre
      // edicao legitima. O cap pega recorte que FUGIU; nao congela o tamanho.
      60,
    );
    expect(ramo, "falta o caso 'restaurou'").toMatch(/were restored/);
    expect(ramo, "falta o caso 'restauracao tambem falhou'").toMatch(/also failed/);
    expect(ramo, "falta o caso 'nao havia nada'").toMatch(/nothing was lost/);
  });
});

// ---------------------------------------------------------------------------
// O NUMERO DE LINHA REPORTADO AO ADMIN.
//
// `i + 2` supunha que o indice do array batia com o arquivo, e nao bate: linha em
// branco e descartada pelo parser e campo entre aspas ocupa varias linhas. Num
// CSV vindo do Excel — que gosta das duas coisas — o numero mandava o admin abrir
// a linha errada. `parseCSV` carimba `__linha` com o numero real.
//
// Reverter para `i + 2` passava VERDE ate este bloco existir.
// ---------------------------------------------------------------------------
describe("as telas reportam a linha REAL do arquivo", () => {
  const TELAS = [
    "./BulkUpdateOrders.tsx", "./ImportOrders.tsx", "./ImportCustomers.tsx",
    "./ImportAddresses.tsx", "./ImportCategories.tsx", "./ImportCustomerPrices.tsx",
    "./ImportProductVariants.tsx", "./ImportRelatedProducts.tsx",
  ];

  // Quantas chamadas cada tela tem hoje. Um numero a MENOS e reversao parcial —
  // o caso que passava despercebido. Um a MAIS e ponto novo, e a lista se atualiza
  // de proposito, para alguem ter de olhar.
  const ESPERADO: Record<string, number> = {
    "./BulkUpdateOrders.tsx": 8, "./ImportOrders.tsx": 5, "./ImportCustomers.tsx": 3,
    // 30/ago: +3 em `ImportAddresses` (obrigatorio em branco, endereco ja na base,
    // principal anterior nao desmarcado), +1 liquido em `ImportCategories` (nome de
    // pai homonimo e (nome,pai) duplicado entram; o ramo do `buscaErr` sai, porque
    // a busca por linha virou mapa em memoria) e +1 em `ImportProductVariants`
    // (SKU de pai repetido).
    // Segunda rodada do mesmo dia: +2 em `ImportAddresses` (endereco ja cadastrado
    // que o arquivo pede para virar principal — o sucesso e a falha da promocao) e
    // +1 em `ImportCategories` ("ja existe e o arquivo nao traz nada a mudar", que
    // e desfecho legitimo e nao pode virar UPDATE vazio).
    "./ImportAddresses.tsx": 8, "./ImportCategories.tsx": 7, "./ImportCustomerPrices.tsx": 11,
    "./ImportProductVariants.tsx": 6, "./ImportRelatedProducts.tsx": 7,
  };

  for (const arquivo of TELAS) {
    it(`${arquivo}: nenhum \`i + 2\` sobrou`, () => {
      // Sem o bloco do proprio helper — declaracao e docblock: os dois citam
      // `i + 2` de proposito, um como reserva para chamada que nao venha do
      // `parseCSV`, o outro explicando por que a reserva existe.
      const fonte = ler(arquivo).split("\n")
        .filter((l) => !l.includes("const linhaDoArquivo =") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
        .join("\n");
      expect(fonte, "voltou a supor que o indice do array e a linha do arquivo")
        // `\b` de verdade. A versao anterior tinha U+0008 (BACKSPACE) literal no
        // lugar do word-boundary — escrito por heredoc de shell, que interpretou o
        // `\b` — entao o regex era `/[BS]i \+ 2[BS]/` e nao casava com arquivo
        // nenhum. Reverter UM ponto de `linhaDoArquivo` passava verde; so o
        // replace global reprovava, pelo outro assert.
        .not.toMatch(/\bi \+ 2\b/);
      // CONTAGEM, e nao presenca: `toMatch` sozinho passa com UMA ocorrencia
      // sobrando, entao reverter um ponto isolado — que e exatamente o defeito
      // que esta leva veio consertar — ficava invisivel.
      const usos = (fonte.match(/linhaDoArquivo\(r, i\)/g) ?? []).length;
      expect(usos, "sumiu o helper que le o `__linha`").toBeGreaterThan(0);
      expect(usos, `${arquivo}: numero de chamadas mudou — reversao parcial?`)
        .toBe(ESPERADO[arquivo]);
    });
  }

  it("o helper cai no calculo antigo so como reserva", () => {
    // Se `__linha` sumir do parser, as telas nao podem quebrar — mas tambem nao
    // podem fingir que o numero e o real. Aqui le o arquivo INTEIRO, porque e a
    // linha do helper que interessa.
    const fonte = ler("./BulkUpdateOrders.tsx");
    expect(fonte).toMatch(/const linhaDoArquivo = \(r: any, i: number\): number => r\?\.__linha \?\? i \+ 2;/);
  });
});

// ---------------------------------------------------------------------------
// A TABELA DO ARQUIVO ANTERIOR NAO PODE FICAR NA TELA.
//
// `setFileName(file.name)` roda antes do parse, e a tabela de resultados fica
// logo abaixo da moldura de drop. Sem limpar, um arquivo que falha no parse
// deixava a tela com o NOME do arquivo novo e as LINHAS do anterior — o toast
// some em segundos e sobra a leitura errada. E a mesma "tela mentindo que
// carregou" que estas telas vieram consertar, em escala menor.
// ---------------------------------------------------------------------------
describe("resultado anterior e limpo antes de ler o arquivo novo", () => {
  for (const arquivo of [
    "./BulkUpdateOrders.tsx", "./ImportOrders.tsx", "./ImportCustomers.tsx",
    "./ImportAddresses.tsx", "./ImportCategories.tsx", "./ImportCustomerPrices.tsx",
    "./ImportProductVariants.tsx", "./ImportRelatedProducts.tsx",
  ]) {
    it(`${arquivo}: limpa antes de parsear`, () => {
      const fonte = ler(arquivo);
      const i = fonte.indexOf("setFileName(file.name)");
      expect(i, "sumiu o `setFileName`").toBeGreaterThan(-1);
      // Tem que vir ANTES do parse: limpar depois nao adianta.
      const iParse = fonte.indexOf("parseCSV(", i);
      const iLimpa = fonte.indexOf("setResults([])", i);
      expect(iLimpa, "nao limpa o resultado anterior").toBeGreaterThan(-1);
      expect(iLimpa, "limpa DEPOIS do parse — tarde demais").toBeLessThan(iParse);
    });
  }
});
