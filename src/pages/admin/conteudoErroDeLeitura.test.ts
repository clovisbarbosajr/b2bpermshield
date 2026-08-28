import { describe, it, expect } from "vitest";
// Mesma nota de `estoqueUpdateCondicional.test.ts`: `tsconfig.app.json` declara
// `"types": ["vitest/globals"]`, entao os tipos do Node nao entram e o
// `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o modulo existe.
// @ts-expect-error
import { readFileSync } from "node:fs";

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
];

describe("telas de conteudo: leitura que falha nao vira 'nao existe nada'", () => {
  for (const { arquivo, tabela } of telas) {
    it(`${arquivo}: le o error do select de ${tabela} e o trata`, () => {
      const fonte = ler(arquivo);
      const select = fonte.match(
        new RegExp(`const \\{[^}]*\\} = await supabase\\.from\\("${tabela}"\\)\\.select\\([^;]*;`),
      );
      expect(select, `nao achei o select de ${tabela}`).toBeTruthy();
      // Este e o assert que morre se alguem voltar ao `const { data }`.
      expect(select![0]).toMatch(/const \{ data, error \}/);
      expect(fonte).toMatch(/if \(error\) \{\s*setLoadError\(error\.message\)/);
    });

    it(`${arquivo}: o ramo de erro vem antes do estado vazio`, () => {
      const fonte = ler(arquivo);
      const erro = fonte.indexOf(": loadError ? (");
      const vazio = fonte.search(/: \w+\.length === 0 \? \(/);
      expect(erro, "nao achei o ramo de erro na renderizacao").toBeGreaterThan(-1);
      expect(vazio, "nao achei o estado vazio na renderizacao").toBeGreaterThan(-1);
      expect(erro).toBeLessThan(vazio);
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
