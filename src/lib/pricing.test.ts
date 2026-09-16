/**
 * `resolverPreco` (a cascata, pura) e `getProductPrices` (o I/O em lote).
 *
 * A cascata tem que ser IDENTICA a `preco_autoritativo` no banco: preco do
 * cliente (`IS NOT NULL`, zero vale) > item da tabela > base (NULL -> 0). O lote
 * existe porque o catalogo fazia ~4 idas ao banco POR PRODUTO (~1.300 para 327)
 * e o preco so aparecia quando a ultima voltava.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- banco falso minimo, que CONTA as chamadas ------------------------------
type Chamada = { tabela: string; filtros: Record<string, unknown>; lista: boolean };
let chamadas: Chamada[] = [];
let tabelasComErro = new Set<string>();
let loja: {
  clientes: Record<string, { id: string; tabela_preco_id: string | null; parent_customer_id: string | null }>;
  produtos: Record<string, { id: string; preco: number }>;
  produto_precos_cliente: { produto_id: string; cliente_id: string; preco: number }[];
  tabela_preco_itens: { tabela_preco_id: string; produto_id: string; preco: number }[];
};

const consulta = (tabela: string) => {
  const filtros: Record<string, unknown> = {};
  const executa = (lista: boolean) => {
    chamadas.push({ tabela, filtros, lista });
    if (tabelasComErro.has(tabela)) return { data: null, error: { message: `falha em ${tabela}` } };
    const linhas: Record<string, unknown>[] =
      tabela === "clientes" ? Object.values(loja.clientes)
      : tabela === "produtos" ? Object.values(loja.produtos)
      : tabela === "produto_precos_cliente" ? loja.produto_precos_cliente
      : loja.tabela_preco_itens;
    const data = linhas.filter((l) => Object.entries(filtros).every(([c, v]) =>
      Array.isArray(v) ? v.includes(l[c]) : l[c] === v));
    return { data: lista ? data : data[0] ?? null, error: null };
  };
  const api: any = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros[c] = v; return api; },
    in: (c: string, v: unknown[]) => { filtros[c] = v; return api; },
    then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(executa(true)).then(res, rej),
    maybeSingle: async () => executa(false),
  };
  return api;
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => consulta(t) } }));

const { resolverPreco, getProductPrices, getProductPrice } = await import("./pricing");

beforeEach(() => {
  chamadas = [];
  tabelasComErro = new Set();
  loja = {
    clientes: {
      "cli-0": { id: "cli-0", tabela_preco_id: "tab-A", parent_customer_id: null },
      "sub-0": { id: "sub-0", tabela_preco_id: "tab-B", parent_customer_id: "cli-0" },
      "sub-1": { id: "sub-1", tabela_preco_id: null, parent_customer_id: "cli-0" },
    },
    produtos: { "p-1": { id: "p-1", preco: 100 }, "p-2": { id: "p-2", preco: 200 }, "p-3": { id: "p-3", preco: 300 } },
    produto_precos_cliente: [{ produto_id: "p-1", cliente_id: "cli-0", preco: 70 }],
    tabela_preco_itens: [
      { tabela_preco_id: "tab-A", produto_id: "p-1", preco: 85 },
      { tabela_preco_id: "tab-A", produto_id: "p-2", preco: 185 },
      { tabela_preco_id: "tab-B", produto_id: "p-2", preco: 42 },
    ],
  };
});

describe("resolverPreco — a cascata, igual ao banco", () => {
  it("preco do cliente vence lista e base", () => {
    expect(resolverPreco({ base: 100, precoCliente: 70, itemLista: 85 })).toEqual({ price: 70, source: "customer" });
  });
  it("lista vence base", () => {
    expect(resolverPreco({ base: 100, itemLista: 85 })).toEqual({ price: 85, source: "price_list" });
  });
  it("base quando nao ha nada", () => {
    expect(resolverPreco({ base: 100 })).toEqual({ price: 100, source: "base" });
  });
  it("base NULL vira 0 (`IF _base IS NULL THEN RETURN 0`)", () => {
    expect(resolverPreco({ base: null })).toEqual({ price: 0, source: "base" });
    expect(resolverPreco({ base: undefined })).toEqual({ price: 0, source: "base" });
  });
  it("preco do cliente 0 e preco VALIDO (banco usa `IS NOT NULL`, nao `> 0`)", () => {
    expect(resolverPreco({ base: 100, precoCliente: 0, itemLista: 85 })).toEqual({ price: 0, source: "customer" });
    expect(resolverPreco({ base: 100, itemLista: 0 })).toEqual({ price: 0, source: "price_list" });
  });
});

describe("getProductPrices — o lote", () => {
  it("250 ids viram 3 blocos de 100: 3 chamadas `in` por tabela, 1 em `clientes`", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `x-${i}`);
    for (const id of ids) loja.produtos[id] = { id, preco: 1 };
    const r = await getProductPrices({ productIds: ids, customerId: "cli-0" });
    expect(Object.keys(r)).toHaveLength(250);
    expect(r["x-249"]).toEqual({ price: 1, source: "base" });
    const por = (t: string) => chamadas.filter((c) => c.tabela === t);
    expect(por("clientes")).toHaveLength(1);
    for (const t of ["produtos", "produto_precos_cliente", "tabela_preco_itens"]) {
      expect(por(t), t).toHaveLength(3);
      expect(por(t).map((c) => (c.filtros[t === "produtos" ? "id" : "produto_id"] as unknown[]).length)).toEqual([100, 100, 50]);
    }
    expect(chamadas.every((c) => c.lista || c.tabela === "clientes")).toBe(true);
  });

  it("sem tabela de preco, `tabela_preco_itens` nem e lida", async () => {
    loja.clientes["cli-0"].tabela_preco_id = null;
    await getProductPrices({ productIds: ["p-1", "p-2"], customerId: "cli-0" });
    expect(chamadas.map((c) => c.tabela)).toEqual(["clientes", "produtos", "produto_precos_cliente"]);
  });

  it.each(["clientes", "produtos", "produto_precos_cliente", "tabela_preco_itens"])(
    "erro em %s LANCA — nunca lote parcial como se fosse certo", async (tabela) => {
      tabelasComErro = new Set([tabela]);
      await expect(getProductPrices({ productIds: ["p-1", "p-2"], customerId: "cli-0" })).rejects.toThrow();
    });

  it("erro na lista NAO derruba o bloco quando TODO id tem preco combinado (a lista nao e necessaria)", async () => {
    loja.produto_precos_cliente.push({ produto_id: "p-2", cliente_id: "cli-0", preco: 120 });
    tabelasComErro = new Set(["tabela_preco_itens"]);
    await expect(getProductPrices({ productIds: ["p-1", "p-2"], customerId: "cli-0" })).resolves.toEqual({
      "p-1": { price: 70, source: "customer" }, "p-2": { price: 120, source: "customer" },
    });
  });

  it("sub-login: preco combinado da CONTA do pai; tabela do sub vence a do pai", async () => {
    const r = await getProductPrices({ productIds: ["p-1", "p-2", "p-3"], customerId: "sub-0" });
    expect(r["p-1"]).toEqual({ price: 70, source: "customer" });     // combinado e de cli-0, nao de sub-0
    expect(r["p-2"]).toEqual({ price: 42, source: "price_list" });   // tab-B (sub) e nao tab-A (pai)
    expect(r["p-3"]).toEqual({ price: 300, source: "base" });
    const combinado = chamadas.find((c) => c.tabela === "produto_precos_cliente")!;
    expect(combinado.filtros.cliente_id).toBe("cli-0");
    expect(chamadas.filter((c) => c.tabela === "clientes").map((c) => c.filtros.id)).toEqual(["sub-0", "cli-0"]);
  });

  it("sub-login sem tabela propria herda a do pai", async () => {
    const r = await getProductPrices({ productIds: ["p-2"], customerId: "sub-1" });
    expect(r["p-2"]).toEqual({ price: 185, source: "price_list" });
  });

  it("produto que nao existe em `produtos`: base 0, como `getProductPrice` sempre fez", async () => {
    const r = await getProductPrices({ productIds: ["fantasma"], customerId: "cli-0" });
    expect(r["fantasma"]).toEqual({ price: 0, source: "base" });
  });

  it("getProductPrice (1 id) devolve o MESMO que o lote, para cada perfil", async () => {
    for (const customerId of ["cli-0", "sub-0", "sub-1"]) {
      const lote = await getProductPrices({ productIds: ["p-1", "p-2", "p-3"], customerId });
      for (const productId of ["p-1", "p-2", "p-3"]) {
        expect(await getProductPrice({ productId, customerId, quantity: 5 }), `${customerId}/${productId}`)
          .toEqual(lote[productId]);
      }
    }
  });
});
