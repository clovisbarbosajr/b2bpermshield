/**
 * TESTE DE ESTRESSE de `getProductPrice` sob concorrencia.
 *
 * Por que ESTA funcao: as mudancas de 29/ago fizeram mais dois pontos do carrinho
 * passarem por ela — o "Add to order" do `PedidoDetalhe` e o "move to cart" do
 * `Carrinho`. Ela agora e o caminho de preco de CINCO telas, e nao e uma leitura
 * so: sao tres consultas em paralelo e, dependendo do resultado, uma QUARTA
 * depois. Entre a terceira e a quarta o mundo pode mudar — e o que a regra do dono
 * chama de "estado em memoria que envelhece durante a ida ao servidor".
 *
 * O cenario simulado e o real: ~50 clientes pedindo preco do mesmo produto ao
 * mesmo tempo enquanto a Jess, no admin, troca a tabela de preco de um deles,
 * apaga o item da tabela, e muda o preco base do produto. Cada consulta tem
 * latencia aleatoria, entao as quatro chegam fora de ordem de proposito.
 *
 * O que o teste EXIGE (e o que uma leitura do codigo nunca provaria):
 *  - o preco devolvido SEMPRE existiu em algum lugar naquele instante — nunca um
 *    numero costurado de duas leituras diferentes;
 *  - `source` casa com a origem do numero;
 *  - nunca NaN, nunca negativo;
 *  - nunca 0 enquanto havia preco de verdade — 0 e o que o cliente ve como
 *    "gratis", e o checkout nao recusa preco baixo demais;
 *  - chamadas simultaneas nao se contaminam (o resultado de um cliente nunca
 *    aparece no de outro).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- banco falso, mutavel, com latencia -----------------------------------
type Loja = {
  clientes: Record<string, { id: string; tabela_preco_id: string | null; parent_customer_id: string | null }>;
  produtos: Record<string, { id: string; preco: number }>;
  produto_precos_cliente: { produto_id: string; cliente_id: string; preco: number }[];
  tabela_preco_itens: { tabela_preco_id: string; produto_id: string; preco: number }[];
};

let loja: Loja;
// Tabelas que devem devolver `error` em vez de dado. O falso anterior NUNCA
// devolvia erro, entao os cinco `throw new Error("Erro ao buscar ...")` de
// `pricing.ts` podiam ser todos apagados com a suite verde — e sao justamente
// eles o contrato de que o `catch` do `Carrinho.moveToCart` e o do
// `PedidoDetalhe.handleAddToOrder` dependem para cair no preco base avisando.
let tabelasComErro = new Set<string>();
// Sequencia deterministica: o teste tem que reprovar SEMPRE, nao as vezes.
let semente = 1;
const rnd = () => {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
};
const latencia = () => new Promise((r) => setTimeout(r, Math.floor(rnd() * 4)));

const consulta = (tabela: string) => {
  const filtros: Record<string, unknown> = {};
  const api: any = {
    select: () => api,
    eq: (col: string, val: unknown) => { filtros[col] = val; return api; },
    async maybeSingle() {
      // A latencia fica AQUI: e o momento em que o dado sai do banco. Tudo que a
      // Jess fizer depois deste await ja nao esta neste resultado.
      await latencia();
      // A chave pode ser a tabela inteira (`"produtos"`) ou uma LINHA
      // (`"clientes:cli-0"`). A segunda existe porque `getProductPrice` le
      // `clientes` DUAS vezes para sub-login (o proprio, depois a empresa), e sem
      // derrubar so a segunda o `throw` de `accountRes.error` era inalcancavel —
      // apagar aquela linha passava com a suite verde.
      if (tabelasComErro.has(tabela) || tabelasComErro.has(`${tabela}:${filtros.id}`)) {
        return { data: null, error: { message: `falha simulada em ${tabela}` } };
      }
      if (tabela === "clientes") return { data: loja.clientes[filtros.id as string] ?? null, error: null };
      if (tabela === "produtos") return { data: loja.produtos[filtros.id as string] ?? null, error: null };
      if (tabela === "produto_precos_cliente") {
        const r = loja.produto_precos_cliente.find(
          (x) => x.produto_id === filtros.produto_id && x.cliente_id === filtros.cliente_id);
        return { data: r ?? null, error: null };
      }
      if (tabela === "tabela_preco_itens") {
        const r = loja.tabela_preco_itens.find(
          (x) => x.tabela_preco_id === filtros.tabela_preco_id && x.produto_id === filtros.produto_id);
        return { data: r ?? null, error: null };
      }
      throw new Error(`tabela nao simulada: ${tabela}`);
    },
  };
  return api;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => consulta(t) },
}));

const { getProductPrice } = await import("./pricing");

const PRODUTO = "prod-1";
const CLIENTES = Array.from({ length: 50 }, (_, i) => `cli-${i}`);

beforeEach(() => {
  semente = 1;
  tabelasComErro = new Set();
  loja = {
    clientes: Object.fromEntries(CLIENTES.map((id, i) => [
      id, { id, tabela_preco_id: i % 2 === 0 ? "tab-A" : null, parent_customer_id: null },
    ])),
    produtos: { [PRODUTO]: { id: PRODUTO, preco: 100 } },
    produto_precos_cliente: CLIENTES.filter((_, i) => i % 5 === 0)
      .map((id) => ({ produto_id: PRODUTO, cliente_id: id, preco: 70 })),
    tabela_preco_itens: [{ tabela_preco_id: "tab-A", produto_id: PRODUTO, preco: 85 }],
  };
});

// Todo preco que pode legitimamente aparecer durante a corrida.
const PRECOS_QUE_EXISTEM = new Set([70, 85, 100, 120, 60]);

describe("getProductPrice sob 50 clientes simultaneos", () => {
  it("nenhum preco costurado, nenhum zero, nenhum NaN — com a Jess mexendo no meio", async () => {
    const escritas = (async () => {
      await latencia();
      // Jess tira o item da tabela de preco.
      loja.tabela_preco_itens = [];
      await latencia();
      // ...e devolve com outro valor.
      loja.tabela_preco_itens = [{ tabela_preco_id: "tab-A", produto_id: PRODUTO, preco: 120 }];
      await latencia();
      // ...troca metade dos clientes de tabela, para uma que nao tem o produto.
      CLIENTES.forEach((id, i) => { if (i % 3 === 0) loja.clientes[id].tabela_preco_id = "tab-VAZIA"; });
      await latencia();
      // ...e muda o preco base.
      loja.produtos[PRODUTO].preco = 60;
      await latencia();
      // ...e apaga um preco combinado.
      loja.produto_precos_cliente = loja.produto_precos_cliente.filter((x) => x.cliente_id !== CLIENTES[0]);
    })();

    const leituras = CLIENTES.map((id) =>
      getProductPrice({ productId: PRODUTO, customerId: id, quantity: 1 }).then((r) => ({ id, ...r })));

    const [, resultados] = await Promise.all([escritas, Promise.all(leituras)]);

    for (const r of resultados) {
      expect(Number.isFinite(r.price), `${r.id} recebeu ${r.price}`).toBe(true);
      expect(r.price, `${r.id} recebeu preco <= 0`).toBeGreaterThan(0);
      expect(PRECOS_QUE_EXISTEM.has(r.price), `${r.id} recebeu ${r.price}, que nunca existiu`).toBe(true);
      // `source` tem que descrever de onde o numero saiu.
      if (r.source === "customer") expect(r.price).toBe(70);
      if (r.source === "price_list") expect([85, 120]).toContain(r.price);
      if (r.source === "base") expect([100, 60]).toContain(r.price);
    }
    expect(resultados).toHaveLength(50);
    // Um resultado por cliente, sem contaminacao cruzada.
    expect(new Set(resultados.map((r) => r.id)).size).toBe(50);

    // CONTAMINACAO CRUZADA. Cliente SEM preco combinado nunca pode receber 70 —
    // 70 so existe em `produto_precos_cliente` e so para 1 em cada 5. Se um cache
    // ou variavel de modulo vazasse entre chamadas simultaneas, e aqui que
    // apareceria: o cliente errado pagando o preco negociado de outro.
    const temCombinado = new Set(CLIENTES.filter((_, i) => i % 5 === 0));
    for (const r of resultados) {
      if (!temCombinado.has(r.id)) {
        expect(r.source, `${r.id} nao tem preco combinado`).not.toBe("customer");
        expect(r.price, `${r.id} recebeu o preco combinado de outro cliente`).not.toBe(70);
      }
    }
  });

  it("sem ninguem escrevendo, 50 simultaneos dao o MESMO resultado que 50 em fila — E o resultado certo", async () => {
    const simultaneos = await Promise.all(
      CLIENTES.map((id) => getProductPrice({ productId: PRODUTO, customerId: id, quantity: 1 })));
    semente = 1;
    const emFila: any[] = [];
    for (const id of CLIENTES) emFila.push(await getProductPrice({ productId: PRODUTO, customerId: id, quantity: 1 }));
    expect(simultaneos).toEqual(emFila);

    // "Igual em fila e simultaneo" sozinho nao vale nada: codigo consistentemente
    // ERRADO passa. A cascata tem que ter acontecido de verdade, para cada perfil.
    // (Descobri plantando o mutante que ignora `produto_precos_cliente`: os dois
    // lados mudavam juntos e o teste continuava verde.)
    const por = Object.fromEntries(CLIENTES.map((id, i) => [id, simultaneos[i]]));
    expect(por["cli-0"]).toEqual({ price: 70, source: "customer" });    // preco combinado vence
    expect(por["cli-2"]).toEqual({ price: 85, source: "price_list" });  // tem tab-A, sem combinado
    expect(por["cli-1"]).toEqual({ price: 100, source: "base" });       // sem tabela, sem combinado
    // e os tres perfis aparecem, para nenhum ramo da cascata ficar sem exercicio
    const fontes = new Set(simultaneos.map((r) => r.source));
    expect(fontes).toEqual(new Set(["customer", "price_list", "base"]));
  });

  // O CONTRATO DE ERRO. `getProductPrice` LANCA quando qualquer leitura falha —
  // nunca devolve preco base fingindo que deu certo. As telas contam com isso:
  // `Carrinho.tsx` avisa "Showing the list price" no `catch`, e
  // `PedidoDetalhe.tsx` cai no preco base registrando no console. Se estes
  // `throw` sumirem, as duas telas passam a mostrar preco de balcao em silencio.
  it.each(["clientes", "produtos", "produto_precos_cliente", "tabela_preco_itens"])(
    "falha em %s LANCA, e nao devolve preco de balcao calado",
    async (tabela) => {
      loja.produto_precos_cliente = [];   // forca a leitura de `tabela_preco_itens`
      tabelasComErro = new Set([tabela]);
      await expect(
        getProductPrice({ productId: PRODUTO, customerId: "cli-0", quantity: 1 }),
      ).rejects.toThrow();
    },
  );

  it("com 50 simultaneos e o banco falhando, TODOS lancam — nenhum vaza preco base", async () => {
    tabelasComErro = new Set(["produtos"]);
    const rs = await Promise.allSettled(CLIENTES.map((id) =>
      getProductPrice({ productId: PRODUTO, customerId: id, quantity: 1 })));
    expect(rs.every((r) => r.status === "rejected")).toBe(true);
  });

  it("falha ao ler a EMPRESA do sub-login lanca — nao cai na tabela do sub", async () => {
    loja.clientes["sub-3"] = { id: "sub-3", tabela_preco_id: null, parent_customer_id: "cli-0" };
    loja.produto_precos_cliente = [];
    tabelasComErro = new Set(["clientes:cli-0"]);   // so a SEGUNDA leitura falha
    await expect(
      getProductPrice({ productId: PRODUTO, customerId: "sub-3", quantity: 1 }),
    ).rejects.toThrow();
  });

  it("sub-login com tabela PROPRIA usa a dele, nao a do pai", async () => {
    // Precedencia: `cliente.tabela_preco_id ?? conta.tabela_preco_id`. Sem este
    // caso, inverter a ordem dos dois passava despercebido — o sub-login pagaria
    // pela tabela da empresa mesmo tendo uma negociada so para ele.
    loja.clientes["sub-2"] = { id: "sub-2", tabela_preco_id: "tab-B", parent_customer_id: "cli-0" };
    loja.clientes["cli-0"].tabela_preco_id = "tab-A";
    loja.produto_precos_cliente = [];
    loja.tabela_preco_itens = [
      { tabela_preco_id: "tab-A", produto_id: PRODUTO, preco: 85 },
      { tabela_preco_id: "tab-B", produto_id: PRODUTO, preco: 42 },
    ];
    const rs = await Promise.all(Array.from({ length: 50 }, () =>
      getProductPrice({ productId: PRODUTO, customerId: "sub-2", quantity: 1 })));
    expect(new Set(rs.map((r) => `${r.source}:${r.price}`)).size).toBe(1);
    expect(rs[0]).toEqual({ price: 42, source: "price_list" });
  });

  it("sub-login usa a tabela da EMPRESA quando ele nao tem a propria, sob concorrencia", async () => {
    loja.clientes["sub-1"] = { id: "sub-1", tabela_preco_id: null, parent_customer_id: "cli-0" };
    loja.clientes["cli-0"].tabela_preco_id = "tab-A";
    loja.produto_precos_cliente = [];
    const rs = await Promise.all(Array.from({ length: 50 }, () =>
      getProductPrice({ productId: PRODUTO, customerId: "sub-1", quantity: 1 })));
    // Todos iguais: nenhuma corrida entre as duas leituras de `clientes`.
    expect(new Set(rs.map((r) => `${r.source}:${r.price}`)).size).toBe(1);
    expect(rs[0]).toEqual({ price: 85, source: "price_list" });
  });
});
