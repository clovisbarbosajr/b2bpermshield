import { describe, it, expect } from "vitest";
import { restringeLocais } from "./restringeLocais";

describe("restringeLocais: sem local cadastrado abre, sem conseguir ler fecha", () => {
  it("admin nunca e restringido", () => {
    expect(restringeLocais("admin", 0, null)).toBe(false);
    expect(restringeLocais("admin", 3, null)).toBe(false);
    // Nem quando a leitura falha: admin ja ve tudo por policy.
    expect(restringeLocais("admin", 0, "network error")).toBe(false);
  });

  it("com locais cadastrados, restringe", () => {
    expect(restringeLocais("warehouse", 2, null)).toBe(true);
    expect(restringeLocais("manager", 1, null)).toBe(true);
  });

  it("sem local cadastrado e leitura OK, NAO restringe (acesso amplo proposital)", () => {
    expect(restringeLocais("warehouse", 0, null)).toBe(false);
  });

  // O DEFEITO. Falha de leitura devolvia zero local, e zero local abria a tela
  // inteira para um usuario restrito — a mesma classe de bug ja corrigida em
  // `UsersManagement.openEdit`.
  it("leitura FALHADA fecha, mesmo com zero local", () => {
    expect(restringeLocais("warehouse", 0, "TypeError: Failed to fetch")).toBe(true);
    expect(restringeLocais("manager", 0, "JWT expired")).toBe(true);
  });

  it("role ausente e tratado como nao-admin", () => {
    expect(restringeLocais(null, 0, "erro")).toBe(true);
    expect(restringeLocais(undefined, 2, null)).toBe(true);
  });
});
