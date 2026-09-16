import { describe, it, expect } from "vitest";
// @ts-expect-error — tsconfig.app.json nao inclui os tipos do Node; vitest roda em Node.
import { readFileSync } from "node:fs";
import { entrarComSenha } from "./loginComSenha";

describe("entrarComSenha", () => {
  it("sucesso: devolve o user", async () => {
    const auth = { signInWithPassword: async () => ({ data: { user: { id: "u1" } }, error: null }) };
    expect(await entrarComSenha(auth, " a@b.com ", "x")).toEqual({ ok: true, user: { id: "u1" }, motivo: "" });
  });

  it("erro devolvido (senha errada): motivo do auth", async () => {
    const auth = { signInWithPassword: async () => ({ data: null, error: { message: "Invalid login credentials" } }) };
    expect(await entrarComSenha(auth, "a@b.com", "x")).toEqual({ ok: false, user: null, motivo: "Invalid login credentials" });
  });

  // O caso do relato: a promise REJEITA (assinante de onAuthStateChange estourou
  // depois de a sessao ja ter sido gravada). Antes: botao preso, sem aviso.
  it("excecao (promise rejeitada): vira erro visivel, nao trava", async () => {
    const auth = { signInWithPassword: async () => { throw new Error("subscriber exploded"); } };
    expect(await entrarComSenha(auth, "a@b.com", "x")).toEqual({ ok: false, user: null, motivo: "subscriber exploded" });
  });

  it("e-mail e aparado antes de ir ao auth", async () => {
    let visto = "";
    const auth = { signInWithPassword: async (c: { email: string }) => { visto = c.email; return { data: { user: null }, error: null }; } };
    await entrarComSenha(auth, "  a@b.com  ", "x");
    expect(visto).toBe("a@b.com");
  });
});

describe("as duas telas de login passam pelo helper", () => {
  for (const arq of ["src/pages/AdminLogin.tsx", "src/pages/CustomerLogin.tsx"]) {
    it(arq, () => {
      const fonte = readFileSync(arq, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(fonte).toContain('from "@/lib/loginComSenha"');
      expect(fonte).toMatch(/await entrarComSenha\(supabase\.auth, email, password\)/);
      // a chamada crua, sem try/catch, e o que deixava a tela parada
      expect(fonte).not.toMatch(/await supabase\.auth\.signInWithPassword\(/);
      // o botao e liberado ANTES de decidir o que fazer com o resultado
      expect(fonte).toMatch(/await entrarComSenha\([^)]*\);\s*\n\s*setLoading\(false\);/);
    });
  }
});
