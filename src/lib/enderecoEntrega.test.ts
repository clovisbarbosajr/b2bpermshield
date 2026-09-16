import { describe, expect, it } from "vitest";
// @ts-expect-error — tsconfig.app.json nao inclui os tipos do Node; vitest roda em Node.
import { readFileSync } from "node:fs";
import { COMPANY_ADDRESS_ID, mesmoEndereco, montarOpcoesDeEndereco } from "./enderecoEntrega";

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

  it("(2) conta INCOMPLETA (so rua, ou 3 de 4 campos) nao vira opcao — mesma regra do Save Address", () => {
    // `enderecos.cidade/estado/cep` sao NOT NULL e o resto do portal exige os 4;
    // oferecer a conta parcial gravava "-" no pedido e uma linha nova por pedido.
    const soRua = montarOpcoesDeEndereco([], { endereco: " 1800 N Powerline Rd ", cidade: null, estado: null, cep: null });
    expect(soRua.opcoes).toEqual([]);
    expect(soRua.defaultId).toBe("");
    expect(soRua.contaEndereco).toBeNull();
    const semCep = montarOpcoesDeEndereco([], { endereco: "Rua X", cidade: "Pompano Beach", estado: "FL", cep: "  " });
    expect(semCep.opcoes).toEqual([]);
    expect(semCep.contaEndereco).toBeNull();
  });

  it("(2b) conta completa com endereco2: complemento entra no objeto normalizado", () => {
    const r = montarOpcoesDeEndereco([], { endereco: "Rua X", endereco2: " Suite 200 ", cidade: "Pompano Beach", estado: "FL", cep: "33069" });
    expect(r.contaEndereco?.complemento).toBe("Suite 200");
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

  it("(8) mesmoEndereco: ignora caixa/espacos, mas complemento/CEP diferentes NAO sao o mesmo", () => {
    const base = { logradouro: "1800 N Powerline Rd", complemento: "Ste A5", cidade: "Pompano Beach", estado: "FL", cep: "33069" };
    expect(mesmoEndereco(base, { ...base, cidade: " pOMPANO BEACH ", logradouro: "1800 n powerline rd" })).toBe(true);
    expect(mesmoEndereco(base, { ...base, complemento: "Ste A1" })).toBe(false);
    expect(mesmoEndereco(base, { ...base, cep: "33060" })).toBe(false);
    expect(mesmoEndereco({ ...base, complemento: null }, { ...base, complemento: "" })).toBe(true);
  });

  it("(9) o checkout exige endereco de entrega e reusa a linha da conta pelos 5 campos", () => {
    const src = readFileSync("src/pages/portal/Checkout.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    // sem endereco, o submit para ANTES de gravar o pedido
    // ORDEM prende o efeito: a guarda tem que vir ANTES do `return ok` (movida
    // para depois vira codigo morto e o texto continua la — mutante que passou).
    expect(src).toMatch(/if \(!enderecoId \|\| enderecoId === "__company__"\) \{\s*toast\.error\("Select or add a delivery address\."\);\s*return \{ ok: false, id: null \};\s*\}\s*return \{ ok: true, id: enderecoId \};/);
    expect(src).not.toContain("id: enderecoId || null");
    expect(src).toContain("enderecos.find(e => mesmoEndereco(e, companyAddress))");
    // a linha criada entra no estado, senao cada retentativa insere outra
    expect(src).toMatch(/setEnderecos\(prev => \[\.\.\.prev, created as any\]\);\s*return \{ ok: true, id: \(created as any\)\.id \};/);
  });

  it("(7) rotulo da linha principal recebe (main)", () => {
    const r = montarOpcoesDeEndereco([linha("a", true)], null);
    expect(r.opcoes[0].rotulo).toBe("Rua a, Miami, FL 33101 (main)");
  });
});
