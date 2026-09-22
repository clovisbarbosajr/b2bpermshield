import { describe, it, expect, vi } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do
// Node nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em
// execucao o modulo existe. Mesma nota de `entradaErroDeLeitura.test.ts`.
// @ts-expect-error
import { readFileSync } from "node:fs";

// As duas telas criam o cliente do Supabase no import. O que esta sob teste aqui
// e leitura pura de query string.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { filtrosDaUrl as filtrosPedidos } from "./Pedidos";
import { filtrosDaUrl as filtrosClientes } from "./Clientes";

// O Dashboard vai linkar pra /admin/orders?from=&to=&status= e pra
// /admin/customers?status=. Param invalido tem que ser IGNORADO EM SILENCIO:
// se virar filtro, a tela abre vazia e o admin conclui "nao tem pedido nenhum".
const qs = (s: string) => new URLSearchParams(s);

describe("Pedidos — filtrosDaUrl", () => {
  it("from/to validos viram fromDate/toDate", () => {
    expect(filtrosPedidos(qs("from=2026-01-01&to=2026-03-31")))
      .toEqual({ fromDate: "2026-01-01", toDate: "2026-03-31" });
  });

  it("sem params nao mexe em nada (defaults da tela seguem intactos)", () => {
    expect(filtrosPedidos(qs(""))).toEqual({});
  });

  it("status conhecido entra", () => {
    expect(filtrosPedidos(qs("status=complete"))).toEqual({ status: "complete" });
  });

  it("status desconhecido e ignorado", () => {
    expect(filtrosPedidos(qs("status=concluido"))).toEqual({});
    expect(filtrosPedidos(qs("status=__all__"))).toEqual({});
  });

  it("data com formato errado e ignorada", () => {
    expect(filtrosPedidos(qs("from=01/02/2026"))).toEqual({});
    expect(filtrosPedidos(qs("from=2026-1-1"))).toEqual({});
    expect(filtrosPedidos(qs("from=ontem"))).toEqual({});
    expect(filtrosPedidos(qs("from="))).toEqual({});
  });

  it("data com formato certo mas inexistente e ignorada", () => {
    // Passa na regex e NAO existe no calendario. So a checagem de calendario pega.
    expect(filtrosPedidos(qs("from=2026-02-30"))).toEqual({});
    expect(filtrosPedidos(qs("to=2026-13-01"))).toEqual({});
  });

  it("um param invalido nao derruba o outro que esta valido", () => {
    expect(filtrosPedidos(qs("from=2026-02-30&to=2026-03-31&status=xyz")))
      .toEqual({ toDate: "2026-03-31" });
  });
});

describe("Pedidos — filtro por cliente (botao \"View all orders\" da ficha)", () => {
  const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

  it("customer=<uuid> vira clienteId", () => {
    expect(filtrosPedidos(new URLSearchParams(`customer=${ID}`))).toEqual({ clienteId: ID });
  });

  it.each(["abc", "123", "", "3f2a1b4c-5d6e-4f70-8a9b", `${ID} or 1=1`, "%27"])(
    "customer invalido (%s) e ignorado", (ruim) => {
      expect(filtrosPedidos(new URLSearchParams(`customer=${ruim}`))).toEqual({});
    });

  it("convive com periodo e status", () => {
    const r = filtrosPedidos(new URLSearchParams(`customer=${ID}&from=2026-09-01&status=pending`));
    expect(r.clienteId).toBe(ID);
    expect(r.fromDate).toBe("2026-09-01");
  });

  it("a lista REALMENTE filtra por cliente, e avisa na tela", () => {
    const s = (readFileSync("src/pages/admin/Pedidos.tsx", "utf8") as string).replace(/\r\n/g, "\n");
    expect(s).toContain("if (f.clienteId && p.cliente_id !== f.clienteId) return false;");
    expect(s).toContain("{filters.clienteId && (");
    expect(s).toContain("Customer: {pedidos.find((p) => p.cliente_id === filters.clienteId)");
    // e sai no "Clear" como qualquer outro filtro
    expect(s).toContain("clienteId: \"\",");
  });
});

