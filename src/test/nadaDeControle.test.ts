/**
 * Nenhum byte de controle no codigo-fonte.
 *
 * POR QUE ISTO EXISTE. Escrever `\b` num arquivo passando por heredoc de shell
 * ja produziu, DUAS vezes neste projeto, o byte 0x08 (backspace) LITERAL no lugar
 * da sequencia de dois caracteres. As duas vezes dentro de uma expressao regular
 * de teste, e as duas vezes com o mesmo efeito: aquele ramo do regex vira codigo
 * morto — nenhum fonte normal contem um backspace — e a assercao passa a aceitar
 * qualquer coisa.
 *
 *   1a vez: `importadoresLoteGuardas.test.ts`, o assert do cabecalho virou no-op;
 *           reverter UM ponto da correcao passava verde.
 *   2a vez: `guardasPortal.test.ts`, `clienteId:\s*clienteId\b` virou
 *           `clienteId:\s*clienteId\x08`. Alem de nao proteger, REPROVAVA a forma
 *           explicita `clienteId: clienteId` — que o proprio teste dizia aceitar.
 *
 * O sintoma e o pior que um teste pode ter: verde, e sem proteger nada. E e
 * invisivel em revisao — o editor nao mostra o byte, e `git diff` tambem nao.
 *
 * TAB (0x09), LF (0x0a) e CR (0x0d) sao legitimos e ficam de fora.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it, expect } from "vitest";

// `supabase/migrations` ENTROU: o `.sql` estava na lista de extensoes mas casava
// ZERO arquivos, porque as migrations moram fora das outras raizes. Alternativa
// morta numa lista que anuncia cobertura e exatamente a classe de defeito que
// este arquivo existe para pegar — e migration escrita por heredoc e o vetor
// descrito no cabecalho.
const RAIZES = ["src", "supabase/functions", "supabase/migrations", "scripts"];
// So as extensoes que EXISTEM nestas raizes hoje: 161 .tsx, 95 .ts, 194 .sql,
// 3 .mjs, 2 .css. `js`, `cjs` e `json` estavam na lista casando zero arquivos —
// alternativa morta que anuncia cobertura que nao existe, a mesma classe de
// defeito que este arquivo existe para pegar. O teste abaixo exige que cada
// extensao anunciada case alguma coisa, entao acrescentar uma nova sem arquivo
// reprova na hora.
const EXTENSOES = /\.(ts|tsx|mjs|sql|css)$/;
const IGNORAR = new Set(["node_modules", "dist", ".git"]);

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = `${dir}/${nome}`;
    if (statSync(caminho).isDirectory()) arquivos(caminho, saida);
    else if (EXTENSOES.test(nome)) saida.push(caminho);
  }
  return saida;
}

// Tudo abaixo de 0x20 menos TAB, LF e CR — mais DEL (0x7f).
const CONTROLE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

describe("nenhum byte de controle no fonte", () => {
  const todos = RAIZES.flatMap((r) => arquivos(r));

  it("varre uma quantidade plausivel de arquivos", () => {
    // Se o caminho quebrar e a lista vier vazia, o teste passaria sem olhar nada.
    expect(todos.length).toBeGreaterThan(400);
    // E cada extensao anunciada tem que casar ALGUMA coisa. `sql` e `json`
    // ficaram meses casando zero.
    for (const ext of ["ts", "tsx", "mjs", "sql", "css"]) {
      expect(todos.filter((f) => f.endsWith(`.${ext}`)).length, `nenhum .${ext} varrido`)
        .toBeGreaterThan(0);
    }
  });

  it("nenhum arquivo tem byte de controle", () => {
    const sujos: string[] = [];
    for (const caminho of todos) {
      const texto = readFileSync(caminho, "utf-8");
      const linhas = texto.split("\n");
      linhas.forEach((linha, i) => {
        const m = CONTROLE.exec(linha);
        if (!m) return;
        const codigo = m[0].charCodeAt(0).toString(16).padStart(2, "0");
        sujos.push(`${caminho}:${i + 1} byte 0x${codigo} na coluna ${m.index + 1}`);
      });
    }
    expect(
      sujos,
      "byte de controle no fonte — quase sempre uma sequencia de escape que o " +
        "shell comeu ao escrever o arquivo (o classico e o backslash-b virando 0x08 " +
        "dentro de um regex, que fica verde e para de proteger)",
    ).toEqual([]);
  });

  it("o proprio detector reprova um byte plantado", () => {
    // Sem isto, um erro no regex `CONTROLE` deixaria o teste acima verde para
    // sempre — e ele existe justamente contra assercao que nao consegue falhar.
    expect(CONTROLE.test(`clienteId${String.fromCharCode(8)}`)).toBe(true);
    expect(CONTROLE.test("clienteId\\b")).toBe(false);
    expect(CONTROLE.test("linha\tcom\ttab")).toBe(false);
    expect(CONTROLE.test("linha\r\ncom crlf")).toBe(false);
  });
});
