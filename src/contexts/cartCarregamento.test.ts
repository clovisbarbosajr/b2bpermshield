/**
 * Carrinho: leitura do localStorage e gravação por chave.
 *
 * Os dois defeitos que estes testes prendem:
 *  1. o carrinho salvo entrava CRU no estado — array quebrado derrubava o app
 *     inteiro (o Provider envolve tudo) e quantidade NaN/negativa chegava ao
 *     checkout;
 *  2. ao trocar a chave efetiva (View as de A → B, logout), a gravação de um
 *     commit saía com os itens da chave ANTIGA sob a chave NOVA. O render
 *     seguinte corrigia, então só dá pra ver olhando TODAS as gravações — que é
 *     o que a aba que fecha no meio deixa no disco.
 *
 * Sem @testing-library/react aqui: `@testing-library/dom` não está instalado
 * neste projeto e não vou adicionar dependência por causa de um teste —
 * `createRoot` + `act` fazem o mesmo.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: { impersonatedCustomer: null as { id: string } | null },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "admin-1" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { CartProvider, sanitizeCart, useCart, type CartItem } from "./CartContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (over: Partial<CartItem> = {}): CartItem => ({
  produto_id: "p1", nome: "Board", sku: "SKU1", preco: 10, quantidade: 2,
  unidade_venda: "un", quantidade_minima: 1, estoque_disponivel: 100, ...over,
});

const escritas: Array<[string, string]> = [];
const setItemOriginal = Storage.prototype.setItem;

let ultimo: ReturnType<typeof useCart> | null = null;
const Probe = () => { ultimo = useCart(); return null; };
const arvore = () => createElement(CartProvider, { children: createElement(Probe) });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const montar = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  await act(async () => { r.render(arvore()); });
};
const rerenderizar = async () => { await act(async () => { root!.render(arvore()); }); };

beforeEach(() => {
  localStorage.clear();
  escritas.length = 0;
  ultimo = null;
  h.auth.impersonatedCustomer = null;
  Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
    escritas.push([k, v]);
    return setItemOriginal.call(this, k, v);
  };
});

afterEach(async () => {
  Storage.prototype.setItem = setItemOriginal;
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("sanitizeCart", () => {
  it("descarta o que não é lista de itens comprável", () => {
    expect(sanitizeCart({})).toEqual([]);
    expect(sanitizeCart(null)).toEqual([]);
    expect(sanitizeCart("[]")).toEqual([]);
    expect(sanitizeCart([null, 7, {}, { nome: "sem id" }])).toEqual([]);
  });

  it("nunca deixa passar quantidade/preço que envenenam o total", () => {
    expect(sanitizeCart([item({ quantidade: -5 })])[0].quantidade).toBe(1);

    const [nan] = sanitizeCart([{ ...item(), quantidade: NaN, preco: "12" }]);
    expect(nan.quantidade).toBe(1);
    expect(nan.preco).toBe(0);

    expect(sanitizeCart([item({ quantidade: 1, quantidade_minima: 10 })])[0].quantidade).toBe(10);

    // carrinho velho não pode fazer o total virar NaN
    const total = sanitizeCart([{ produto_id: "p9" }, item()])
      .reduce((s, i) => s + i.preco * i.quantidade, 0);
    expect(Number.isFinite(total)).toBe(true);
  });
});

describe("CartProvider", () => {
  it("carrinho salvo corrompido não derruba o app", async () => {
    localStorage.setItem("b2b_cart_admin-1", '{"nao":"e uma lista"}');
    await montar();
    expect(ultimo!.items).toEqual([]);
    expect(ultimo!.total).toBe(0);
  });

  it("addItem SOMA o pedido, sem elevar o delta ao mínimo do produto", async () => {
    // Linha já no carrinho com o mínimo (10). "Move to cart" / página do produto
    // mandam mais 1: tem que virar 11. Sanear a ENTRADA com o piso do mínimo
    // faria virar 20 — o mínimo somado a cada clique.
    localStorage.setItem("b2b_cart_admin-1", JSON.stringify([
      item({ quantidade: 10, quantidade_minima: 10 }),
    ]));
    await montar();
    await act(async () => { ultimo!.addItem(item({ quantidade: 1, quantidade_minima: 10 })); });
    expect(ultimo!.items[0].quantidade).toBe(11);
  });

  it("quantidade inválida não destrói a linha nem o total", async () => {
    localStorage.setItem("b2b_cart_admin-1", JSON.stringify([item({ quantidade: 4 })]));
    await montar();
    // campo de quantidade limpo => `parseInt("") || quantidade_minima` chega undefined
    await act(async () => {
      ultimo!.updateQuantity("p1::", undefined as unknown as number);
    });
    expect(ultimo!.items[0].quantidade).toBe(4);
    expect(ultimo!.total).toBe(40);

    await act(async () => { ultimo!.addItem(item({ quantidade: NaN })); });
    expect(Number.isFinite(ultimo!.total)).toBe(true);
  });

  it("trocar de cliente no View as nunca grava o carrinho de um na chave do outro", async () => {
    localStorage.setItem("b2b_cart_viewas_A", JSON.stringify([item({ produto_id: "p-A" })]));
    localStorage.setItem("b2b_cart_viewas_B", JSON.stringify([item({ produto_id: "p-B" })]));

    h.auth.impersonatedCustomer = { id: "A" };
    await montar();
    expect(ultimo!.items.map((i) => i.produto_id)).toEqual(["p-A"]);

    h.auth.impersonatedCustomer = { id: "B" };
    await rerenderizar();
    expect(ultimo!.items.map((i) => i.produto_id)).toEqual(["p-B"]);

    expect(escritas.filter(([k, v]) => k === "b2b_cart_viewas_B" && v.includes("p-A"))).toEqual([]);
    expect(escritas.filter(([k, v]) => k === "b2b_cart_viewas_A" && v.includes("p-B"))).toEqual([]);
    expect(JSON.parse(localStorage.getItem("b2b_cart_viewas_A")!)[0].produto_id).toBe("p-A");
    expect(JSON.parse(localStorage.getItem("b2b_cart_viewas_B")!)[0].produto_id).toBe("p-B");
  });
});

/**
 * ESTRESSE — 50 clientes, mexidas embaralhadas.
 *
 * Ler o código não acha isto: o estrago do carrinho aparece no INTERVALO entre
 * commits, quando a chave efetiva muda no meio de uma sequência de cliques. Aqui
 * o admin entra e sai de 50 clientes enquanto adiciona, muda quantidade, remove
 * e esvazia — e a invariante é conferida em TODAS as gravações, não só no fim:
 * a chave de um cliente nunca pode conter item de outro.
 *
 * Semente fixa: falha aqui é reproduzível.
 */