describe("Clientes — filtrosDaUrl", () => {
  it("status=pendente e aceito", () => {
    expect(filtrosClientes(qs("status=pendente"))).toEqual({ status: "pendente" });
  });

  it("os outros dois valores do enum tambem", () => {
    expect(filtrosClientes(qs("status=ativo"))).toEqual({ status: "ativo" });
    expect(filtrosClientes(qs("status=inativo"))).toEqual({ status: "inativo" });
  });

  it("sem params nao mexe em nada", () => {
    expect(filtrosClientes(qs(""))).toEqual({});
  });

  it("status desconhecido e ignorado", () => {
    expect(filtrosClientes(qs("status=pending"))).toEqual({});
    expect(filtrosClientes(qs("status=rejeitado"))).toEqual({});
    expect(filtrosClientes(qs("status="))).toEqual({});
  });

  it("nao carrega params que nao sao dela", () => {
    expect(filtrosClientes(qs("from=2026-01-01&to=2026-03-31"))).toEqual({});
  });
});

// TESTE DE FIACAO: semear um filtro que a lista nao aplica e o defeito que as
// duas telas ja tiveram (ver os comentarios "filtros que apareciam na tela e
// nao filtravam nada"). Montar os componentes exigiria @testing-library/react,
// que nao esta instalado — entao aqui se le a fonte, igual a
// `entradaErroDeLeitura.test.ts`.
describe("fiacao do que a URL semeia", () => {
  const fonte = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8") as string;

  it("Clientes: o filtro de status REALMENTE entra no `filtered`", () => {
    expect(fonte("./Clientes.tsx")).toMatch(/if \(f\.status && c\.status !== f\.status\) return false;/);
  });

  it("Pedidos: fromDate/toDate/status que a URL semeia ja eram aplicados", () => {
    const s = fonte("./Pedidos.tsx");
    expect(s).toMatch(/if \(f\.fromDate &&/);
    expect(s).toMatch(/if \(f\.toDate &&/);
    expect(s).toMatch(/if \(f\.status &&/);
  });

  it("as duas telas semeiam no inicializador do useState", () => {
    const seed = /useState\(\(\) => \(\{ \.\.\.emptyFilters, \.\.\.filtrosDaUrl\(searchParams\) \}\)\)/;
    expect(fonte("./Pedidos.tsx")).toMatch(seed);
    expect(fonte("./Clientes.tsx")).toMatch(seed);
  });

  it("re-semeia quando a URL muda, e a dependencia e a QUERY (nao o objeto do router)", () => {
    // Sem isto, entrar pelo link do painel e voltar pelo menu deixava o filtro
    // grudado com a URL ja limpa (o router nao remonta se so a query muda).
    // A dependencia tem que ser a string: `searchParams` e objeto novo a cada
    // render e o efeito rodaria sempre, apagando o filtro digitado a mao.
    for (const tela of ["./Pedidos.tsx", "./Clientes.tsx"]) {
      const s = fonte(tela);
      expect(s, tela).toContain("const urlDosFiltros = searchParams.toString();");
      expect(s, tela).toMatch(/setFilters\(\{ \.\.\.emptyFilters, \.\.\.filtrosDaUrl\(new URLSearchParams\(urlDosFiltros\)\) \}\);\s*\}, \[urlDosFiltros\]\);/);
    }
  });

  it("o filtro de data de Pedidos le a borda inicial no fuso LOCAL, igual ao painel", () => {
    // `new Date("2026-09-01")` e meia-noite UTC pela especificacao: pedido da
    // noite do dia 31 entrava na lista e nao no card do painel que linka para
    // ela. `delivery_date` e DATA em UTC e continua SEM o sufixo.
    const s = fonte("./Pedidos.tsx");
    // Com o OPERADOR junto: sem ele, inverter `<` por `>` (a lista devolve
    // exatamente o complemento) passava verde.
    expect(s).toContain('new Date(p.created_at) < new Date(f.fromDate + "T00:00:00")');
    expect(s).toContain('new Date(p.created_at) > new Date(f.toDate + "T23:59:59")');
    expect(s).not.toMatch(/new Date\(f\.fromDate\)/);
    // `delivery_date` e DATA em UTC nas DUAS pontas (a de cima ja era; a de
    // baixo comparava com 23:59:59 local e trazia o dia seguinte junto).
    expect(s).toContain("new Date(p.delivery_date) < new Date(f.fromDeliveryDate)");
    expect(s).toContain('new Date(p.delivery_date) > new Date(f.toDeliveryDate + "T23:59:59.999Z")');
  });
});
