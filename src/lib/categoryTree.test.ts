import { describe, it, expect } from "vitest";
import { categoryPath, categoryTreeOptions, rootCategories } from "./categoryTree";

// Testes que EXECUTAM. As duas funcoes sao puras — nao ha desculpa para conferir
// texto-fonte aqui.

const c = (id: string, nome: string, parent_id: string | null = null, ordem = 0) =>
  ({ id, nome, parent_id, ordem });

describe("categoryTreeOptions: orfa nao pode sumir do dropdown", () => {
  // A lista chega FILTRADA por `ativo` nos dois chamadores (`ProductEdit:141`,
  // `Pedidos:73`). Desativar a categoria-PAI deixa a filha ativa com um
  // `parent_id` que nao esta na lista — orfa. Semeando o walk com
  // `childrenOf(null)`, ela sumia do dropdown inteiro: nao dava para cadastrar
  // produto nela, e o produto ja cadastrado abria com "Category *" em branco.
  // O caminho natural do admin ali e escolher outra categoria — recategorizando
  // sem querer.
  it("filha de pai AUSENTE da lista aparece como raiz", () => {
    const lista = [c("filha", "PermTread", "pai-inativo")];   // o pai foi filtrado
    const opcoes = categoryTreeOptions(lista);
    expect(opcoes.map((o) => o.id), "a orfa sumiu do dropdown").toContain("filha");
    expect(opcoes).toHaveLength(1);
    expect(opcoes[0].label, "orfa e raiz: sem recuo").toBe("PermTread");
  });

  it("arvore normal continua com o recuo por nivel", () => {
    const opcoes = categoryTreeOptions([
      c("r", "Union NJ"), c("f", "One Plus", "r"), c("n", "Blue Box", "f"),
    ]);
    expect(opcoes.map((o) => o.label)).toEqual(["Union NJ", "- One Plus", "-- Blue Box"]);
  });

  it("nao duplica: orfa que TAMBEM e filha de alguem presente entra uma vez so", () => {
    const opcoes = categoryTreeOptions([c("r", "Raiz"), c("f", "Filha", "r")]);
    expect(opcoes.filter((o) => o.id === "f")).toHaveLength(1);
  });

  it("respeita `ordem` e depois o nome", () => {
    const opcoes = categoryTreeOptions([
      c("b", "Beta", null, 2), c("a", "Alfa", null, 1), c("c", "Aaa", null, 2),
    ]);
    expect(opcoes.map((o) => o.id)).toEqual(["a", "c", "b"]);
  });

  it("usa a mesma semente de `rootCategories`", () => {
    // Se as duas divergirem, o portal e o admin voltam a discordar sobre o que e
    // raiz — que e exatamente o bug que `rootCategories` veio consertar.
    const lista = [c("orfa", "Orfa", "sumiu"), c("raiz", "Raiz")];
    expect(categoryTreeOptions(lista).map((o) => o.id).sort())
      .toEqual(rootCategories(lista).map((r) => r.id).sort());
  });
});

describe("categoryPath: ciclo nao vira caminho falso", () => {
  it("caminho normal", () => {
    const lista = [c("r", "Union NJ"), c("f", "One Plus", "r"), c("n", "Blue Box", "f")];
    expect(categoryPath(lista, "n")).toBe("Union NJ › One Plus › Blue Box");
  });

  // `parent_id` circular e alcancavel: so a TELA impede (`Categorias.tsx:211,218`),
  // nao ha constraint no banco, e o comentario do modulo cita importacao e edicao
  // direta. Com so o limite de profundidade, o breadcrumb saia repetido —
  // "A › B › A › B › ..." — na tela de pedido.
  it("ciclo A->B->A para no primeiro repetido, sem inventar segmento", () => {
    const lista = [c("a", "A", "b"), c("b", "B", "a")];
    expect(categoryPath(lista, "a")).toBe("B › A");
  });

  it("auto-referencia nao trava nem repete", () => {
    expect(categoryPath([c("x", "X", "x")], "x")).toBe("X");
  });

  it("id ausente devolve vazio", () => {
    expect(categoryPath([c("a", "A")], "nao-existe")).toBe("");
    expect(categoryPath([c("a", "A")], null)).toBe("");
  });

  it("cadeia longa e legitima nao e truncada", () => {
    // O limite antigo era 12; uma arvore funda e legitima perdia o topo em
    // silencio. Com `visto` o corte e por ciclo, nao por profundidade.
    const lista = Array.from({ length: 20 }, (_, i) =>
      c(`n${i}`, `N${i}`, i === 0 ? null : `n${i - 1}`));
    expect(categoryPath(lista, "n19").split(" › ")).toHaveLength(20);
  });
});