describe("estresse: 50 clientes no View as", () => {
  const semente = (s: number) => () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("nenhuma gravação mistura carrinho de clientes diferentes", async () => {
    const rnd = semente(20260827);
    const clientes = Array.from({ length: 50 }, (_, k) => `C${k}`);
    let atual = clientes[0];
    h.auth.impersonatedCustomer = { id: atual };
    await montar();

    for (let passo = 0; passo < 400; passo++) {
      const sorteio = rnd();
      await act(async () => {
        if (sorteio < 0.25) {
          // troca de cliente NO MEIO da sequência de cliques
          atual = clientes[Math.floor(rnd() * clientes.length)];
          h.auth.impersonatedCustomer = { id: atual };
          root!.render(arvore());
        } else if (sorteio < 0.6) {
          const n = Math.floor(rnd() * 5);
          ultimo!.addItem(item({
            produto_id: `p-${atual}-${n}`,
            quantidade: [1, 3, 0, NaN, -2][Math.floor(rnd() * 5)],
            quantidade_minima: Math.floor(rnd() * 4) + 1,
            estoque_disponivel: [0, 12, 999999][Math.floor(rnd() * 3)],
          }));
        } else if (sorteio < 0.8) {
          const alvo = ultimo!.items[Math.floor(rnd() * (ultimo!.items.length || 1))];
          if (alvo) ultimo!.updateQuantity(`${alvo.produto_id}::`, Math.floor(rnd() * 40) - 5);
        } else if (sorteio < 0.93) {
          const alvo = ultimo!.items[Math.floor(rnd() * (ultimo!.items.length || 1))];
          if (alvo) ultimo!.removeItem(`${alvo.produto_id}::`);
        } else {
          ultimo!.clearCart();
        }
      });

      expect(Number.isFinite(ultimo!.total)).toBe(true);
      expect(ultimo!.total).toBeGreaterThanOrEqual(0);
      for (const i of ultimo!.items) {
        expect(Number.isInteger(i.quantidade)).toBe(true);
        expect(i.quantidade).toBeGreaterThanOrEqual(1);
        expect(i.produto_id.startsWith(`p-${atual}-`)).toBe(true);
      }
    }

    // A invariante que só o histórico completo mostra.
    const vazadas = escritas.filter(([k, v]) => {
      const dono = k.replace("b2b_cart_viewas_", "");
      return (JSON.parse(v) as CartItem[]).some((i) => !i.produto_id.startsWith(`p-${dono}-`));
    });
    expect(vazadas).toEqual([]);
    expect(escritas.length).toBeGreaterThan(100);
  });
});
