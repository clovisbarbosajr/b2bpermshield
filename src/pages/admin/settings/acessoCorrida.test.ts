import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Sem @testing-library/react: o pacote esta no package.json mas o peer
// `@testing-library/dom` nao esta instalado. `react-dom/client` + `act` do
// React 18.3 dao o mesmo controle e nao adicionam dependencia.

// TESTE DE CONCORRENCIA de verdade — a tela E MONTADA e os cliques acontecem
// sobrepostos, com a resposta do servidor voltando FORA DE ORDEM. Leitura de
// codigo nao pega isto: o defeito e o estado em memoria envelhecendo durante a
// ida ao servidor.
//
// O caso: `UsersManagement` da PAPEL e LOCALIZACAO a funcionario. Clicar Edit em
// A, clicar Edit em B, e a resposta de A voltar por ultimo fazia o dialogo de B
// receber os LOCAIS de A — e o Save gravava os locais de A na conta de B, via
// `set_user_locations`, que APAGA e regrava a lista inteira.
//
// O segundo caso e o oposto e pior: erro na leitura dos locais virava lista
// vazia, e lista vazia NAO e "sem acesso" — a policy de `categorias`
// (20260619220000) libera TUDO para quem nao tem linha em `user_locations`.
// Salvar depois de uma leitura falhada PROMOVIA o funcionario restrito a ver
// todas as localizacoes.

const h = vi.hoisted(() => {
  const est = {
    roles: { data: [] as any[], error: null as any },
    /** user_id -> promessa da leitura de `user_locations` (controlada pelo teste). */
    locais: new Map<string, Promise<any>>(),
    rpcs: [] as any[],
    upserts: [] as any[],
  };
  return est;
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/layouts/AdminLayout", () => ({
  default: ({ children }: any) => children,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (tabela: string) => {
    const c: any = { _eq: {} as Record<string, any>, _ops: [] as string[] };
    for (const m of ["select", "order", "in", "limit", "insert", "update", "delete", "upsert", "range"]) {
      c[m] = (...args: any[]) => {
        c._ops.push(m);
        if (m === "upsert") h.upserts.push(args[0]);
        return c;
      };
    }
    c.eq = (col: string, val: any) => { c._eq[col] = val; return c; };
    c.then = (ok: any, err: any) => {
      let p: Promise<any>;
      if (tabela === "user_locations") {
        p = h.locais.get(c._eq.user_id) ?? Promise.resolve({ data: [], error: null });
      } else if (tabela === "user_roles") {
        p = c._ops.includes("upsert")
          ? Promise.resolve({ data: null, error: null })
          : Promise.resolve(h.roles);
      } else {
        p = Promise.resolve({ data: [], error: null });
      }
      return p.then(ok, err);
    };
    return c;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      functions: {
        invoke: async (_fn: string, opts: any) => {
          if (opts?.body?.action === "list_staff") {
            return {
              data: {
                users: (opts.body.user_ids as string[]).map((id) => ({
                  id, email: `${id}@x.com`, nome: id, created_at: "2026-01-01", last_sign_in_at: null,
                })),
              },
              error: null,
            };
          }
          return { data: { success: true }, error: null };
        },
      },
      rpc: async (nome: string, args: any) => { h.rpcs.push({ nome, args }); return { data: 0, error: null }; },
    },
  };
});

import UsersManagement from "./UsersManagement";
import { toast } from "sonner";

const dosStaff = [
  { user_id: "A", role: "warehouse", permissions: {} },
  { user_id: "B", role: "warehouse", permissions: {} },
];

let raiz: Root | null = null;
let caixa: HTMLDivElement | null = null;

beforeEach(() => {
  h.roles = { data: dosStaff, error: null };
  h.locais = new Map();
  h.rpcs = [];
  h.upserts = [];
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(async () => {
  if (raiz) await act(async () => { raiz!.unmount(); });
  caixa?.remove();
  raiz = null; caixa = null;
});

/** Monta a tela e espera a lista carregar. O dialogo do Radix vai para um portal
 *  em `document.body`, entao toda busca e no documento inteiro. */
const montar = async (quantos = 2) => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  await act(async () => { raiz!.render(createElement(UsersManagement)); });
  expect(editar()).toHaveLength(quantos);
};

const editar = () => Array.from(document.querySelectorAll<HTMLElement>('button[title="Edit"]'));

const porTexto = (texto: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) => b.textContent?.trim() === texto) ?? null;

const clicar = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("UsersManagement sob cliques sobrepostos", () => {
  it("resposta atrasada do PRIMEIRO Edit nao contamina o dialogo do SEGUNDO", async () => {
    // A demora; B volta na hora.
    let liberaA!: (v: any) => void;
    h.locais.set("A", new Promise((res) => { liberaA = res; }));
    h.locais.set("B", Promise.resolve({ data: [{ categoria_id: "cat-da-B" }], error: null }));

    await montar();

    await clicar(editar()[0]); // A — fica pendurado
    await clicar(editar()[1]); // B — abre

    expect(porTexto("Save Changes")).not.toBeNull();

    // Agora a resposta de A chega, DEPOIS de B ja estar na tela.
    await act(async () => { liberaA({ data: [{ categoria_id: "cat-da-A" }], error: null }); });

    await clicar(porTexto("Save Changes"));

    expect(h.rpcs).toHaveLength(1);
    expect(h.rpcs[0].nome).toBe("set_user_locations");
    expect(h.rpcs[0].args._user_id).toBe("B");
    // O defeito gravava ["cat-da-A"] na conta de B.
    expect(h.rpcs[0].args._categoria_ids).toEqual(["cat-da-B"]);
    expect(h.upserts[0].user_id).toBe("B");
  });

  it("erro na leitura dos locais nao abre o editor — e portanto nao apaga a restricao", async () => {
    h.locais.set("A", Promise.resolve({ data: null, error: { message: "network" } }));

    await montar();
    await clicar(editar()[0]);

    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/location access/i);

    // Editor fechado => nao ha Save => `set_user_locations(user, [])` nao acontece.
    expect(porTexto("Save Changes")).toBeNull();
    expect(h.rpcs).toHaveLength(0);
  });

  it("50 cliques em Edit sobrepostos, respostas fora de ordem: so o ultimo escreve", async () => {
    // Estresse do mesmo mecanismo: 50 leituras em voo ao mesmo tempo e as
    // respostas voltando embaralhadas. Independentemente da ordem de chegada,
    // quem manda no dialogo tem que ser o ULTIMO clique.
    const liberam: Array<(v: any) => void> = [];
    h.roles = {
      data: Array.from({ length: 50 }, (_, i) => ({ user_id: `U${i}`, role: "warehouse", permissions: {} })),
      error: null,
    };
    for (let i = 0; i < 50; i++) h.locais.set(`U${i}`, new Promise((res) => { liberam[i] = res; }));

    await montar(50);

    const botoes = editar();
    await act(async () => {
      for (const b of botoes) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Respostas voltam na ordem INVERSA — a do ultimo clique chega primeiro.
    await act(async () => {
      for (let i = 49; i >= 0; i--) liberam[i]({ data: [{ categoria_id: `cat-U${i}` }], error: null });
    });

    await clicar(porTexto("Save Changes"));

    expect(h.rpcs).toHaveLength(1);
    expect(h.rpcs[0].args._user_id).toBe("U49");
    expect(h.rpcs[0].args._categoria_ids).toEqual(["cat-U49"]);
  });
});
