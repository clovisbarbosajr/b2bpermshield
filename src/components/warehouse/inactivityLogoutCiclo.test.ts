// @vitest-environment jsdom
//
// O que este arquivo trava: o `InactivityLogout` le a config no servidor ANTES de
// armar o timer, e a limpeza do React roda de forma sincrona. As tres formas de
// isso dar errado estao aqui, porque nenhuma delas aparece na leitura do codigo:
//
//  1. desmontar durante a leitura e o timer ser armado assim mesmo (logout
//     surpresa num componente que ja saiu da tela, com listeners eternos);
//  2. a leitura falhar e a protecao inteira sumir (usuario nunca mais deslogado);
//  3. o caminho feliz parar de deslogar por causa das guardas acima.
//
// Sem `@testing-library/react` de proposito: o pacote esta no `package.json` mas
// o peer `@testing-library/dom` NAO esta instalado neste projeto. `createRoot` +
// `act` sao suficientes para um componente que so tem efeito e devolve `null`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";

const h = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  rpc: vi.fn(),
  role: { atual: "warehouse" as string },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: h.role.atual, signOut: h.signOut }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => h.rpc(...a) },
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

import InactivityLogout from "./InactivityLogout";

// `warehouse_popup_day: -1` nunca bate com `getDay()`, entao o teste vale em
// qualquer dia da semana em que a suite rodar. 3 minutos e so um numero curto.
const CONFIG_OK = { data: [{ warehouse_popup_day: -1, warehouse_inactivity_popup: 5, warehouse_inactivity_default: 3 }], error: null };
const TRES_MIN = 3 * 60 * 1000;

let root: Root | null = null;
let host: HTMLDivElement;

const montar = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(InactivityLogout)); });
};
const desmontar = async () => {
  await act(async () => { root!.unmount(); });
  root = null;
  host.remove();
};

describe("InactivityLogout — leitura assincrona x ciclo de vida", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    h.role.atual = "warehouse";
    h.signOut.mockClear();
    h.rpc.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("desmontado durante a leitura: nao instala listener e nao desloga", async () => {
    let liberar!: (v: unknown) => void;
    h.rpc.mockImplementation(() => new Promise((ok) => { liberar = ok; }));
    const add = vi.spyOn(window, "addEventListener");

    await montar();
    // A leitura ainda esta em voo: nada foi instalado.
    expect(add).not.toHaveBeenCalledWith("mousemove", expect.anything(), expect.anything());

    await desmontar();
    await act(async () => { liberar(CONFIG_OK); });

    // O `init` terminou DEPOIS do unmount. Antes da correcao ele instalava os
    // listeners aqui e armava um `signOut` para daqui a N minutos.
    expect(add).not.toHaveBeenCalledWith("mousemove", expect.anything(), expect.anything());
    await act(async () => { vi.advanceTimersByTime(9 * 60 * 60 * 1000); });
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("leitura da config falhando nao desliga a protecao", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockRejectedValue(new Error("rede caiu"));
    const add = vi.spyOn(window, "addEventListener");

    await montar();

    expect(erro).toHaveBeenCalled();
    // Defaults chumbados assumem o lugar — o terminal continua com timer.
    expect(add).toHaveBeenCalledWith("mousemove", expect.anything(), expect.anything());
    await desmontar();
  });

  it("caminho feliz: desloga no tempo lido, e atividade adia", async () => {
    h.rpc.mockResolvedValue(CONFIG_OK);
    await montar();

    await act(async () => { vi.advanceTimersByTime(TRES_MIN - 1000); });
    expect(h.signOut).not.toHaveBeenCalled();

    // Mexeu o mouse: o relogio reinicia.
    await act(async () => { window.dispatchEvent(new Event("mousemove")); });
    await act(async () => { vi.advanceTimersByTime(TRES_MIN - 1000); });
    expect(h.signOut).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(h.signOut).toHaveBeenCalledTimes(1);
    await desmontar();
  });

  it("papel que nao e warehouse nem le a config", async () => {
    h.role.atual = "admin";
    h.rpc.mockResolvedValue(CONFIG_OK);
    await montar();
    expect(h.rpc).not.toHaveBeenCalled();
    await desmontar();
  });
  // ESTRESSE. Leitura nao acha isto: o defeito so aparece quando MUITAS montagens
  // e desmontagens se cruzam com leituras ainda em voo — que e o que acontece de
  // verdade a cada refresh de token, cada volta para a aba e cada navegacao do
  // almoxarifado. Aqui sao 30 instancias vivas ao mesmo tempo, metade desmontada
  // ANTES de a config chegar, com as respostas voltando fora de ordem.
  //
  // Duas contas fecham ou nao fecham: `addEventListener` menos `removeEventListener`
  // tem que dar ZERO no fim, e ninguem pode ser deslogado depois que tudo saiu da
  // tela. Contra a versao anterior a conta dava 15 listeners pendurados e o
  // `signOut` disparava para componentes que ja nao existiam.
  it("estresse: 30 montagens cruzando com leituras em voo nao deixam listener nem logout orfao", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const rem = vi.spyOn(window, "removeEventListener");

    const liberadores: Array<(v: unknown) => void> = [];
    h.rpc.mockImplementation(() => new Promise((ok) => { liberadores.push(ok); }));

    const raizes: Array<{ root: Root; host: HTMLDivElement }> = [];
    for (let i = 0; i < 30; i++) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const r = createRoot(host);
      await act(async () => { r.render(createElement(InactivityLogout)); });
      raizes.push({ root: r, host });
    }
    expect(liberadores).toHaveLength(30);

    // Metade some ANTES da resposta chegar (indices pares).
    for (let i = 0; i < 30; i += 2) {
      await act(async () => { raizes[i].root.unmount(); });
      raizes[i].host.remove();
    }

    // Respostas voltam FORA DE ORDEM.
    await act(async () => { for (let i = liberadores.length - 1; i >= 0; i--) liberadores[i](CONFIG_OK); });

    // Os 15 que sobraram estao vivos e armados; atividade concorrente neles nao
    // pode multiplicar timer.
    for (let k = 0; k < 20; k++) await act(async () => { window.dispatchEvent(new Event("mousemove")); });
    await act(async () => { vi.advanceTimersByTime(TRES_MIN + 1000); });
    expect(h.signOut).toHaveBeenCalledTimes(15);
    h.signOut.mockClear();

    // Sai o resto.
    for (let i = 1; i < 30; i += 2) {
      await act(async () => { raizes[i].root.unmount(); });
      raizes[i].host.remove();
    }

    const conta = (m: typeof add) => m.mock.calls.filter((c) => c[0] === "mousemove").length;
    expect(conta(add)).toBe(15);          // so os 15 que chegaram a instalar
    expect(conta(add) - conta(rem)).toBe(0); // e todos foram removidos

    await act(async () => { vi.advanceTimersByTime(9 * 60 * 60 * 1000); });
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
