import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readdirSync, readFileSync, statSync } from "node:fs";

// LINT EXECUTAVEL contra o defeito que mais se repetiu neste projeto.
//
// Teste que le o arquivo-fonte e recorta um bloco com
// `fonte.slice(fonte.indexOf(a), fonte.indexOf(b))` fica VERDE e para de
// proteger quando um dos marcadores some: a busca devolve -1, `slice(i, -1)`
// pega quase o arquivo inteiro, e as assercoes casam com qualquer outro trecho.
//
// Aconteceu QUATRO vezes, e nas quatro o teste continuou passando enquanto a
// guarda que ele deveria proteger era removida. Use `fatiaEntre` de
// `src/test/fatia.ts`, que exige os dois marcadores e a ordem entre eles.
//
// A PRIMEIRA VERSAO DESTE LINT TINHA TRES FUROS, e os tres deixaram passar
// exatamente o que ele existia para pegar:
//
//  1. o regex era `\.slice\(\s*[^)]*?,\s*[^)]*?\.indexOf\(` — o `[^)]*?` do
//     PRIMEIRO argumento nao atravessa `)`, entao
//     `fonte.slice(fonte.indexOf(a), fonte.indexOf(b))` — a forma canonica, a
//     que o docblock de `fatia.ts` chama de "recorte ingenuo" — ESCAPAVA. Com
//     ela escapavam `substring`, `lastIndexOf` e a forma quebrada em duas linhas
//     (o scan era linha a linha);
//  2. `RAIZ = "src"` ignorava `supabase/functions`, que o `vitest.config.ts`
//     inclui desde 28/ago — e que e o codigo que roda com service role;
//  3. o filtro `if (!fonte.includes("readFileSync")) continue` descartava todo
//     arquivo que lesse o fonte por um helper — padrao que um dos testes ja usa.
//
// Com os furos, 12 recortes vulneraveis seguiam no repositorio, dois deles em
// arquivos que a propria migracao tinha tocado, e um deles demonstrado deixando
// a suite verde com a protecao quebrada.

const RAIZES = ["src", "supabase/functions"];

function arquivosDeTeste(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = `${dir}/${nome}`;
    if (statSync(caminho).isDirectory()) { saida.push(...arquivosDeTeste(caminho)); continue; }
    if (/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

/** Comenta fora comentarios de linha, para nao acusar exemplo dentro de prosa. */
const semComentarios = (fonte: string) =>
  fonte.split("\n").map((l) => (l.trimStart().startsWith("//") ? "" : l)).join("\n");

/**
 * Acha os recortes cujo LIMITE vem de uma busca, lendo a expressao BALANCEADA.
 *
 * Regex nao serve aqui, e a primeira versao provou: `[^)]*?` no primeiro
 * argumento nao atravessa `)`, entao a forma canonica escapava. Casar por janela
 * de linhas cobre a forma quebrada, mas acusa trechos distantes sem relacao.
 * Contar parenteses da a resposta exata: o que esta DENTRO desta chamada de
 * `slice`, e nada alem — em quantas linhas ela estiver.
 */
function recortesAMao(fonte: string): { linha: number; texto: string }[] {
  const achados: { linha: number; texto: string }[] = [];
  const BUSCA = /\.(?:indexOf|lastIndexOf|search)\(/;
  const linhas = fonte.split("\n");
  for (const m of fonte.matchAll(/\.(?:slice|substring)\(/g)) {
    const abre = m.index! + m[0].length - 1;
    let nivel = 0, fim = -1;
    for (let i = abre; i < fonte.length; i++) {
      if (fonte[i] === "(") nivel++;
      else if (fonte[i] === ")") { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim < 0) continue;
    if (!BUSCA.test(fonte.slice(abre + 1, fim))) continue;
    const linha = fonte.slice(0, m.index!).split("\n").length;
    achados.push({ linha, texto: (linhas[linha - 1] ?? "").trim() });
  }
  return achados;
}

describe("nenhum teste recorta fonte a mao", () => {
  const arquivos = RAIZES.flatMap(arquivosDeTeste)
    .filter((f) => !f.endsWith("src/test/fatiaSemGuarda.test.ts"));

  it("a varredura cobre os dois roots que o vitest roda", () => {
    // Se o caminhamento quebrar, o lint passaria vazio — o mesmo modo de falha
    // que ele existe para impedir. Confere os DOIS roots separadamente: um total
    // global sobe quando alguem acrescenta teste, e mascara a perda do outro.
    for (const raiz of RAIZES) {
      expect(arquivos.filter((f) => f.startsWith(raiz + "/")).length,
        `a varredura nao achou teste nenhum em ${raiz}`).toBeGreaterThan(0);
    }
    expect(arquivos.length).toBeGreaterThan(30);
  });

  it("o proprio detector funciona", () => {
    // Sem isto, um erro no `recortesAMao` faria o lint passar sempre — a mesma
    // classe de falha silenciosa que ele existe para impedir.
    const casos = [
      'const b = s.slice(s.indexOf("a"), s.indexOf("b"));',      // forma canonica
      'const b = s.slice(i, s.indexOf("b", i));',
      'const b = m.substring(0, m.lastIndexOf("b"));',
      'const b = s.slice(\n  i,\n  s.indexOf("b"),\n);',           // quebrada
    ];
    for (const c of casos) expect(recortesAMao(c), c).toHaveLength(1);
    // E nao acusa o que e legitimo.
    for (const ok of [
      'const b = s.slice(0, 40);',
      'const i = s.indexOf("a"); const b = s.slice(i, i + 10);',
      'expect(fonte.indexOf("x")).toBeGreaterThan(-1);',
    ]) expect(recortesAMao(ok), ok).toHaveLength(0);
  });

  it("recorte com limite de busca usa `fatiaEntre`", () => {
    const culpados: string[] = [];
    for (const arq of arquivos) {
      // SEM filtro de `readFileSync`: a primeira versao pulava todo arquivo que
      // nao continha essa palavra, e um helper `ler()` num modulo separado
      // bastava para 7 recortes sumirem da varredura calados.
      for (const r of recortesAMao(semComentarios(readFileSync(arq, "utf8")))) {
        culpados.push(`${arq}:${r.linha}  ${r.texto}`);
      }
    }
    expect(culpados, [
      "Recorte a mao: se o marcador do limite sumir, a busca devolve -1 e o",
      "`slice(i, -1)` pega quase o arquivo inteiro — o teste fica verde e para de",
      "proteger. Use `fatiaEntre(fonte, de, ate)` de `src/test/fatia.ts`.",
      "", ...culpados,
    ].join("\n")).toEqual([]);
  });

  // LIMITACAO CONHECIDA, registrada em vez de fingida: indice guardado em
  // variavel (`const j = s.indexOf(x); s.slice(i, j)`) nao e detectado — exigiria
  // analise de fluxo. O que este lint garante e que a forma DIRETA, que e a que
  // apareceu nas quatro vezes, nao volta.
  it("o helper continua em uso", () => {
    const usam = arquivos.filter((f) => readFileSync(f, "utf8").includes("fatiaEntre("));
    expect(usam.length, "ninguem mais usa `fatiaEntre` — a migracao foi revertida?")
      .toBeGreaterThan(3);
  });
});
