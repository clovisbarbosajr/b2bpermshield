import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

// TESTE QUE MONTA A TELA — nao le o texto do arquivo. Segue o molde de
// `acessoCorrida.test.ts` (react-dom/client + act; sem @testing-library, cujo
// peer `@testing-library/dom` nao esta instalado neste projeto).
//
// Dois defeitos desta tela, e nenhum deles aparece em leitura de codigo:
//
// 1. O `.limit(200)` era CEGO. O `notification_log` e usado tambem como
//    barramento de auditoria pelo `b2bwave-sync` e pelas travas SQL, que gravam
//    `channel = '-'` (nunca houve canal nem destinatario). Uma limpeza de
//    pedidos fantasma grava uma linha POR PEDIDO (`b2bwave-sync:3106`) e enchia
//    a janela inteira: o admin abria "Ultimos 200 envios" e nao via UM envio.
//
// 2. `load()` nao tinha guarda de ordem, e a tela tem botao "Atualizar". O caso
//    caro nao e trocar 200 linhas por 200 quase iguais — e a leitura VELHA
//    bem-sucedida chegando depois de uma que FALHOU e apagando o banner de erro.
//    A tela passa a exibir dados obsoletos como se fossem atuais, que e a
//    mentira que esta tela existe para impedir (os 1.508 SMS de 25/ago).

const h = vi.hoisted(() => ({
  /** Fila de respostas por balde, na ordem em que a tela pedir. */
  envios: [] as Promise<any>[],
  sistema: [] as Promise<any>[],
  /** Todo filtro de canal que a tela aplicou, para provar que ela separa. */
  filtros: [] as string[],
}));

vi.mock("@/components/layouts/AdminLayout", () => ({ default: ({ children }: any) => children }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: any = { _balde: null as null | "envios" | "sistema" };
    for (const m of ["select", "order", "limit"]) c[m] = () => c;
    c.neq = (col: string, val: any) => { if (col === "channel") { h.filtros.push(`neq:${val}`); c._balde = "envios"; } return c; };
    c.eq = (col: string, val: any) => { if (col === "channel") { h.filtros.push(`eq:${val}`); c._balde = "sistema"; } return c; };
    c.then = (ok: any, err: any) => {
      // Sem filtro de canal = leitura CEGA: e o defeito. Devolve tudo junto,
      // que e o que o banco faria, e a tela reprova sozinha.
      const fila = c._balde === "sistema" ? h.sistema : h.envios;
      const p = fila.shift() ?? Promise.resolve({ data: [], error: null });
      return p.then(ok, err);
    };
    return c;
  };
  return { supabase: { from: () => chain() } };
});

import NotificacoesLog from "./NotificacoesLog";

const linha = (o: Partial<any>) => ({
  id: o.id, event: o.event ?? "new_order", channel: o.channel ?? "sms",
  recipient: o.recipient ?? "+15550001111", status: o.status ?? "sent",
  error: o.error ?? null, created_at: "2026-08-30T12:00:00Z",
});

const ENVIO_REAL = linha({ id: "e1", recipient: "+15559998888" });
/** Diagnostico do sync: canal e destino '-', status 'failed', nao e envio. */
const DIAGNOSTICO = (n: number) => linha({
  id: `d${n}`, event: "pedido_fantasma_apagado", channel: "-", recipient: "-",
  status: "failed", error: "pedido fantasma apagado",
});

let raiz: Root | null = null;
let caixa: HTMLDivElement | null = null;

const montar = async () => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  await act(async () => { raiz!.render(createElement(NotificacoesLog)); });
};

const texto = () => caixa?.textContent ?? "";
const atualizar = async () => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Atualizar"));
  expect(btn, "o botao Atualizar tem que existir — e ele que cria a corrida").toBeTruthy();
  await act(async () => { btn!.click(); });
};

beforeEach(() => { h.envios = []; h.sistema = []; h.filtros = []; });
afterEach(async () => {
  if (raiz) await act(async () => { raiz!.unmount(); });
  caixa?.remove();
  raiz = null; caixa = null;
});

describe("NotificacoesLog: o envio real nao pode ser afogado pelo diagnostico", () => {
  it("separa os baldes por canal, em vez de uma janela unica", async () => {
    h.envios = [Promise.resolve({ data: [ENVIO_REAL], error: null })];
    h.sistema = [Promise.resolve({ data: [DIAGNOSTICO(1)], error: null })];
    await montar();
    expect(h.filtros).toContain(`neq:-`);
    expect(h.filtros).toContain(`eq:-`);
  });

  it("300 diagnosticos de sync NAO expulsam o unico envio real da tela", async () => {
    // O balde de envios so recebe o envio porque a tela FILTROU. Sem o filtro,
    // a leitura e uma so e as 200 posicoes saem todas do lote de diagnostico.
    const enxurrada = Array.from({ length: 300 }, (_, i) => DIAGNOSTICO(i));
    h.envios = [Promise.resolve({ data: [ENVIO_REAL], error: null })];
    h.sistema = [Promise.resolve({ data: enxurrada.slice(0, 50), error: null })];
    await montar();
    expect(texto()).toContain("+15559998888");
  });

  it("recusa deliberada nao aparece como falha", async () => {
    h.envios = [Promise.resolve({
      data: [linha({ id: "r1", channel: "whatsapp", status: "failed", error: "skip: channel disabled" })],
      error: null,
    })];
    await montar();
    expect(texto()).toContain("recusado");
    expect(texto()).not.toContain("falhou");
  });

  it("falha de provider continua aparecendo como falha", async () => {
    h.envios = [Promise.resolve({
      data: [linha({ id: "f1", status: "failed", error: "Twilio: insufficient funds" })],
      error: null,
    })];
    await montar();
    expect(texto()).toContain("falhou");
  });
});

describe("NotificacoesLog: guarda de ordem no load", () => {
  // A direcao que importa e esta, e nao a inversa: se a carga VELHA falha e
  // chega por ultimo, ela escreve o banner de erro POR CIMA de uma leitura nova
  // que deu certo. A tela passa a dizer "nao consegui ler o historico" sobre uma
  // leitura que funcionou, e o operador conclui que esta cego bem na hora em que
  // nao esta. (A direcao inversa — velha bem-sucedida chegando por ultimo — fica
  // MASCARADA pelo `erro` ja setado, que faz a tela nem renderizar a tabela;
  // por isso ela nao serve de mutante e nao esta testada aqui.)
  it("leitura VELHA que falhou nao sobrescreve a leitura NOVA que deu certo", async () => {
    let rejeitaVelha: (v: any) => void = () => {};
    const velha = new Promise<any>((r) => { rejeitaVelha = r; });
    h.envios = [velha, Promise.resolve({ data: [ENVIO_REAL], error: null })];
    h.sistema = [Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null })];

    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    raiz = createRoot(caixa);
    await act(async () => { raiz!.render(createElement(NotificacoesLog)); });
    await atualizar();
    expect(texto()).toContain("+15559998888");

    await act(async () => { rejeitaVelha({ data: null, error: { message: "rede caiu" } }); });
    expect(texto(), "a resposta atrasada que falhou apagou a leitura boa").not.toContain("Não consegui ler o histórico");
    expect(texto()).toContain("+15559998888");
  });
});
