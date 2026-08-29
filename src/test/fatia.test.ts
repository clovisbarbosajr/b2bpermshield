/**
 * As guardas do proprio `fatiaEntre` — EXECUTADAS.
 *
 * `src/test/fatia.ts` existe porque o recorte ingenuo
 * (`fonte.slice(fonte.indexOf(de), fonte.indexOf(ate))`) ja quebrou TRES vezes
 * neste projeto, sempre do mesmo jeito: com o marcador ausente, `indexOf`
 * devolve -1, `slice(i, -1)` recorta quase o arquivo inteiro, e as assercoes
 * passam batendo em outro trecho. O teste fica verde e para de proteger.
 *
 * Mas as guardas dele nunca foram exercitadas: um cacador apagou o
 * `expect(f).toBeGreaterThan(i)` e a suite de 512 testes ficou VERDE. O arquivo
 * que protege o resto do repo era o unico sem protecao.
 */
import { describe, it, expect } from "vitest";
import { fatiaEntre, fatiaAPartirDe, fatiaAPartirDoUltimo } from "./fatia";

const FONTE = [
  "linha zero",
  "INICIO",
  "  meio 1",
  "  meio 2",
  "FIM",
  "depois do fim",
  "bem depois",
].join("\n");

describe("fatiaEntre", () => {
  it("recorta entre os dois marcadores, sem incluir o final", () => {
    const r = fatiaEntre(FONTE, "INICIO", "FIM");
    expect(r).toContain("meio 1");
    expect(r).toContain("meio 2");
    expect(r).not.toContain("depois do fim");
  });

  it("marcador inicial ausente REPROVA, em vez de recortar do zero", () => {
    expect(() => fatiaEntre(FONTE, "NAO EXISTE", "FIM")).toThrow(/marcador inicial/i);
  });

  it("marcador final ausente REPROVA, em vez de recortar ate o fim do arquivo", () => {
    // O caso exato dos tres incidentes: `indexOf` devolve -1 e `slice(i, -1)`
    // pega quase tudo. Sem esta guarda, o recorte de 1064 linhas de
    // `resendPlacar.test.ts` casava com o `handleSave` e ninguem via.
    expect(() => fatiaEntre(FONTE, "INICIO", "NAO EXISTE")).toThrow(/marcador final/i);
  });

  it("marcador final ANTES do inicial REPROVA", () => {
    // Tambem produz `slice` invertido, que devolve string vazia — e assercao
    // sobre string vazia passa em `not.toContain`, silenciosamente.
    expect(() => fatiaEntre(FONTE, "FIM", "INICIO")).toThrow(/marcador final/i);
  });

  it("teto de linhas REPROVA recorte maior que o esperado", () => {
    // Os dois marcadores podem existir e mesmo assim o recorte pegar coisa
    // demais, quando o marcador final so aparece muito depois.
    expect(() => fatiaEntre(FONTE, "linha zero", "bem depois", 2)).toThrow();
    expect(fatiaEntre(FONTE, "INICIO", "FIM", 4)).toContain("meio 1");
  });
});

describe("fatiaAPartirDe", () => {
  it("recorta do marcador ate o fim", () => {
    expect(fatiaAPartirDe(FONTE, "FIM")).toBe("FIM\ndepois do fim\nbem depois");
  });

  it("marcador ausente REPROVA", () => {
    expect(() => fatiaAPartirDe(FONTE, "NAO EXISTE")).toThrow(/marcador inicial/i);
  });
});

describe("fatiaAPartirDoUltimo", () => {
  const COM_REPETICAO = [
    "return (", "primeiro", ")", "meio", "return (", "segundo", ")",
  ].join("\n");

  it("recorta a partir da ULTIMA ocorrencia", () => {
    const r = fatiaAPartirDoUltimo(COM_REPETICAO, "return (");
    expect(r).toContain("segundo");
    expect(r).not.toContain("primeiro");
  });

  it("marcador ausente REPROVA, em vez de devolver o ultimo caractere", () => {
    // `lastIndexOf` ausente devolve -1 e `slice(-1)` recorta uma string de UM
    // caractere — em que toda assercao de "nao contem" passa, calada.
    expect(() => fatiaAPartirDoUltimo(COM_REPETICAO, "NAO EXISTE")).toThrow(/marcador inicial/i);
  });
});
