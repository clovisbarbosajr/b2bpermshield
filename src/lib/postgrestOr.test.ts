import { describe, it, expect } from "vitest";
import { valorOr } from "./postgrestOr";

/**
 * O `or=()` do PostgREST separa por VIRGULA e delimita por PARENTESES. Nome de
 * grupo de privacidade e texto livre do admin — `Dealers, Northeast` derrubava o
 * export inteiro, e `X,privacy_group_id.not.is.null` reescrevia o filtro.
 */
describe("valorOr", () => {
  const A = String.fromCharCode(34);
  const B = String.fromCharCode(92);

  it("envolve em aspas duplas", () => {
    expect(valorOr("VIP")).toBe(`${A}VIP${A}`);
  });

  it("virgula e parentese deixam de quebrar a expressao", () => {
    // Sem as aspas, a virgula virava separador de clausula e o PostgREST
    // devolvia 400 — o export morria num toast de parser.
    expect(valorOr("Dealers, Northeast")).toBe(`${A}Dealers, Northeast${A}`);
    expect(valorOr("Dealers (West)")).toBe(`${A}Dealers (West)${A}`);
  });

  it("clausula colada vira DADO, e nao filtro", () => {
    // Este e o valor que ampliava o conjunto retornado: sem aspas, o
    // `privacy_group_id.not.is.null` casava produto de qualquer grupo.
    const forjado = "X,privacy_group_id.not.is.null";
    expect(valorOr(forjado)).toBe(`${A}${forjado}${A}`);
    // Fora do par de aspas nao sobra virgula nenhuma.
    expect(valorOr(forjado).slice(1, -1)).not.toContain(A);
  });

  it("aspa e barra invertida sao escapadas", () => {
    expect(valorOr(`12${A} Plank`)).toBe(`${A}12${B}${A} Plank${A}`);
    expect(valorOr(`a${B}b`)).toBe(`${A}a${B}${B}b${A}`);
    // A barra escapa primeiro: senao a barra que ESCAPA a aspa seria escapada
    // de novo e a aspa voltaria a fechar o valor.
    expect(valorOr(`${B}${A}`)).toBe(`${A}${B}${B}${B}${A}${A}`);
  });

  it("nulo e indefinido viram string vazia entre aspas, e nao `null`", () => {
    expect(valorOr(null)).toBe(`${A}${A}`);
    expect(valorOr(undefined)).toBe(`${A}${A}`);
  });
});
