import { describe, it, expect } from "vitest";
import { checkCartStock, normalizeStatus, type StockItem } from "@/lib/stock";

const item = (o: Partial<StockItem> & { produto_id: string; quantidade: number }): StockItem => ({
  nome: "Item", variante_id: null, ...o,
});
const key = (produto_id: string, variante_id?: string) => `${produto_id}::${variante_id ?? ""}`;

const STATUSES = [
  { nome: "available", permite_comprar: true },
  { nome: "sold out", permite_comprar: false },
  { nome: "pre-order", permite_comprar: true },
  { nome: "discontinued", permite_comprar: false },
];
const prod = (id: string, total: number, reservado = 0, status = "disponivel") =>
  ({ id, estoque_total: total, estoque_reservado: reservado, status_produto: status });

describe("normalizeStatus", () => {
  it("traduz os nomes pt do produto para os nomes en de product_statuses", () => {
    expect(normalizeStatus("pre_venda")).toBe("pre-order");
    expect(normalizeStatus("esgotado")).toBe("sold out");
    expect(normalizeStatus("estoque_limitado")).toBe("limited stock");
  });
  it("null/vazio conta como disponivel", () => {
    expect(normalizeStatus(null)).toBe("available");
    expect(normalizeStatus(undefined)).toBe("available");
  });
  it("status ja em ingles passa direto", () => {
    expect(normalizeStatus("Sold Out")).toBe("sold out");
  });
});

describe("checkCartStock — produto sem variante", () => {
  it("deixa passar quando tem estoque de sobra", () => {
    const r = checkCartStock([item({ produto_id: "p1", quantidade: 3 })], [prod("p1", 10)], STATUSES);
    expect(r.blocked.size).toBe(0);
    expect(r.insufficient.size).toBe(0);
  });

  it("desconta o reservado", () => {
    const r = checkCartStock([item({ produto_id: "p1", quantidade: 5 })], [prod("p1", 10, 8)], STATUSES);
    expect(r.insufficient.get(key("p1"))).toBe(2);
  });

  it("bloqueia quando o disponivel zera", () => {
    const r = checkCartStock([item({ produto_id: "p1", quantidade: 1 })], [prod("p1", 10, 10)], STATUSES);
    expect(r.blocked.has(key("p1"))).toBe(true);
  });

  it("bloqueia por status que nao permite comprar, mesmo com estoque", () => {
    const r = checkCartStock([item({ produto_id: "p1", quantidade: 1 })], [prod("p1", 99, 0, "descontinuado")], STATUSES);
    expect(r.blocked.has(key("p1"))).toBe(true);
  });

  it("pre-venda ignora o piso de estoque (backorder)", () => {
    const r = checkCartStock([item({ produto_id: "p1", quantidade: 500 })], [prod("p1", 0, 0, "pre_venda")], STATUSES);
    expect(r.blocked.size).toBe(0);
    expect(r.insufficient.size).toBe(0);
  });

  it("ignora produto que sumiu do catalogo (o banco decide no submit)", () => {
    const r = checkCartStock([item({ produto_id: "fantasma", quantidade: 1 })], [], STATUSES);
    expect(r.blocked.size).toBe(0);
    expect(r.insufficient.size).toBe(0);
  });
});

describe("checkCartStock — bug 68: duas variantes somam contra o estoque do produto", () => {
  const variantes = [
    { id: "vM", produto_id: "p1", quantidade: 50 },
    { id: "vG", produto_id: "p1", quantidade: 50 },
  ];

  it("6 + 6 com estoque 10 do produto: as DUAS linhas acusam", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vM", quantidade: 6 }),
       item({ produto_id: "p1", variante_id: "vG", quantidade: 6 })],
      [prod("p1", 10)], STATUSES, variantes,
    );
    expect(r.insufficient.has(key("p1", "vM"))).toBe(true);
    expect(r.insufficient.has(key("p1", "vG"))).toBe(true);
  });

  it("4 + 4 com estoque 10: passa (a soma cabe)", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vM", quantidade: 4 }),
       item({ produto_id: "p1", variante_id: "vG", quantidade: 4 })],
      [prod("p1", 10)], STATUSES, variantes,
    );
    expect(r.insufficient.size).toBe(0);
    expect(r.blocked.size).toBe(0);
  });

  it("produtos DIFERENTES nao somam entre si", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", quantidade: 8 }), item({ produto_id: "p2", quantidade: 8 })],
      [prod("p1", 10), prod("p2", 10)], STATUSES,
    );
    expect(r.insufficient.size).toBe(0);
  });
});

