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
];

describe("telas de conteudo: leitura que falha nao vira 'nao existe nada'", () => {
  for (const { arquivo, tabela } of telas) {
    it(`${arquivo}: le o error do select de ${tabela} e o trata`, () => {
      const fonte = ler(arquivo);
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
      expect(fonte, "o `error` da leitura nao alimenta o `loadError`")
        .toMatch(/setLoadError\(\s*error/);
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
      // Duas formas de abrir o ramo de erro: `) : loadError ? (` nas telas de
      // card, e `{loadError ? (` dentro da celula da tabela.
      const erroJsx = jsx.search(/[:{]\s*loadError \? \(/);
      const textoVazio = jsx.search(/No [a-z ]+ yet/);
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
