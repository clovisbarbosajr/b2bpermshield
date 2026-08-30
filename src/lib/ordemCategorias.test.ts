import { describe, it, expect } from "vitest";
import { reordenarIrmaos, comoARecarregaOrdena } from "./ordemCategorias";

/**
 * Teste COMPORTAMENTAL, e nao regex sobre o texto-fonte.
 *
 * A versao anterior desta guarda vivia dentro da tela e era vigiada por um regex
 * que exigia literalmente `if (swapCat.ordem === cat.ordem)` — ou seja, a suite
 * verde estava TRAVANDO a forma que continha o defeito. Aqui a pergunta e a que
 * o admin faz: depois de clicar e a tela recarregar, o item foi UMA casa?
 */
const cat = (nome: string, ordem: number) => ({ id: nome, nome, ordem });

/** O que o admin ve depois do clique: reindexa 0..n-1, grava, e recarrega. */
const depoisDoClique = (irmaos: ReturnType<typeof cat>[], idx: number, dir: "up" | "down") => {
  const nova = reordenarIrmaos(irmaos, idx, dir);
  const gravado = nova.map((c, i) => ({ ...c, ordem: i }));
  return comoARecarregaOrdena(gravado).map((c) => c.nome);
};

describe("Move up/down anda exatamente uma casa", () => {
  it("com `ordem` toda distinta", () => {
    const irmaos = [cat("A", 0), cat("B", 1), cat("C", 2)];
    expect(depoisDoClique(irmaos, 0, "down")).toEqual(["B", "A", "C"]);
    expect(depoisDoClique(irmaos, 2, "up")).toEqual(["A", "C", "B"]);
  });

  it("com o PAR empatado — o botao nao pode ficar sem efeito", () => {
    // `ordem` e NOT NULL DEFAULT 0 e o formulario parte de 0: tres categorias
    // criadas por esta tela ficam todas com 0. A troca de dois valores gravava
    // 0 e 0, as duas escritas PASSAVAM, e o botao nao fazia nada.
    const irmaos = [cat("A", 0), cat("B", 0), cat("C", 0)];
    expect(depoisDoClique(irmaos, 0, "down")).toEqual(["B", "A", "C"]);
  });

  it("com OUTROS irmaos empatados — o caso que andava DUAS casas", () => {
    // `Z(0), A(1), B(1)`: a guarda do par nao disparava (0 !== 1), a troca
    // gravava Z:=1 e A:=0, e a releitura por `(ordem, nome)` punha Z DEPOIS de
    // B. Um clique, duas casas, sem toast nenhum.
    const irmaos = [cat("Z", 0), cat("A", 1), cat("B", 1)];
    expect(depoisDoClique(irmaos, 0, "down")).toEqual(["A", "Z", "B"]);
  });

  it("nao sai da borda", () => {
    const irmaos = [cat("A", 0), cat("B", 1)];
    expect(reordenarIrmaos(irmaos, 0, "up")).toBe(irmaos);
    expect(reordenarIrmaos(irmaos, 1, "down")).toBe(irmaos);
  });

  it("a recarga desempata por nome, como o `.order(\"ordem\").order(\"nome\")`", () => {
    expect(comoARecarregaOrdena([cat("B", 1), cat("A", 1), cat("C", 0)]).map((c) => c.nome))
      .toEqual(["C", "A", "B"]);
  });
});
