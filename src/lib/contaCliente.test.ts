import { describe, it, expect } from "vitest";
import { contaLiberada } from "./contaCliente";

describe("contaLiberada", () => {
  // VIGIA — o defeito que isto existe para pegar: cadastro aberto + ficha
  // `pendente` enxergando o catalogo inteiro com preco.
  it("BLOQUEIA ficha pendente", () => {
    expect(contaLiberada({ status: "pendente", is_active: true })).toBe(false);
  });

  it("BLOQUEIA os demais status da denylist, em PT e EN", () => {
    for (const st of ["inativo", "rejeitado", "suspenso",
                      "pending", "inactive", "rejected", "suspended", "blocked"]) {
      expect(contaLiberada({ status: st, is_active: true })).toBe(false);
    }
  });

  it("BLOQUEIA is_active = false, mesmo com status ativo", () => {
    expect(contaLiberada({ status: "ativo", is_active: false })).toBe(false);
  });

  it("BLOQUEIA quando nao ha ficha", () => {
    expect(contaLiberada(null)).toBe(false);
    expect(contaLiberada(undefined)).toBe(false);
  });

  it("nao se deixa enganar por caixa alta nem espaco", () => {
    expect(contaLiberada({ status: " PENDENTE " })).toBe(false);
    expect(contaLiberada({ status: "Pending" })).toBe(false);
  });

  // CONTROLE — sem estes, uma funcao que devolve `false` para TODO mundo
  // passaria nos testes acima e trancaria o cliente legitimo do lado de fora.
  it("PERMITE cliente ativo", () => {
    expect(contaLiberada({ status: "ativo", is_active: true })).toBe(true);
  });

  it("PERMITE status desconhecido (denylist e conservadora de proposito)", () => {
    expect(contaLiberada({ status: "vip", is_active: true })).toBe(true);
  });

  it("PERMITE is_active nulo — a coluna e opcional e ficha antiga pode nao ter", () => {
    expect(contaLiberada({ status: "ativo", is_active: null })).toBe(true);
    expect(contaLiberada({ status: "ativo" })).toBe(true);
  });
});
