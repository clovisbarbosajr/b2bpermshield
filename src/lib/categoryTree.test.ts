import { describe, it, expect } from "vitest";
import { catalogCategoryButtons, rootCategories, type CatNode } from "@/lib/categoryTree";

// Árvore igual à da tela do dono:
//   Accessories - FL  (raiz)
//     ├ End Cap        (folha)
//     ├ PermTread      (folha)
//     └ Reducer        (folha)
//   Union NJ          (raiz)
//     └ One Plus       (tem filha)
//        └ Character   (folha)
const cats: CatNode[] = [
  { id: "acc", nome: "Accessories - FL", parent_id: null, ordem: 1 },
  { id: "endcap", nome: "End Cap", parent_id: "acc", ordem: 1 },
  { id: "permtread", nome: "PermTread", parent_id: "acc", ordem: 2 },
  { id: "reducer", nome: "Reducer", parent_id: "acc", ordem: 3 },
  { id: "union", nome: "Union NJ", parent_id: null, ordem: 2 },
  { id: "oneplus", nome: "One Plus", parent_id: "union", ordem: 1 },
  { id: "character", nome: "Character", parent_id: "oneplus", ordem: 1 },
];
const ids = (r: CatNode[]) => r.map((c) => c.id);

describe("catalogCategoryButtons", () => {
  it("sem categoria escolhida mostra as raizes", () => {
    expect(ids(catalogCategoryButtons(cats, null))).toEqual(["acc", "union"]);
    expect(ids(catalogCategoryButtons(cats, undefined))).toEqual(["acc", "union"]);
  });

  it("categoria COM filhas mostra as filhas", () => {
    expect(ids(catalogCategoryButtons(cats, "acc"))).toEqual(["endcap", "permtread", "reducer"]);
  });

  it("PEDIDO DO DONO — categoria folha mostra as IRMAS, nao lista vazia", () => {
    // Era aqui que a barra sumia: PermTread nao tem filhas.
    const r = catalogCategoryButtons(cats, "permtread");
    expect(ids(r)).toEqual(["endcap", "permtread", "reducer"]);
    expect(r.length).toBeGreaterThan(0);
  });

  it("a propria categoria esta entre as irmas (pra ficar destacada na tela)", () => {
    expect(ids(catalogCategoryButtons(cats, "reducer"))).toContain("reducer");
  });

  it("da pra pular direto de uma folha para outra sem passar pelo pai", () => {
    const dePermTread = ids(catalogCategoryButtons(cats, "permtread"));
    const deReducer = ids(catalogCategoryButtons(cats, "reducer"));
    expect(dePermTread).toContain("reducer");
    expect(deReducer).toContain("permtread");
  });

  it("folha em nivel 3 mostra as irmas daquele nivel", () => {
    expect(ids(catalogCategoryButtons(cats, "character"))).toEqual(["character"]);
  });

  it("categoria de nivel 2 COM filha continua descendo", () => {
    expect(ids(catalogCategoryButtons(cats, "oneplus"))).toEqual(["character"]);
  });

  it("id inexistente (categoria privada, filtrada pela visibilidade) cai nas raizes", () => {
    expect(ids(catalogCategoryButtons(cats, "nao-existe"))).toEqual(["acc", "union"]);
  });

  it("raiz sem filhas mostra as raizes (nao fica vazio)", () => {
    const soRaizes: CatNode[] = [
      { id: "a", nome: "A", parent_id: null },
      { id: "b", nome: "B", parent_id: null },
    ];
    expect(ids(catalogCategoryButtons(soRaizes, "a"))).toEqual(["a", "b"]);
  });

  it("lista vazia nao quebra", () => {
    expect(catalogCategoryButtons([], "qualquer")).toEqual([]);
    expect(catalogCategoryButtons([], null)).toEqual([]);
  });

  it("preserva a ordem em que as categorias chegaram (a query ja ordena por ordem/nome)", () => {
    const fora: CatNode[] = [
      { id: "p", nome: "Pai", parent_id: null },
      { id: "z", nome: "Zebra", parent_id: "p", ordem: 1 },
      { id: "a", nome: "Abacate", parent_id: "p", ordem: 2 },
    ];
    expect(ids(catalogCategoryButtons(fora, "p"))).toEqual(["z", "a"]);
  });

  // Achado do caçador (confirmado pelo cético): a lista chega filtrada por
  // `ativo = true` e pela visibilidade do cliente. Basta o dono DESATIVAR a
  // categoria-pai pra todas as filhas virarem órfãs — e aí nenhuma tinha
  // `parent_id` nulo, `roots` vinha vazio e a barra sumia na HOME do catálogo.
  describe("categoria orfa (pai desativado ou invisivel)", () => {
    const orfas: CatNode[] = [
      { id: "endcap", nome: "End Cap", parent_id: "acc-desativada" },
      { id: "permtread", nome: "PermTread", parent_id: "acc-desativada" },
    ];

    it("na HOME do catalogo as orfas viram raizes (barra nao some)", () => {
      expect(ids(catalogCategoryButtons(orfas, null))).toEqual(["endcap", "permtread"]);
    });

    it("dentro de uma orfa, as outras orfas do mesmo pai sumido sao as irmas", () => {
      expect(ids(catalogCategoryButtons(orfas, "permtread"))).toEqual(["endcap", "permtread"]);
    });

    it("orfa convivendo com raiz de verdade — as duas aparecem", () => {
      const misto: CatNode[] = [
        { id: "union", nome: "Union NJ", parent_id: null },
        { id: "orfa", nome: "Orfa", parent_id: "sumida" },
      ];
      expect(ids(catalogCategoryButtons(misto, null))).toEqual(["union", "orfa"]);
    });
  });

  describe("rootCategories", () => {
    it("sem orfa, e so quem tem parent_id nulo", () => {
      expect(ids(rootCategories(cats))).toEqual(["acc", "union"]);
    });
    it("com orfa, ela entra como raiz", () => {
      const misto: CatNode[] = [
        { id: "r", nome: "Raiz", parent_id: null },
        { id: "o", nome: "Orfa", parent_id: "sumida" },
        { id: "f", nome: "Filha da raiz", parent_id: "r" },
      ];
      expect(ids(rootCategories(misto))).toEqual(["r", "o"]);
    });
  });

  it("orfa (parent_id apontando pra categoria que sumiu) nao fica com barra vazia", () => {
    // Caso real: a categoria-pai e privada e some da lista, a filha nao.
    const orfa: CatNode[] = [
      { id: "raiz", nome: "Raiz", parent_id: null },
      { id: "filha", nome: "Filha orfa", parent_id: "pai-sumido" },
    ];
    const r = catalogCategoryButtons(orfa, "filha");
    expect(r.length).toBeGreaterThan(0);
  });
});