describe("checkCartStock — bug 35: estoque POR VARIANTE", () => {
  const variantes = [
    { id: "vM", produto_id: "p1", quantidade: 2 },
    { id: "vG", produto_id: "p1", quantidade: 40 },
  ];

  it("10 do tamanho M (so tem 2) com 40 no produto: acusa e o teto e 2", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vM", quantidade: 10 })],
      [prod("p1", 40)], STATUSES, variantes,
    );
    expect(r.insufficient.get(key("p1", "vM"))).toBe(2);
  });

  it("a outra variante do mesmo produto continua livre", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vG", quantidade: 10 })],
      [prod("p1", 40)], STATUSES, variantes,
    );
    expect(r.insufficient.size).toBe(0);
    expect(r.blocked.size).toBe(0);
  });

  it("variante zerada bloqueia mesmo com estoque no produto", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vZ", quantidade: 1 })],
      [prod("p1", 40)], STATUSES, [{ id: "vZ", produto_id: "p1", quantidade: 0 }],
    );
    expect(r.blocked.has(key("p1", "vZ"))).toBe(true);
  });

  it("variante que sumiu (desativada) bloqueia — nao vira estoque do produto", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "apagada", quantidade: 1 })],
      [prod("p1", 40)], STATUSES, variantes,
    );
    expect(r.blocked.has(key("p1", "apagada"))).toBe(true);
  });

  it("o estoque do PRODUTO ainda limita, mesmo com variante folgada", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vG", quantidade: 30 })],
      [prod("p1", 5)], STATUSES, variantes,
    );
    expect(r.insufficient.get(key("p1", "vG"))).toBe(5);
  });

  it("pre-venda ignora o teto da variante tambem", () => {
    const r = checkCartStock(
      [item({ produto_id: "p1", variante_id: "vM", quantidade: 99 })],
      [prod("p1", 0, 0, "pre_venda")], STATUSES, variantes,
    );
    expect(r.blocked.size).toBe(0);
    expect(r.insufficient.size).toBe(0);
  });
});

// Linha SEM variante num produto que TEM variante hoje.
//
// O carrinho vive no localStorage indefinidamente: o cliente pode ter colocado o
// produto ANTES de ele ganhar opcao. Sem este bloqueio a linha viajava ate o
// pedido como produto-pai, com o preco do pai, em silencio — e as guardas de
// tela (catalogo, re-order, saved-for-later) so fecham as portas de ENTRADA.
describe("linha sem variante em produto que ganhou variante", () => {
  const produtos = [{ id: "p1", estoque_total: 100, estoque_reservado: 0, status_produto: "available" }];
  const statuses = [{ nome: "available", permite_comprar: true }];

  it("BLOQUEIA quando o produto tem variante ativa e a linha nao tem", () => {
    const itens = [{ produto_id: "p1", variante_id: null, quantidade: 1 }];
    const variantes = [{ id: "v1", produto_id: "p1", quantidade: 5 }];
    const { blocked } = checkCartStock(itens as any, produtos as any, statuses as any, variantes as any);
    expect(blocked.has("p1::")).toBe(true);
  });

  it("PERMITE quando o produto nao tem variante nenhuma", () => {
    const itens = [{ produto_id: "p1", variante_id: null, quantidade: 1 }];
    const { blocked } = checkCartStock(itens as any, produtos as any, statuses as any, []);
    expect(blocked.has("p1::")).toBe(false);
  });

  it("PERMITE a linha que TEM a variante certa", () => {
    const itens = [{ produto_id: "p1", variante_id: "v1", quantidade: 1 }];
    const variantes = [{ id: "v1", produto_id: "p1", quantidade: 5 }];
    const { blocked } = checkCartStock(itens as any, produtos as any, statuses as any, variantes as any);
    expect(blocked.has("p1::v1")).toBe(false);
  });
});
