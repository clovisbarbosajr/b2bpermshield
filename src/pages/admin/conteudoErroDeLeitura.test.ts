import { describe, it, expect } from "vitest";
// Mesma nota de `estoqueUpdateCondicional.test.ts`: `tsconfig.app.json` declara
// `"types": ["vitest/globals"]`, entao os tipos do Node nao entram e o
// `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o modulo existe.
// @ts-expect-error
import { readFileSync, readdirSync } from "node:fs";
import { fatiaDoRender } from "@/test/fatia";

// TESTE DE FIACAO (montar a tela exigiria `@testing-library/dom`, que nao esta
// instalado — RTL 16 o tem como peer e o repo nao tem nenhum teste de render).
//
// O QUE ELE PROTEGE: as tres telas de conteudo faziam
// `const { data } = await supabase...` e caiam em `data ?? []`. Lista vazia por
// FALHA de leitura ficava identica a lista vazia de verdade, e a tela afirmava
// "No banners yet" com um botao de criar do lado. O admin recriava banner e
// noticia que ja existiam (em `paginas` o UNIQUE do slug barrava). A leitura
// agora le o `error`, e o ramo de erro vem ANTES do estado vazio — a tela nao
// pode afirmar que nao existe conteudo quando ela nao conseguiu ler.

const ler = (arquivo: string) =>
  readFileSync(new URL(arquivo, import.meta.url), "utf8");

const telas = [
  { arquivo: "./Banners.tsx", tabela: "banners" },
  { arquivo: "./Noticias.tsx", tabela: "noticias" },
  { arquivo: "./Paginas.tsx", tabela: "paginas" },
  // `Brands` ENTROU. Ela era a unica das cinco sem o ramo de erro — o comentario
  // no arquivo AFIRMAVA a correcao, mas so o toast tinha sido aplicado, e a tela
  // continuava mostrando "No brands yet" quando a leitura falhava. Estar fora
  // desta lista foi o que deixou passar.
  { arquivo: "./Brands.tsx", tabela: "brands" },
  { arquivo: "./Representantes.tsx", tabela: "representantes" },
  // `Categorias` entrou quando ganhou o `loadError`: sem ele a tela dizia "No
  // categories yet" com a leitura falhada, e a lista vazia ainda desarmava a
  // guarda de ciclo (`parentesProibidos`).
  { arquivo: "./Categorias.tsx", tabela: "categorias" },
  // `Produtos` entrou com forma DIFERENTE: ela le por `fetchAllRows`, que LANCA
  // em vez de devolver `{ data, error }`. Exigir `const { data, error }` dela
  // reprovaria a correcao certa — o `catch` E a leitura do erro. O que as duas
  // formas tem em comum, e o que este teste cobra, e o `setLoadError` ser
  // alimentado pela falha, ser limpo no sucesso, e o ramo de erro vir antes do
  // texto de estado vazio.
  { arquivo: "./Produtos.tsx", tabela: "produtos", forma: "lanca" },
  // `TabelasPreco` entrou quando ganhou o `loadError`: sem ele a tela exibia o
  // card "No price lists yet" com um botao "Create Price List" do lado, e
  // `tabelas_preco.nome` nao tem UNIQUE — recriar duplica sem barreira, e os
  // quatro `Map` por nome do sync do B2BWave passam a resolver para uma das duas
  // de forma indefinida.
  { arquivo: "./TabelasPreco.tsx", tabela: "tabelas_preco" },
  // `Estoque` entrou na forma que LANCA (le por `fetchAllRows`). Ela e o caso mais
  // caro desta lista: o banner NAO limpa a grade, porque numa tela de inventario
  // apagar os numeros por causa de um refetch falho tira do operador o pouco que
  // ele tinha. O que ele precisa saber e que os numeros sao de ANTES — sem isso,
  // um refetch falho deixava Total/Reserved/Available exibindo o estado anterior
  // sem nada indicando, e a reposicao era decidida em cima deles.
  { arquivo: "./Estoque.tsx", tabela: "produtos", forma: "lanca" },
];

