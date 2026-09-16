import { describe, expect, it } from "vitest";
import { COMPANY_ADDRESS_ID, montarOpcoesDeEndereco } from "./enderecoEntrega";

const contaCompleta = { endereco: "1800 N Powerline Rd", cidade: "Pompano Beach", estado: "FL", cep: "33069" };
const linha = (id: string, principal = false) => ({
  id, logradouro: `Rua ${id}`, cidade: "Miami", estado: "FL", cep: "33101", principal,
});

describe("montarOpcoesDeEndereco", () => {
  it("(1) enderecos vazia + conta completa: uma opcao company, default company", () => {
    const r = montarOpcoesDeEndereco([], contaCompleta);
    expect(r.opcoes).toEqual([{ id: COMPANY_ADDRESS_ID, rotulo: "Company address — 1800 N Powerline Rd, Pompano Beach, FL 33069" }]);
    expect(r.defaultId).toBe(COMPANY_ADDRESS_ID);
    expect(r.contaEndereco).toEqual({ logradouro: "1800 N Powerline Rd", complemento: "", cidade: "Pompano Beach", estado: "FL", cep: "33069" });
  });

  it("(2) conta so com endereco: opcao presente, rotulo sem virgula sobrando, default company", () => {
    const r = montarOpcoesDeEndereco([], { endereco: " 1800 N Powerline Rd ", cidade: null, estado: null, cep: null });
    expect(r.opcoes).toEqual([{ id: COMPANY_ADDRESS_ID, rotulo: "Company address — 1800 N Powerline Rd" }]);
    expect(r.defaultId).toBe(COMPANY_ADDRESS_ID);
    expect(r.contaEndereco).toEqual({ logradouro: "1800 N Powerline Rd", complemento: "", cidade: "", estado: "", cep: "" });
  });

  it("(3) conta vazia + enderecos vazia: zero opcoes, default vazio", () => {
    for (const conta of [{ endereco: "" }, { endereco: null }, { endereco: "   " }, null, undefined]) {
      const r = montarOpcoesDeEndereco([], conta);
      expect(r.opcoes).toEqual([]);
      expect(r.defaultId).toBe("");
      expect(r.contaEndereco).toBeNull();
    }
  });

  it("(4) linha principal + conta: default = principal, company continua listada", () => {
    const r = montarOpcoesDeEndereco([linha("a"), linha("b", true)], contaCompleta);
    expect(r.defaultId).toBe("b");
    expect(r.opcoes.map((o) => o.id)).toEqual([COMPANY_ADDRESS_ID, "a", "b"]);
  });

  it("(5) enderecos sem principal + conta com endereco: default company", () => {
    const r = montarOpcoesDeEndereco([linha("a"), linha("b")], contaCompleta);
    expect(r.defaultId).toBe(COMPANY_ADDRESS_ID);
  });

  it("(6) enderecos sem principal e conta sem endereco: default = primeira linha", () => {
    const r = montarOpcoesDeEndereco([linha("a"), linha("b")], { endereco: null });
    expect(r.defaultId).toBe("a");
    expect(r.opcoes.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("(7) rotulo da linha principal recebe (main)", () => {
    const r = montarOpcoesDeEndereco([linha("a", true)], null);
    expect(r.opcoes[0].rotulo).toBe("Rua a, Miami, FL 33101 (main)");
  });
});
