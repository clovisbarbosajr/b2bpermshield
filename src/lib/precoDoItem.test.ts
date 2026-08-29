/**
 * Os quatro caminhos de `precoDoItem`, EXECUTADOS.
 *
 * Enquanto esta decisao morava dentro de `Carrinho.moveToCart` e de
 * `PedidoDetalhe.handleAddToOrder`, so dava para conferi-la com expressao regular
 * sobre a fonte — e um cacador mostrou que isso nao vale: quatro mutantes no
 * bloco do Carrinho (apagar `preco:` do `addItem` e deixar o do localStorage, que
 * "pode ter meses"; sobrescrever o resultado da cascata; embrulhar a atribuicao
 * num `if` falso) passaram com a suite de 492 VERDE. Aqui cada caminho roda.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProductPrice = vi.fn();
vi.mock("./pricing", () => ({ getProductPrice: (...a: unknown[]) => getProductPrice(...a) }));

const { precoDoItem, clienteDoPortal, AVISO_PRECO_INCERTO } = await import("./precoDoItem");

beforeEach(() => {
  getProductPrice.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const PEDIDO = { produtoId: "prod-1", quantidade: 3, precoBase: 100 };

describe("clienteDoPortal — os tres estados", () => {
  const LOGADO = { userId: "user-1" };

  it("montagem, antes de qualquer leitura: `nao sei`", () => {
    // O estado INICIAL da tela. Era um literal solto no `useState` e podia virar
    // `null` sem nenhum teste reclamar — quem clicasse antes da consulta voltar
    // levava o produto pelo preco de balcao SEM aviso.
    expect(clienteDoPortal(LOGADO)).toBeUndefined();
    expect(clienteDoPortal({ ...LOGADO, leitura: null })).toBeUndefined();
  });

  it("erro na leitura vira `nao sei`, e nao `nao tem`", () => {
    // ESTE e o defeito original: com `null`, `precoDoItem` devolve
    // `incerto: false` e o preco de balcao entra calado — e nada redispara o
    // efeito, entao e para sempre.
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: null, error: { message: "RLS" } } }))
      .toBeUndefined();
    // O erro vence mesmo com dado junto: leitura parcial nao e leitura.
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: { id: "cli-1" }, error: new Error("boom") } }))
      .toBeUndefined();
  });

  it("leitura OK sem ficha vira `null` — preco base e o certo, sem ruido", () => {
    // Staff no portal fora do "view as". Avisar aqui seria alarme falso.
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: null, error: null } })).toBeNull();
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: {}, error: null } })).toBeNull();
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: { id: null }, error: null } })).toBeNull();
  });

  it("leitura OK com ficha devolve o id", () => {
    expect(clienteDoPortal({ ...LOGADO, leitura: { data: { id: "cli-7" }, error: null } }))
      .toBe("cli-7");
  });

  it("view as: e o cliente impersonado, e nao espera leitura nenhuma", () => {
    expect(clienteDoPortal({ impersonatedId: "cli-9", userId: "user-1" })).toBe("cli-9");
    // Vence ate a leitura que voltou com outro id — a tela e do impersonado.
    expect(clienteDoPortal({
      impersonatedId: "cli-9", userId: "user-1",
      leitura: { data: { id: "cli-1" }, error: null },
    })).toBe("cli-9");
  });

  it("deslogado vira `null`, e nao `nao sei`", () => {
    // Senao um logout deixaria o aviso de preco ligado para sempre.
    expect(clienteDoPortal({})).toBeNull();
    expect(clienteDoPortal({ userId: null })).toBeNull();
  });
});

describe("precoDoItem", () => {
  it("cliente conhecido: usa a cascata, e o preco e certeza", async () => {
    getProductPrice.mockResolvedValue({ price: 70, source: "customer" });
    await expect(precoDoItem({ ...PEDIDO, clienteId: "cli-1" }))
      .resolves.toEqual({ preco: 70, incerto: false });
    // Os argumentos importam: `pricing.ts` decide a tabela pelo id que recebe.
    expect(getProductPrice).toHaveBeenCalledWith({
      productId: "prod-1", customerId: "cli-1", quantity: 3,
    });
  });

  it("cliente conhecido: o preco base NAO sobrevive a cascata", async () => {
    // O mutante "chama e joga o resultado fora" morre aqui.
    getProductPrice.mockResolvedValue({ price: 42, source: "price_list" });
    const r = await precoDoItem({ ...PEDIDO, clienteId: "cli-1" });
    expect(r.preco).toBe(42);
    expect(r.preco).not.toBe(PEDIDO.precoBase);
  });

  it("preco zero da cascata e preservado — produto de cotacao existe", async () => {
    // `Checkout.tsx` aceita item a $0 de proposito ("contact us"). Trocar o `0`
    // pelo preco base por engano viraria cobranca de um valor que ninguem pediu.
    getProductPrice.mockResolvedValue({ price: 0, source: "base" });
    await expect(precoDoItem({ ...PEDIDO, clienteId: "cli-1" }))
      .resolves.toEqual({ preco: 0, incerto: false });
  });

  it("sem ficha de cliente (`null`): preco base, e SEM aviso", async () => {
    // Staff no portal fora do "view as". O preco base E o preco certo.
    await expect(precoDoItem({ ...PEDIDO, clienteId: null }))
      .resolves.toEqual({ preco: 100, incerto: false });
    expect(getProductPrice).not.toHaveBeenCalled();
  });

  it("cliente desconhecido (`undefined`): preco base, COM aviso", async () => {
    // Leitura falhou ou ainda esta no ar. Achatar isto em `null` foi o defeito
    // original: quem tinha preco negociado levava o produto pelo preco de balcao,
    // calado.
    await expect(precoDoItem({ ...PEDIDO, clienteId: undefined }))
      .resolves.toEqual({ preco: 100, incerto: true });
    expect(getProductPrice).not.toHaveBeenCalled();
  });

  it("cascata falhando: preco base, COM aviso, e nunca lanca", async () => {
    // Falha nao pode impedir o item de entrar no carrinho — o valor cobrado e o
    // do servidor de qualquer jeito.
    getProductPrice.mockRejectedValue(new Error("Erro ao buscar produto: boom"));
    await expect(precoDoItem({ ...PEDIDO, clienteId: "cli-1" }))
      .resolves.toEqual({ preco: 100, incerto: true });
  });

  it("string vazia nao vira consulta", async () => {
    await expect(precoDoItem({ ...PEDIDO, clienteId: "" }))
      .resolves.toEqual({ preco: 100, incerto: true });
    expect(getProductPrice).not.toHaveBeenCalled();
  });

  it("`quantidade` chega na cascata; o padrao e 1", async () => {
    getProductPrice.mockResolvedValue({ price: 9, source: "base" });
    await precoDoItem({ produtoId: "p", clienteId: "c", precoBase: 1 });
    expect(getProductPrice).toHaveBeenCalledWith({ productId: "p", customerId: "c", quantity: 1 });
  });

  it("o aviso e um so, para as duas telas nao divergirem", () => {
    expect(AVISO_PRECO_INCERTO).toMatch(/list price/i);
  });

  it("50 itens simultaneos nao se contaminam", async () => {
    // O move-to-cart e o add-to-order sao clicaveis em sequencia rapida, e cada um
    // dispara sua propria cascata. Nenhum estado e compartilhado entre chamadas —
    // este teste falha no dia em que alguem puser um cache de modulo aqui.
    getProductPrice.mockImplementation(async ({ customerId }: any) => ({
      price: Number(String(customerId).replace("cli-", "")), source: "customer",
    }));
    const rs = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        precoDoItem({ produtoId: "p", clienteId: `cli-${i + 1}`, precoBase: 999 })),
    );
    expect(rs.map((r) => r.preco)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(rs.every((r) => !r.incerto)).toBe(true);
  });
});
