import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
// @ts-expect-error — tsconfig.app.json nao inclui os tipos do Node; vitest roda em Node.
import { readFileSync } from "node:fs";
import {
  periodoAtual,
  periodoAnterior,
  limitesDoPeriodo,
  resumoVendas,
  variacao,
  topProdutos,
  topClientes,
  estoqueCritico,
} from "./dashboardMetrics";

// Igual ao `dashboardDatasFuso.test.ts`: a borda do periodo so erra FORA de UTC.
// Em UTC a versao certa e a errada dao o mesmo resultado, e o teste passaria
// verde com o bug dentro.
beforeAll(() => { vi.stubEnv("TZ", "America/Sao_Paulo"); });
afterAll(() => { vi.unstubAllEnvs(); });

const pedido = (total: number, status = "complete", cliente_id = "c1") => ({ total, status, cliente_id });

describe("resumoVendas — cancelado nao e receita", () => {
  it("nao soma o cancelado nem o conta como pedido", () => {
    const r = resumoVendas([pedido(100), pedido(999, "cancelled"), pedido(300)]);
    expect(r.receita).toBe(400);
    expect(r.pedidos).toBe(2);
    expect(r.ticketMedio).toBe(200);
  });

  it("status legado em PT (`cancelado`) tambem fica de fora", () => {
    // `canonicalStatus` mapeia o legado; ler `status` cru deixaria o pedido
    // antigo cancelado somando na receita.
    expect(resumoVendas([pedido(100), pedido(500, "cancelado")]).receita).toBe(100);
  });

  it("`total` como string (numeric do Postgres) soma como numero", () => {
    expect(resumoVendas([{ total: "10.50", status: "sent" }, { total: "1.50", status: "sent" }]).receita).toBe(12);
  });

  it("sem pedido nenhum o ticket medio e 0, nao NaN", () => {
    const r = resumoVendas([]);
    expect(r.ticketMedio).toBe(0);
    expect(Number.isNaN(r.ticketMedio)).toBe(false);
  });

  it("so pedidos cancelados tambem dao ticket 0 (divisao por zero)", () => {
    const r = resumoVendas([pedido(100, "cancelled"), pedido(200, "cancelled")]);
    expect(r).toEqual({ receita: 0, pedidos: 0, ticketMedio: 0 });
  });
});

describe("variacao", () => {
  it("base zero nao tem percentual: null", () => {
    expect(variacao(500, 0)).toBeNull();
  });

  it("calcula a variacao relativa", () => {
    expect(variacao(150, 100)).toBeCloseTo(0.5);
    expect(variacao(50, 100)).toBeCloseTo(-0.5);
  });

  it("atual zero com base positiva e -100%, nao null", () => {
    expect(variacao(0, 100)).toBe(-1);
  });
});

