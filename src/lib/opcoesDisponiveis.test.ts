import { describe, expect, it } from "vitest";
// @ts-expect-error — tsconfig.app.json nao inclui os tipos do Node; vitest roda em Node.
import { readFileSync } from "node:fs";
import { opcoesDisponiveis } from "./opcoesDisponiveis";

const op = (id: string, privado: boolean | null = false) => ({ id, privado });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("opcoesDisponiveis", () => {
  it("sem atribuicao: so as publicas (privado false ou null)", () => {
    const r = opcoesDisponiveis([op("a"), op("p", true), op("b", null)], new Set());
    expect(ids(r)).toEqual(["a", "b"]);
  });

  it("com atribuicao (publica + privada): so as atribuidas", () => {
    const r = opcoesDisponiveis([op("a"), op("p", true), op("b"), op("q", true)], new Set(["b", "p"]));
    expect(ids(r)).toEqual(["p", "b"]);
  });

  it("relato: 5 publicas, 3 marcadas -> exatamente as 3, na ordem da lista", () => {
    const cinco = ["f1", "f2", "f3", "f4", "f5"].map((id) => op(id));
    const r = opcoesDisponiveis(cinco, new Set(["f5", "f2", "f3"]));
    expect(ids(r)).toEqual(["f2", "f3", "f5"]);
  });

  it("atribuicao so a id inexistente: cai nas publicas", () => {
    const r = opcoesDisponiveis([op("a"), op("p", true)], new Set(["sumiu"]));
    expect(ids(r)).toEqual(["a"]);
  });

  it("privada nunca aparece sem marcacao, com ou sem outras atribuicoes", () => {
    const lista = [op("a"), op("p", true)];
    expect(ids(opcoesDisponiveis(lista, new Set()))).not.toContain("p");
    expect(ids(opcoesDisponiveis(lista, new Set(["a"])))).not.toContain("p");
  });

  it("preserva a ordem de entrada", () => {
    const lista = [op("z"), op("m"), op("a")];
    expect(ids(opcoesDisponiveis(lista, new Set()))).toEqual(["z", "m", "a"]);
  });

  it("Checkout usa a funcao para frete e pagamento, sem a regra antiga", () => {
    const src: string = readFileSync("src/pages/portal/Checkout.tsx", "utf8");
    expect(src.split("opcoesDisponiveis(").length - 1).toBe(2);
    expect(src).not.toContain("canSee");
  });
});
