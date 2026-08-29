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
// ESTE LINT JA FALHOU DUAS VEZES, e as duas por deixar passar o que ele existe
// para pegar:
//
//  1ª versao, tres furos:
//    - o regex era `\.slice\(\s*[^)]*?,\s*[^)]*?\.indexOf\(`, e o `[^)]*?` do
//      PRIMEIRO argumento nao atravessa `)`: a forma canonica escapava inteira,
//      junto com `substring`, `lastIndexOf` e a forma quebrada em duas linhas;
//    - `RAIZ = "src"` ignorava `supabase/functions`, que o vitest tambem roda;
//    - o filtro `includes("readFileSync")` descartava quem lesse por helper.
//    Resultado: 12 recortes vulneraveis vivos, dois em arquivos ja migrados.
//
//  2ª versao (contagem de parenteses), um furo: a contagem nao entendia string.
//    Um parentese DESBALANCEADO dentro de literal — `fonte.indexOf("(")` — fazia
//    o nivel nunca voltar a zero, e o recorte sumia da varredura calado. Ver
//    `semLiterais`.

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

const NL = String.fromCharCode(10);

/**
 * Uma `/` inicia REGEX (e nao divisao) quando o ultimo caractere significativo
 * antes dela nao pode terminar uma expressao. Heuristica classica de lexer.
 */
function podeIniciarRegex(ateAqui: string): boolean {
  const anterior = ateAqui.replace(/\s+$/, "");
  if (anterior === "") return true;
  const ultimo = anterior[anterior.length - 1];
  // Depois destes, `/` so pode ser divisao.
  if (/[\w$\])]/.test(ultimo)) {
    // ...com a excecao das palavras-chave, onde `/` volta a ser regex.
    return /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(anterior);
  }
  return true;
}

/**
 * Troca por espaco tudo que e string, template ou comentario, preservando o
 * TAMANHO do arquivo — os numeros de linha precisam continuar certos.
 *
 * Sem isto a contagem de parenteses erra dos DOIS lados, e as duas falhas foram
 * demonstradas no repositorio:
 *
 *  - FALSO NEGATIVO, que e a perda de protecao: parentese desbalanceado dentro
 *    de string faz o nivel nunca fechar, a busca sai sem achar, e o recorte some
 *    da varredura calado;
 *  - FALSO POSITIVO: `s.slice(0, "(".length)` e legitimo, mas o parentese da
 *    string fazia a varredura atravessar linhas e engolir um `.indexOf(` sem
 *    relacao nenhuma. E exemplo dentro de docblock era acusado, porque o filtro
 *    anterior so tratava comentario de linha.
 */
function semLiterais(fonte: string): string {
  let saida = "";
  let i = 0;
  const branco = (t: string) => t.replace(/[^\n]/g, " ");
  while (i < fonte.length) {
    const c = fonte[i];
    const dois = fonte.slice(i, i + 2);
    if (dois === "//") {
      const fim = fonte.indexOf(NL, i);
      const ate = fim === -1 ? fonte.length : fim;
      saida += branco(fonte.slice(i, ate)); i = ate; continue;
    }
    if (dois === "/*") {
      const fim = fonte.indexOf("*/", i + 2);
      const ate = fim === -1 ? fonte.length : fim + 2;
      saida += branco(fonte.slice(i, ate)); i = ate; continue;
    }
    // REGEX LITERAL antes das aspas: `/["(]/ ` tem aspas DENTRO, e sem tratar isso
    // uma quantidade impar delas abre uma string fantasma que branqueia o resto do
    // arquivo — a varredura para de ver os recortes seguintes, calada. Era o furo
    // nº1 de volta pela terceira vez, por um mecanismo novo.
    //
    // Distinguir divisao de regex e indecidivel sem parser; o criterio usado e o
    // classico: uma `/` inicia regex quando o ultimo token significativo NAO pode
    // terminar uma expressao. Erro aqui, nos dois sentidos, no maximo devolve o
    // comportamento anterior — nunca acusa recorte que nao existe.
    if (c === "/" && podeIniciarRegex(saida)) {
      let j = i + 1;
      let emClasse = false;
      while (j < fonte.length) {
        const d = fonte[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;                 // regex nao atravessa linha: nao era regex
        if (d === "[") emClasse = true;
        else if (d === "]") emClasse = false;
        else if (d === "/" && !emClasse) { j++; break; }
        j++;
      }
      saida += branco(fonte.slice(i, j)); i = j; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < fonte.length && fonte[j] !== c) {
        if (fonte[j] === "\\") j++;      // escape: pula o proximo
        j++;
      }
      const ate = Math.min(j + 1, fonte.length);
      saida += branco(fonte.slice(i, ate)); i = ate; continue;
    }
    saida += c; i++;
  }
  return saida;
}

