import { describe, it, expect } from "vitest";
import { validarCadastro, REQUIRED, MAX_LEN, type CadastroForm } from "./cadastroCliente";

const valido = (): CadastroForm => ({
  empresa: "Acme", nome: "Jane Doe", telefone: "555-0100", activity: "",
  endereco: "1 Main St", endereco2: "", cidade: "Miami", estado: "", pais: "United States",
  cep: "33101", email: "jane@acme.com", password: "12345678", passwordConfirm: "12345678",
});

describe("validarCadastro", () => {
  it("ficha valida passa, com opcionais vazios", () => {
    expect(validarCadastro(valido())).toBeNull();
  });

  it.each(REQUIRED)("obrigatorio %s vazio ou so espacos falha", (k) => {
    expect(validarCadastro({ ...valido(), [k]: "" })).toMatch(/is required/);
    expect(validarCadastro({ ...valido(), [k]: "   " })).toMatch(/is required/);
  });

  it("confirmacao diferente falha", () => {
    expect(validarCadastro({ ...valido(), passwordConfirm: "123456789" })).toMatch(/does not match/);
  });

  it("senha: 7 falha, 8 passa", () => {
    expect(validarCadastro({ ...valido(), password: "1234567", passwordConfirm: "1234567" })).toMatch(/at least 8/);
    expect(validarCadastro({ ...valido(), password: "abcdefgh", passwordConfirm: "abcdefgh" })).toBeNull();
  });

  it.each(["jane", "jane@acme", "jane @acme.com", "@acme.com"])("e-mail invalido %s falha", (email) => {
    expect(validarCadastro({ ...valido(), email })).toMatch(/valid email/);
  });

  const limites: [keyof CadastroForm, number][] = [
    ["empresa", MAX_LEN.texto], ["nome", MAX_LEN.texto], ["endereco", MAX_LEN.texto], ["endereco2", MAX_LEN.texto],
    ["cidade", MAX_LEN.texto], ["estado", MAX_LEN.texto], ["activity", MAX_LEN.texto], ["pais", MAX_LEN.texto],
    ["telefone", MAX_LEN.telefone], ["cep", MAX_LEN.cep],
  ];
  it.each(limites)("limite de %s: N passa, N+1 falha", (k, n) => {
    expect(validarCadastro({ ...valido(), [k]: "x".repeat(n) })).toBeNull();
    expect(validarCadastro({ ...valido(), [k]: "x".repeat(n + 1) })).toMatch(/at most/);
  });

  it("limite do e-mail: 254 passa, 255 falha", () => {
    const email = (n: number) => "a".repeat(n - "@acme.com".length) + "@acme.com";
    expect(validarCadastro({ ...valido(), email: email(254) })).toBeNull();
    expect(validarCadastro({ ...valido(), email: email(255) })).toMatch(/at most/);
  });
});
