import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readdirSync, readFileSync, statSync } from "node:fs";

// LINT EXECUTAVEL contra o defeito que mais se repetiu neste projeto.
//
// Teste que le o arquivo-fonte e recorta um bloco com
// `fonte.slice(fonte.indexOf(a), fonte.indexOf(b))` fica VERDE e para de
// proteger quando um dos marcadores some: `indexOf` devolve -1, `slice(i, -1)`
// pega quase o arquivo inteiro, e as assercoes casam com qualquer outro trecho.
//
// Aconteceu tres vezes, e nas tres o teste continuou passando enquanto a guarda
// que ele deveria proteger era removida. A blindagem foi escrita a mao num
// arquivo e esquecida nos outros — por isso ela virou `src/test/fatia.ts`, e por
// isso este teste existe: recorte novo feito a mao reprova aqui.

const RAIZ = "src";

function arquivosDeTeste(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = `${dir}/${nome}`;
    if (statSync(caminho).isDirectory()) { saida.push(...arquivosDeTeste(caminho)); continue; }
    if (/\.test\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

// `slice(` recebendo um `indexOf(` como SEGUNDO argumento — o padrao perigoso.
// O primeiro argumento sem guarda tambem erra, mas o efeito e recortar do fim
// para tras (bloco vazio), que falha alto em vez de passar calado.
const RECORTE_A_MAO = /\.slice\(\s*[^)]*?,\s*[^)]*?\.indexOf\(/;

describe("nenhum teste recorta fonte a mao", () => {
  const arquivos = arquivosDeTeste(RAIZ).filter((f) => !f.endsWith("src/test/fatiaSemGuarda.test.ts"));

  it("acha os arquivos de teste do projeto", () => {
    // Se o caminhamento quebrar, o teste passaria vazio — que e o mesmo modo de
    // falha que ele existe para impedir.
    expect(arquivos.length, "a varredura nao achou teste nenhum").toBeGreaterThan(30);
  });

  it("recorte com delimitador final usa `fatiaEntre`", () => {
    const culpados: string[] = [];
    for (const arq of arquivos) {
      const fonte = readFileSync(arq, "utf8");
      // So interessa quem le arquivo-fonte; teste de unidade normal pode usar
      // `slice` a vontade.
      if (!fonte.includes("readFileSync")) continue;
      for (const [n, linha] of fonte.split("\n").entries()) {
        if (linha.trimStart().startsWith("//")) continue;
        if (RECORTE_A_MAO.test(linha)) culpados.push(`${arq}:${n + 1}  ${linha.trim()}`);
      }
    }
    expect(culpados, [
      "Recorte a mao: se o marcador final sumir, `indexOf` devolve -1 e",
      "`slice(i, -1)` pega quase o arquivo inteiro — o teste fica verde e para de",
      "proteger. Use `fatiaEntre(fonte, de, ate)` de `src/test/fatia.ts`, que exige",
      "os dois marcadores e a ordem entre eles.",
      "", ...culpados,
    ].join("\n")).toEqual([]);
  });
});