/**
 * Acha os recortes cujo LIMITE vem de uma busca, lendo a expressao BALANCEADA.
 *
 * Regex nao serve, e a 1ª versao provou. Contar parenteses da a resposta exata —
 * desde que a contagem ignore o que esta dentro de literal, que foi o furo da 2ª.
 */
function recortesAMao(fonte: string): { linha: number; texto: string }[] {
  const achados: { linha: number; texto: string }[] = [];
  const BUSCA = /\.(?:indexOf|lastIndexOf|search)\(/;
  const linhas = fonte.split(NL);
  const limpo = semLiterais(fonte);
  for (const m of limpo.matchAll(/\.(?:slice|substring)\(/g)) {
    const abre = m.index! + m[0].length - 1;
    let nivel = 0, fim = -1;
    for (let i = abre; i < limpo.length; i++) {
      if (limpo[i] === "(") nivel++;
      else if (limpo[i] === ")") { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim < 0) continue;
    if (!BUSCA.test(limpo.slice(abre + 1, fim))) continue;
    const linha = limpo.slice(0, m.index!).split(NL).length;
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
    const pega = [
      'const b = s.slice(s.indexOf("a"), s.indexOf("b"));',       // forma canonica
      'const b = s.slice(i, s.indexOf("b", i));',
      'const b = m.substring(0, m.lastIndexOf("b"));',
      `const b = s.slice(${NL}  i,${NL}  s.indexOf("b"),${NL});`,  // quebrada
      // OS CASOS DA 2ª FALHA: parentese desbalanceado dentro de string. Cada um
      // deles escapava inteiro da versao anterior.
      'const b = fonte.slice(fonte.indexOf("("), fonte.indexOf("useEffect"));',
      'const b = fonte.slice(fonte.indexOf("a"), fonte.indexOf(")"));',
      `const b = s.slice(s.indexOf(\`(\${x}\`), s.indexOf("b"));`,
    ];
    for (const c of pega) expect(recortesAMao(c), `deveria PEGAR: ${c}`).toHaveLength(1);

    // OS CASOS DA 3ª FALHA: regex literal com aspas dentro. Uma quantidade IMPAR
    // abria string fantasma e branqueava o resto — o recorte logo abaixo sumia.
    const depoisDeRegex = (r: string) =>
      `const re = ${r};${NL}const b = fonte.slice(fonte.indexOf("a"), fonte.indexOf("b"));`;
    for (const r of ['/["(]/', '/"/', "/'/", '/[(]/', `/\\bx"y/g`]) {
      expect(recortesAMao(depoisDeRegex(r)), `regex ${r} escondeu o recorte seguinte`)
        .toHaveLength(1);
    }
    // E divisao NAO pode ser lida como regex: se fosse, o `"` seguinte abriria
    // string fantasma e o recorte sumiria de novo.
    expect(recortesAMao(
      `const m = (a) / 2;${NL}const b = fonte.slice(fonte.indexOf("a"), fonte.indexOf("b"));`,
    ), "divisao lida como regex").toHaveLength(1);

    const ignora = [
      'const b = s.slice(0, 40);',
      'const i = s.indexOf("a"); const b = s.slice(i, i + 10);',
      'expect(fonte.indexOf("x")).toBeGreaterThan(-1);',
      // Legitimo, e a versao anterior acusava: o parentese da string fazia a
      // varredura atravessar linhas ate um `.indexOf(` sem relacao.
      `const n = s.slice(0, "(".length);${NL}const j = outro.indexOf("x");`,
      // Exemplo dentro de docblock — prosa, nao codigo.
      `/**${NL} * NAO FACA: const b = f.slice(f.indexOf(a), f.indexOf(b));${NL} */${NL}const x = 1;`,
      `// NAO FACA: const b = f.slice(f.indexOf(a), f.indexOf(b));`,
    ];
    for (const c of ignora) expect(recortesAMao(c), `NAO deveria acusar: ${c}`).toHaveLength(0);
  });

  it("recorte com limite de busca usa `fatiaEntre`", () => {
    const culpados: string[] = [];
    for (const arq of arquivos) {
      // SEM filtro de `readFileSync`: a 1ª versao pulava todo arquivo que nao
      // continha essa palavra, e um helper `ler()` num modulo separado bastava
      // para 7 recortes sumirem da varredura calados.
      for (const r of recortesAMao(readFileSync(arq, "utf8"))) {
        culpados.push(`${arq}:${r.linha}  ${r.texto}`);
      }
    }
    expect(culpados, [
      "Recorte a mao: se o marcador do limite sumir, a busca devolve -1 e o",
      "`slice(i, -1)` pega quase o arquivo inteiro — o teste fica verde e para de",
      "proteger. Use `fatiaEntre(fonte, de, ate)` de `src/test/fatia.ts`.",
      "", ...culpados,
    ].join(NL)).toEqual([]);
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