describe("telas de conteudo: leitura que falha nao vira 'nao existe nada'", () => {
  for (const { arquivo, tabela, forma } of telas as Array<{ arquivo: string; tabela: string; forma?: "lanca" }>) {
    it(`${arquivo}: le o error do select de ${tabela} e o trata`, () => {
      const fonte = ler(arquivo);
      if (forma === "lanca") {
        // `fetchAllRows` LANCA em vez de devolver `{ data, error }`. O equivalente
        // do assert abaixo e existir um `catch` que ALIMENTA o `loadError` — sem
        // ele o erro morre num `console.error` e a tela volta a afirmar que nao
        // existe nada. O `[\s\S]{0,300}?` cobre o corpo do catch com folga.
        expect(fonte, `nao achei a leitura de ${tabela}`).toContain(`.from("${tabela}")`);
        // SEM COMENTARIO na medida da distancia: o `catch` de `Estoque` tem um
        // bloco de dezoito linhas explicando o defeito, e a janela de 300 chars
        // contava o comentario como se fosse codigo — a guarda reprovava a
        // correcao por causa do texto que a documenta.
        const semCom = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(semCom, "o catch da leitura nao alimenta o `loadError`")
          .toMatch(/\} catch \([\s\S]{0,300}?setLoadError\(/);
      } else {
      // `[\s\S]{0,40}?` entre o `from` e o `select`: `Categorias` quebra a cadeia
      // em varias linhas, e exigir os dois colados so casava o estilo de uma
      // linha so.
      const select = fonte.match(
        new RegExp(`const \\{[^}]*\\} = await supabase[\\s\\S]{0,20}?\\.from\\("${tabela}"\\)[\\s\\S]{0,40}?\\.select\\([^;]*;`),
      );
      expect(select, `nao achei o select de ${tabela}`).toBeTruthy();
      // Este e o assert que morre se alguem voltar ao `const { data }`.
      expect(select![0]).toMatch(/const \{ data, error \}/);
      // Duas formas equivalentes no repo: `if (error) { setLoadError(error.message) }`
      // e `setLoadError(error ? error.message : null)`. O que importa e o `error`
      // ALIMENTAR o estado — exigir uma das duas reprovava a outra.
      //
      // FICA DENTRO DO `else`: na forma que LANCA, a variavel do catch nao se
      // chama `error`, e o assert equivalente ja foi feito acima contra o `catch`.
      // Deixa-lo compartilhado exigia renomear a variavel do catch so para agradar
      // o teste — teste ditando nome de variavel e teste errado.
      expect(fonte, "o `error` da leitura nao alimenta o `loadError`")
        .toMatch(/setLoadError\(\s*error/);
      }
      // E O CAMINHO DE SUCESSO TEM QUE LIMPAR. Sem isto, depois de uma falha
      // transitoria o "Try again" recarrega os dados mas o card de erro nunca sai
      // — o ramo de erro vem antes do conteudo, entao a tela fica travada no erro
      // com os dados carregados atras. Apagar essa linha passava verde.
      //
      // Duas formas: `setLoadError(null)` explicito no sucesso, ou o ternario
      // `setLoadError(error ? error.message : null)`, que ja limpa sozinho.
      const limpa = /setLoadError\(null\)/.test(fonte) ||
        /setLoadError\(\s*error \?[^)]*:\s*null\s*\)/.test(fonte);
      expect(limpa, "o `loadError` nunca e limpo no caminho de sucesso").toBe(true);
    });

    it(`${arquivo}: o ramo de erro vem antes do estado vazio`, () => {
      const fonte = ler(arquivo);
      // A INVARIANTE E SOBRE O TEXTO, e nao sobre o `.length === 0`.
      //
      // Nas telas de card o ramo de erro vem ANTES do bloco vazio; na tabela de
      // `Categorias` ele vem DENTRO dele, antes do texto. As duas formas estao
      // certas — o que nao pode e a tela IMPRIMIR "No ... yet" quando a leitura
      // falhou. Comparar com o `.length === 0` reprovava a segunda forma.
      //
      // SO O JSX: `search` no arquivo inteiro pegava ocorrencia de helper acima
      // do `return (`.
      const jsx = fatiaDoRender(fonte);
      // TRES formas de abrir o ramo de erro no repo: `) : loadError ? (` nas telas
      // de card, `{loadError ? (` dentro da celula da tabela, e `{loadError && (`
      // onde o erro NAO substitui o conteudo — que e o caso de `Estoque`, em que a
      // grade continua na tela de proposito, com o aviso de que os numeros sao de
      // antes. Exigir so as duas primeiras reprovava a terceira, que esta certa.
      const erroJsx = jsx.search(/[:{]\s*loadError (\? \(|&& \()/);
      // Duas redacoes no repo: "No banners yet" e "No products found". Exigir so
      // a primeira nao achava o estado vazio de `Produtos`, e o assert de ordem
      // passava a comparar contra -1 — verde sem proteger nada.
      const textoVazio = jsx.search(/No [a-z ]+ (yet|found)/);
      expect(erroJsx, "nao achei o ramo de erro na renderizacao").toBeGreaterThan(-1);
      expect(textoVazio, "nao achei o texto de estado vazio").toBeGreaterThan(-1);
      expect(erroJsx, "a tela imprime 'nao existe nada' antes de conferir o erro de leitura")
        .toBeLessThan(textoVazio);
    });
  }

  // Upload leva segundos; `setForm({ ...form, ... })` grava o snapshot do render
  // em que o handler nasceu e apaga o que o admin digitou durante a subida.
  it("Banners.tsx: o upload atualiza o form por funcao, nao por snapshot", () => {
    const upload = ler("./Banners.tsx").match(/getPublicUrl\(path\);[\s\S]*?setForm\([^;]*;/);
    expect(upload, "nao achei o setForm depois do getPublicUrl").toBeTruthy();
    expect(upload![0]).toMatch(/setForm\(\(f\) => \(\{ \.\.\.f,/);
  });
});

// A LISTA ACIMA TEM QUE COBRIR A PASTA.
//
// `Brands.tsx` passou meses com o defeito por um motivo so: ela nao estava no
// array. Uma tela nova de conteudo entra na pasta e ninguem lembra de acrescentar
// aqui — entao o teste passa a exigir que toda tela com o par `loadError` +
// estado vazio esteja listada.
describe("a lista de telas nao fica para tras", () => {
  it("toda tela de admin com loadError e estado vazio esta coberta", () => {
    const dir = "src/pages/admin";
    const candidatas = readdirSync(dir)
      .filter((n: string) => n.endsWith(".tsx"))
      .filter((n: string) => {
        const fonte = readFileSync(`${dir}/${n}`, "utf8");
        // DUAS formas de estado vazio, e as duas existem no repo: o ternario
        // `x.length === 0 ? (` e o curto-circuito `x.length === 0 && (`. Enxergar
        // so o ternario deixava uma tela nova escrita com `&&` escapar da rede —
        // pelo mesmo motivo que `Brands.tsx` escapou.
        // O estado vazio conta so se estiver no JSX do render. `.length === 0 &&`
        // tambem aparece em guarda de negocio (`InventoryAdjustment.tsx:338`), e
        // isso acusava tela correta de estar fora da lista.
        const jsx = fatiaDoRender(fonte);
        return /const \[loadError/.test(fonte) && /\.length === 0 \s*(\?|&&)/.test(jsx);
      });
    const cobertas = new Set(telas.map((t) => t.arquivo.replace("./", "")));
    const faltando = candidatas.filter((n: string) => !cobertas.has(n));
    expect(
      faltando,
      "tela com `loadError` fora da lista deste teste — foi assim que `Brands.tsx` escapou",
    ).toEqual([]);
  });
});
