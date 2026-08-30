import { describe, it, expect } from "vitest";
import { percentualEmFaixa } from "./percentual";

describe("percentualEmFaixa", () => {
  // ESTE E O ASSERT QUE JUSTIFICA A FUNCAO. `parseFloat("-8.25") || 0` devolve
  // -8.25, porque negativo e truthy — foi assim que uma aliquota negativa chegava
  // ao banco, onde nao ha CHECK nenhum em `tax_rates.percentual`.
  it("negativo vira 0, e nao passa pelo `|| 0`", () => {
    expect(percentualEmFaixa("-8.25")).toBe(0);
    expect(percentualEmFaixa("-0.01")).toBe(0);
    expect(percentualEmFaixa(-100)).toBe(0);
    // A prova de que o idioma antigo era furado:
    expect(parseFloat("-8.25") || 0).toBe(-8.25);
  });

  it("acima do teto vira o teto", () => {
    expect(percentualEmFaixa("150")).toBe(100);
    expect(percentualEmFaixa("100.01")).toBe(100);
    expect(percentualEmFaixa("120", 50)).toBe(50);
  });

  it("valor legitimo passa intacto", () => {
    expect(percentualEmFaixa("8.25")).toBe(8.25);
    expect(percentualEmFaixa("0")).toBe(0);
    expect(percentualEmFaixa("100")).toBe(100);
    expect(percentualEmFaixa(7)).toBe(7);
  });

  // O `<input type="number">` manda `""` enquanto o admin apaga para redigitar.
  // `NaN` no estado quebrava a tela inteira, e nao so o campo.
  it("entrada invalida vira 0, nunca NaN", () => {
    expect(percentualEmFaixa("")).toBe(0);
    expect(percentualEmFaixa("abc")).toBe(0);
    expect(percentualEmFaixa(NaN)).toBe(0);
    expect(percentualEmFaixa(Infinity)).toBe(0);
    expect(percentualEmFaixa(-Infinity)).toBe(0);
  });

  // O efeito no banco: `sales_tax = total * pct/100`. Com pct negativo o trigger
  // SUBTRAI do total, e `Checkout.tsx` nem imprime a linha (ela esta sob
  // `salesTax > 0`) — some dinheiro sem rastro na tela.
  it("o imposto derivado nunca fica negativo", () => {
    for (const bruto of ["-8.25", "-0.5", "abc", "-999"]) {
      expect(1000 * percentualEmFaixa(bruto) / 100).toBeGreaterThanOrEqual(0);
    }
  });
});
