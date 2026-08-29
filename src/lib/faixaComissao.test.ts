/**
 * A faixa da comissao, EXECUTADA.
 *
 * `comissao_percentual` e multiplicada em `reports/OrderRepsPerformance.tsx:69`
 * (`o.total * (rate / 100)`) e exportada em CSV para o financeiro. O `|| 0` de
 * antes nao pegava negativo (`-5` e truthy) e nao tinha teto: digitar `1500`
 * achando que e valor fixo virava comissao de 15x a receita, gravada sem um pio.
 *
 * A faixa 0..100 nao e invencao — e a do B2BWave, conferida no formulario dele
 * (`admin/sales_reps/new`: `sales_rep[commission]` com `min="0" max="100"
 * step="0.1"`). Somos um clone.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — tipos do Node fora do tsconfig; em execucao existe.
import { readFileSync } from "node:fs";

// A funcao mora no componente; aqui ela e reexecutada a partir da MESMA fonte,
// para o teste nao ser uma segunda implementacao do que diz testar.
const fonte = readFileSync("src/pages/admin/Representantes.tsx", "utf-8");
const corpo = fonte.match(/const faixaComissao = \(v: string\) => \{[\s\S]*?\n  \};/);
if (!corpo) throw new Error("nao achei `faixaComissao` em Representantes.tsx");
// eslint-disable-next-line no-new-func
const faixaComissao = new Function(
  `${corpo[0].replace(/: string/, "")} return faixaComissao;`,
)() as (v: string) => number;

describe("faixaComissao", () => {
  it("aceita o que esta na faixa, com uma casa decimal", () => {
    expect(faixaComissao("0")).toBe(0);
    expect(faixaComissao("7.5")).toBe(7.5);
    expect(faixaComissao("100")).toBe(100);
  });

  it("corta acima de 100 — o caso do `1500` digitado como valor fixo", () => {
    expect(faixaComissao("1500")).toBe(100);
    expect(faixaComissao("101")).toBe(100);
  });

  it("corta abaixo de 0 — o `|| 0` de antes deixava passar", () => {
    // `-5 || 0` devolve -5: comissao negativa abatendo o total no relatorio.
    expect(faixaComissao("-5")).toBe(0);
    expect(faixaComissao("-0.1")).toBe(0);
  });

  it("campo vazio ou lixo vira 0, e nunca NaN", () => {
    // NaN aqui vira `numeric` invalido no INSERT, ou pior, silencioso.
    for (const v of ["", "abc", "1,5,5", " "]) {
      expect(Number.isFinite(faixaComissao(v)), `entrada ${JSON.stringify(v)}`).toBe(true);
    }
    expect(faixaComissao("")).toBe(0);
    expect(faixaComissao("abc")).toBe(0);
  });

  it("o input declara a mesma faixa do B2BWave", () => {
    // O `min`/`max` sozinho nao valida (o Input nao esta dentro de um `<form>`),
    // mas ele e o que o admin VE — divergir dele confundiria mais que ajudaria.
    expect(fonte, "o input perdeu a faixa 0..100").toMatch(/min="0" max="100" step="0\.1"/);
    expect(fonte, "o onChange voltou a nao limitar a faixa")
      .toContain("comissao_percentual: faixaComissao(e.target.value)");
  });
});