describe("periodoAtual — mes corrente do dia 1 ao ultimo dia", () => {
  // Termina HOJE, nao no fim do mes: senao a janela atual (dias corridos) seria
  // comparada com uma janela anterior cheia e o card acusaria queda todo dia 2.
  it("termina no dia de hoje, nao no ultimo dia do mes", () => {
    expect(periodoAtual(new Date(2026, 1, 15))).toEqual({ from: "2026-02-01", to: "2026-02-15" });
    expect(periodoAtual(new Date(2028, 1, 29))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  // Digitar o ano num `input type="date"` emite datas completas a cada tecla
  // ("0009-09-22"). Sem faixa de ano, `toISOString().slice(0,10)` devolvia
  // "-002023-04" e esse literal ia parar no filtro mandado ao servidor.
  it.each(["0002-09-01", "0020-09-01", "92220-09-22", "26-09-01", "abcd-09-01"])(
    "ano fora da faixa (%s) nao vira periodo", (ruim) => {
      expect(periodoAnterior(ruim, "2026-09-22")).toEqual({ from: "", to: "" });
      expect(periodoAnterior("2026-09-01", ruim)).toEqual({ from: "", to: "" });
    });

  it("dia 1: periodo de um dia so, e a janela anterior tambem tem 1 dia", () => {
    const p = periodoAtual(new Date(2026, 8, 1));
    expect(p).toEqual({ from: "2026-09-01", to: "2026-09-01" });
    expect(periodoAnterior(p.from, p.to)).toEqual({ from: "2026-08-31", to: "2026-08-31" });
  });

  it("janela atual e anterior tem o MESMO numero de dias em qualquer dia do mes", () => {
    const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
    for (const d of [1, 2, 13, 22, 28, 31]) {
      const p = periodoAtual(new Date(2026, 2, Math.min(d, 31)));
      const ant = periodoAnterior(p.from, p.to);
      expect(dias(ant.from, ant.to), `dia ${d}`).toBe(dias(p.from, p.to));
    }
  });
});

describe("periodoAnterior — mesmo numero de DIAS, colado antes de `from`", () => {
  it("marco (31 dias) volta 31 dias, atravessando fevereiro de 28", () => {
    // Nao e "mes anterior": fevereiro tem 28 dias e a comparacao inventaria
    // ~10% de alta todo mes de marco.
    expect(periodoAnterior("2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-29", to: "2026-02-28" });
  });

  it("ano bissexto usa o 29/fev real", () => {
    expect(periodoAnterior("2028-03-01", "2028-03-31")).toEqual({ from: "2028-01-30", to: "2028-02-29" });
  });

  it("a janela anterior tem exatamente o mesmo tamanho da atual", () => {
    const dias = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;
    for (const [from, to] of [["2026-02-01", "2026-02-28"], ["2026-09-01", "2026-09-30"], ["2026-09-10", "2026-09-12"]]) {
      const ant = periodoAnterior(from, to);
      expect(dias(ant.from, ant.to)).toBe(dias(from, to));
      // e termina no dia imediatamente anterior a `from`
      expect(Date.parse(`${from}T00:00:00Z`) - Date.parse(`${ant.to}T00:00:00Z`)).toBe(86_400_000);
    }
  });

  it("um dia so volta um dia so", () => {
    expect(periodoAnterior("2026-01-01", "2026-01-01")).toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });
});

describe("limitesDoPeriodo — borda do dia no fuso do navegador", () => {
  const dentro = (iso: string, from: string, to: string) => {
    const { ini, fim } = limitesDoPeriodo(from, to);
    const t = Date.parse(iso);
    return t >= Date.parse(ini) && t <= Date.parse(fim);
  };

  it("23:59:59.999 do ultimo dia (hora LOCAL) ainda conta", () => {
    const ultimoInstante = new Date(2026, 8, 30, 23, 59, 59, 999).toISOString();
    expect(dentro(ultimoInstante, "2026-09-01", "2026-09-30")).toBe(true);
  });

  it("00:00:00 do dia seguinte (hora LOCAL) ja esta fora", () => {
    const diaSeguinte = new Date(2026, 9, 1, 0, 0, 0, 0).toISOString();
    expect(dentro(diaSeguinte, "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("00:00:00 do primeiro dia conta; 23:59:59.999 da vespera nao", () => {
    expect(dentro(new Date(2026, 8, 1, 0, 0, 0, 0).toISOString(), "2026-09-01", "2026-09-30")).toBe(true);
    expect(dentro(new Date(2026, 7, 31, 23, 59, 59, 999).toISOString(), "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("as bordas sao meia-noite LOCAL, nao UTC", () => {
    // Em America/Sao_Paulo (UTC-3) meia-noite local e 03:00Z. Parsear com "Z"
    // deslocaria a janela inteira 3 horas e jogaria os pedidos da noite no dia
    // errado.
    const { ini } = limitesDoPeriodo("2026-09-01", "2026-09-30");
    expect(ini).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).toISOString());
  });
});

describe("topProdutos", () => {
  const item = (produto_id: string, subtotal: number, quantidade: number, status = "sent") => ({
    produto_id, nome_produto: `P-${produto_id}`, quantidade, subtotal, pedidos: { status },
  });

  it("item de pedido cancelado nao entra no ranking", () => {
    const r = topProdutos([item("a", 100, 1), item("b", 999, 5, "cancelled")]);
    expect(r.map((x) => x.produto_id)).toEqual(["a"]);
  });

  it("cancelado nao aumenta a receita de um produto que tambem vendeu", () => {
    const r = topProdutos([item("a", 100, 1), item("a", 900, 9, "cancelled"), item("a", 50, 2)]);
    expect(r[0]).toMatchObject({ produto_id: "a", receita: 150, quantidade: 3 });
  });

  it("ordena por receita e corta no limite", () => {
    const itens = [item("a", 10, 1), item("b", 300, 1), item("c", 200, 1)];
    expect(topProdutos(itens, 2).map((x) => x.produto_id)).toEqual(["b", "c"]);
  });

  it("aceita o embed vindo como array", () => {
    const r = topProdutos([{ produto_id: "a", nome_produto: "A", quantidade: 1, subtotal: 100, pedidos: [{ status: "cancelled" }] }]);
    expect(r).toEqual([]);
  });
});

describe("topClientes", () => {
  it("pedido cancelado nao conta na receita nem no numero de pedidos do cliente", () => {
    const r = topClientes([pedido(100, "complete", "c1"), pedido(900, "cancelled", "c1"), pedido(300, "sent", "c2")]);
    expect(r).toEqual([
      { cliente_id: "c2", receita: 300, pedidos: 1 },
      { cliente_id: "c1", receita: 100, pedidos: 1 },
    ]);
  });

  it("cliente que so tem pedido cancelado some do ranking", () => {
    expect(topClientes([pedido(900, "cancelled", "c9")])).toEqual([]);
  });

  it("corta no limite pedido", () => {
    const pedidos = ["c1", "c2", "c3"].map((c, i) => pedido((i + 1) * 100, "sent", c));
    expect(topClientes(pedidos, 2).map((x) => x.cliente_id)).toEqual(["c3", "c2"]);
  });
});

describe("estoqueCritico", () => {
  const prod = (o: Partial<Parameters<typeof estoqueCritico>[0][number]>) => ({
    ativo: true, rastrear_estoque: true, quantidade_minima: 5, estoque_total: 10, estoque_reservado: 0, ...o,
  });

  it("produto inativo nao entra em nenhuma das duas contagens", () => {
    const r = estoqueCritico([prod({ ativo: false, estoque_total: 0 }), prod({ ativo: false, estoque_total: 0, estoque_reservado: 3 })]);
    expect(r).toEqual({ abaixoDoMinimo: 0, preVendaNegativa: 0 });
  });

  it("produto sem rastreio de estoque nao entra em nenhuma das duas", () => {
    const r = estoqueCritico([prod({ rastrear_estoque: false, estoque_total: 0 }), prod({ rastrear_estoque: null, estoque_total: 0, estoque_reservado: 3 })]);
    expect(r).toEqual({ abaixoDoMinimo: 0, preVendaNegativa: 0 });
  });

  it("disponivel abaixo do minimo conta em abaixoDoMinimo", () => {
    expect(estoqueCritico([prod({ estoque_total: 10, estoque_reservado: 7, quantidade_minima: 5 })]).abaixoDoMinimo).toBe(1);
  });

  it("disponivel exatamente no minimo NAO conta", () => {
    expect(estoqueCritico([prod({ estoque_total: 5, estoque_reservado: 0, quantidade_minima: 5 })]).abaixoDoMinimo).toBe(0);
  });

  it("reserva maior que o estoque = pre-venda negativa, e SO isso", () => {
    // Disjunto de proposito: negativo ja passou do minimo, mas aparecer nos dois
    // numeros faria o admin tratar o mesmo produto duas vezes.
    const r = estoqueCritico([prod({ estoque_total: 2, estoque_reservado: 6, quantidade_minima: 5 })]);
    expect(r).toEqual({ abaixoDoMinimo: 0, preVendaNegativa: 1 });
  });

  it("disponivel 0 com minimo 0 nao alarma", () => {
    expect(estoqueCritico([prod({ estoque_total: 0, estoque_reservado: 0, quantidade_minima: 0 })])).toEqual({ abaixoDoMinimo: 0, preVendaNegativa: 0 });
  });

  it("colunas nulas viram 0 e nao NaN", () => {
    const r = estoqueCritico([prod({ estoque_total: null, estoque_reservado: null, quantidade_minima: null })]);
    expect(r).toEqual({ abaixoDoMinimo: 0, preVendaNegativa: 0 });
  });
});

// ---------------------------------------------------------------------------
// Portao de papel e guarda de voo — as duas regras do painel que NAO sao conta,
// e por isso nao caberiam nas funcoes puras acima. Testadas executando a tela.
//
// `@testing-library/react` esta no package.json mas o peer `@testing-library/dom`
// NAO esta instalado (ver `protecaoDeRota.test.tsx`), entao: `renderToStaticMarkup`
// para o que so depende do render, e `createRoot` + `act` quando o efeito precisa
// rodar de verdade.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({ fetchAllRows: vi.fn(async () => [] as any[]) }));
const auth: any = { role: "admin", hasPermission: () => true };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/layouts/AdminLayout", () => ({ default: ({ children }: any) => children }));
vi.mock("@/lib/fetchAllRows", () => ({ fetchAllRows: h.fetchAllRows }));
vi.mock("@/integrations/supabase/client", () => {
  // Cadeia fluente falsa: qualquer metodo devolve a propria cadeia, e esperar
  // por ela devolve resposta vazia e sem erro.
  const cadeia: any = new Proxy({}, {
    get: (_alvo, prop) =>
      prop === "then"
        ? (ok: any) => ok({ data: [], count: 0, error: null })
        : () => cadeia,
  });
  return { supabase: { from: () => cadeia } };
});

const montarHtml = async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MemoryRouter } = await import("react-router-dom");
  const Dashboard = (await import("@/pages/admin/Dashboard")).default;
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(Dashboard)),
  );
};

describe("painel ao vivo — so admin", () => {
  it("manager COM todas as permissoes nao ve o painel", async () => {
    // `hasPermission` devolve true para tudo de proposito: receita, ticket medio
    // e ranking de clientes sao numero de dono. O portao tem que ser o PAPEL —
    // se alguem trocar por `hasPermission("orders")`, o manager que so trabalha
    // pedidos passa a ver o faturamento da empresa.
    auth.role = "manager";
    const html = await montarHtml();
    expect(html).not.toContain("Live panel");
    expect(html).not.toContain("Revenue in period");
  });

  it("admin ve o painel", async () => {
    auth.role = "admin";
    const html = await montarHtml();
    expect(html).toContain("Live panel");
    expect(html).toContain("Revenue in period");
  });
});

describe("painel ao vivo — guarda de voo", () => {
  it("Refresh durante uma leitura em voo nao dispara uma segunda leva", async () => {
    auth.role = "admin";
    h.fetchAllRows.mockReset();
    // Leitura que NUNCA termina: e exatamente a condicao em que os refreshes
    // se empilhariam (rede lenta, aba voltando do background).
    h.fetchAllRows.mockImplementation(() => new Promise<any[]>(() => {}));

    const React = (await import("react")).default;
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react-dom/test-utils");
    const { MemoryRouter } = await import("react-router-dom");
    const Dashboard = (await import("@/pages/admin/Dashboard")).default;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard)));
    });

    // Deixa a primeira leva sair inteira (a carga inicial nao espera digitacao,
    // mas ainda passa por um `setTimeout(0)`).
    await act(async () => { await new Promise((ok) => setTimeout(ok, 50)); });
    const daPrimeiraLeva = h.fetchAllRows.mock.calls.length;
    expect(daPrimeiraLeva).toBeGreaterThan(0);

    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Refresh"));
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.fetchAllRows.mock.calls.length).toBe(daPrimeiraLeva);

    await act(async () => { root.unmount(); });
    container.remove();
    h.fetchAllRows.mockImplementation(async () => []);
  });

  it("tick de 60s nao le com leitura em voo, e digitar a data espera antes de ler", async () => {
    // Relogio FALSO desde antes de montar: e a unica forma de o `setInterval` do
    // painel e o `setTimeout` da espera de digitacao serem os falsos. Com o
    // relogio real, avancar o tempo nao dispara nada e o teste passa vazio (foi
    // o que aconteceu: dois mutantes sobreviveram).
    auth.role = "admin";
    h.fetchAllRows.mockReset();
    h.fetchAllRows.mockImplementation(() => new Promise<any[]>(() => {}));
    vi.useFakeTimers();

    const React = (await import("react")).default;
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react-dom/test-utils");
    const { MemoryRouter } = await import("react-router-dom");
    const Dashboard = (await import("@/pages/admin/Dashboard")).default;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard)));
      });
      await act(async () => { vi.advanceTimersByTime(10); });
      const daPrimeira = h.fetchAllRows.mock.calls.length;
      expect(daPrimeira, "a carga inicial nao espera").toBeGreaterThan(0);

      // 5 ticks com a primeira leitura ainda em voo: nenhuma leva nova.
      await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
      expect(h.fetchAllRows.mock.calls.length, "tick empilhou leitura").toBe(daPrimeira);

      // Digitar a data: nada sai antes da espera terminar.
      const campoFrom = container.querySelector('input[type="date"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(campoFrom, "2026-01-01");
        campoFrom.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { vi.advanceTimersByTime(100); });
      expect(h.fetchAllRows.mock.calls.length, "leu a cada tecla").toBe(daPrimeira);
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(h.fetchAllRows.mock.calls.length, "nao leu depois da espera").toBeGreaterThan(daPrimeira);

      await act(async () => { root.unmount(); });
    } finally {
      vi.useRealTimers();
      container.remove();
      h.fetchAllRows.mockImplementation(async () => []);
    }
  });

  it("sozinho: le de novo a cada 60s e, na virada do dia, passa a contar o dia novo", async () => {
    // Relogio falso com data real: prende O COMPORTAMENTO (antes so havia regex
    // no texto do arquivo, e aumentar REFRESH_MS para 1 dia passava verde).
    auth.role = "admin";
    h.fetchAllRows.mockReset();
    h.fetchAllRows.mockImplementation(async () => []);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22, 10, 0, 0));

    const React = (await import("react")).default;
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react-dom/test-utils");
    const { MemoryRouter } = await import("react-router-dom");
    const Dashboard = (await import("@/pages/admin/Dashboard")).default;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard)));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      const inicio = h.fetchAllRows.mock.calls.length;
      const datas = () => [...container.querySelectorAll('input[type="date"]')].map((i) => (i as HTMLInputElement).value);
      expect(datas()[1], "periodo comeca terminando hoje").toBe("2026-09-22");

      // 1 minuto: leu de novo sozinho.
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(h.fetchAllRows.mock.calls.length, "nao leu sozinho em 60s").toBeGreaterThan(inicio);

      // Passa da meia-noite: o periodo automatico anda para o dia novo.
      vi.setSystemTime(new Date(2026, 8, 23, 0, 0, 5));
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      expect(datas()[1], "ficou preso no dia anterior").toBe("2026-09-23");
      expect(datas()[0]).toBe("2026-09-01");
    } finally {
      await act(async () => { root.unmount(); });
      vi.useRealTimers();
      container.remove();
    }
  });

  it("periodo invalido nao le nada e nao carimba hora nova", async () => {
    // Campo de data apagado / de baixo maior que o de cima: a leitura em voo
    // era invalidada, mas ainda escrevia os numeros do periodo antigo sob as
    // datas novas com "Last updated" de agora.
    auth.role = "admin";
    h.fetchAllRows.mockReset();
    const liberar: Array<(v: any[]) => void> = [];
    h.fetchAllRows.mockImplementation(() => new Promise<any[]>((ok) => liberar.push(ok)));

    const React = (await import("react")).default;
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react-dom/test-utils");
    const { MemoryRouter } = await import("react-router-dom");
    const Dashboard = (await import("@/pages/admin/Dashboard")).default;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard)));
      });
      await act(async () => { await new Promise((ok) => setTimeout(ok, 50)); });
      const antes = h.fetchAllRows.mock.calls.length;

      const campoTo = container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(campoTo, "2020-01-01"); // menor que `from`
        campoTo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await new Promise((ok) => setTimeout(ok, 600)); });
      expect(h.fetchAllRows.mock.calls.length, "leu com periodo invalido").toBe(antes);

      // A leitura antiga volta: nao pode escrever nada.
      await act(async () => { liberar.forEach((ok) => ok([])); await new Promise((ok) => setTimeout(ok, 20)); });
      expect(container.textContent, "resposta velha carimbou hora").not.toContain("Last updated");
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      h.fetchAllRows.mockImplementation(async () => []);
    }
  });

  it("periodo automatico acompanha a virada do dia; periodo escolhido a mao, nao", async () => {
    // Painel aberto atravessando a meia-noite: `to` continuaria sendo ontem e o
    // faturamento de hoje sumiria, com "Last updated" novo por cima.
    const src = readFileSync("src/pages/admin/Dashboard.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(/if \(!periodoManual\.current\) \{\s*const hoje = periodoAtual\(\);[\s\S]{0,200}?if \(hoje\.from !== from \|\| hoje\.to !== to\) \{ setPeriodo\(hoje\); return; \}/);
    // e escolher data a mao desliga esse automatico (senao o refresh apagaria a
    // escolha do admin no meio da leitura)
    expect(src.match(/periodoManual\.current = true;/g) ?? []).toHaveLength(2);
  });

  it("trocar o periodo DURANTE uma leitura em voo recarrega, e a resposta velha nao escreve na tela", async () => {
    // A guarda de voo sozinha engolia a troca de periodo: a tela ficava com os
    // numeros do periodo ANTIGO sob as datas NOVAS, carimbados como recentes,
    // ate o tick de 60s. O dono leria faturamento de setembro achando que e de
    // janeiro. Aqui a leitura nova TEM que sair.
    auth.role = "admin";
    h.fetchAllRows.mockReset();
    const liberar: Array<(v: any[]) => void> = [];
    h.fetchAllRows.mockImplementation(() => new Promise<any[]>((ok) => liberar.push(ok)));

    const React = (await import("react")).default;
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react-dom/test-utils");
    const { MemoryRouter } = await import("react-router-dom");
    const Dashboard = (await import("@/pages/admin/Dashboard")).default;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard)));
    });
    await act(async () => { await new Promise((ok) => setTimeout(ok, 50)); });
    const daPrimeira = h.fetchAllRows.mock.calls.length;

    const campoFrom = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(campoFrom).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(campoFrom, "2026-01-01");
      campoFrom.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Espera da digitacao: a leitura nova sai DEPOIS do intervalo de digitacao,
    // nunca a cada tecla (digitar o ano emite uma data completa por tecla).
    expect(h.fetchAllRows.mock.calls.length).toBe(daPrimeira);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 500)); });
    expect(h.fetchAllRows.mock.calls.length).toBeGreaterThan(daPrimeira);

    // A leitura ANTIGA volta depois da troca: nao pode carimbar "Last updated"
    // NEM dizer que a leitura nova terminou (Refresh so volta com a vigente).
    await act(async () => { liberar.slice(0, daPrimeira).forEach((ok) => ok([])); });
    expect(container.textContent).toContain("Loading…");
    expect(container.textContent).not.toContain("Last updated");
    const refresh = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Refresh")) as HTMLButtonElement;
    expect(refresh.disabled, "resposta velha nao pode liberar o botao da leitura nova").toBe(true);

    await act(async () => { root.unmount(); });
    container.remove();
    h.fetchAllRows.mockImplementation(async () => []);
  });
});
