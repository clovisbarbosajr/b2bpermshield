import { describe, it, expect, vi } from "vitest";

// A tela cria o cliente do Supabase no import, e o vitest.config.ts nao injeta
// VITE_SUPABASE_URL (so o vite.config.ts injeta). Stub do modulo: o que esta sob
// teste aqui e regra pura + as duas escritas, sempre contra um cliente falso.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { enderecoOwnerId, enderecoIncompleto, adicionarEndereco, removerEndereco } from "./Conta";

// Trava as regras que estavam quebradas nesta tela:
//
// 1. dono do endereco. O Checkout resolve com `parent_customer_id ?? id`
//    (Checkout.tsx:147). Enquanto a Conta usava `cliente.id`, o endereco do
//    sub-login era gravado sob a ficha errada e sumia na hora de finalizar.
// 2. endereco em branco. "Save Address" gravava sem nenhum campo, e a linha
//    vazia aparecia selecionavel no checkout.
// 3. remocao que nao removeu. O supabase-js NAO levanta erro quando a RLS (ou
//    outra aba que ja apagou) filtra tudo: volta sem `error` e com zero linhas.
//    A tela dizia "Address removed" e o endereco continuava la depois do F5.
//
// Os testes afirmam a FIACAO, nao so o desfecho: qual `cliente_id` foi para o
// payload e o que a chamada devolveu. Trocar `enderecoOwnerId(cliente)` de volta
// por `cliente.id`, ou tirar o `.select("id")` do delete, reprova aqui.

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type Linha = Record<string, any>;

// Banco falso no molde de `fetchAllRows.test.ts`: sem rede, so a cadeia do
// postgrest sobre um store em memoria. O `await tick()` ANTES de olhar o store e
// o que deixa duas chamadas se cruzarem de verdade.
function bancoFalso(enderecos: Linha[], opts: { podeDeletar?: (r: Linha) => boolean } = {}) {
  const store = { enderecos: enderecos.map((e) => ({ ...e })) };
  const inseridos: Linha[] = [];
  const db: any = {
    from: () => ({
      insert: (linha: Linha) => ({
        then: (res: any, rej: any) =>
          (async () => {
            await tick();
            inseridos.push(linha);
            store.enderecos = [...store.enderecos, { id: `novo-${inseridos.length}`, ...linha }];
            return { data: null, error: null };
          })().then(res, rej),
      }),
      delete: () => {
        const filtros: [string, any][] = [];
        // Como no PostgREST de verdade: DELETE so devolve linha quando o
        // chamador pede "select". Sem isto, apagar o .select("id") do codigo
        // passaria despercebido aqui.
        let pediuVolta = false;
        const api: any = {
          eq: (c: string, v: any) => { filtros.push([c, v]); return api; },
          select: () => { pediuVolta = true; return api; },
          then: (res: any, rej: any) =>
            (async () => {
              await tick();
              const alvo = store.enderecos.filter((r) => filtros.every(([c, v]) => r[c] === v));
              const apagados = alvo.filter((r) => opts.podeDeletar?.(r) ?? true);
              store.enderecos = store.enderecos.filter((r) => !apagados.includes(r));
              return { data: pediuVolta ? apagados.map((r) => ({ id: r.id })) : null, error: null };
            })().then(res, rej),
        };
        return api;
      },
    }),
  };
  return { db, store, inseridos };
}

const subLogin = { id: "sub-1", parent_customer_id: "pai-1" };
const titular = { id: "titular-1", parent_customer_id: null };
const cheio = { logradouro: "1800 N Powerline Rd", numero: "A6", complemento: "", bairro: "", cidade: "Pompano Beach", estado: "FL", cep: "33069" };

describe("enderecoOwnerId", () => {
  it("sub-login usa a ficha do PAI (mesma regra do Checkout)", () => {
    expect(enderecoOwnerId(subLogin)).toBe("pai-1");
  });

  it("titular usa a propria ficha", () => {
    expect(enderecoOwnerId(titular)).toBe("titular-1");
  });
});

describe("enderecoIncompleto", () => {
  it("aceita endereco completo", () => {
    expect(enderecoIncompleto(cheio)).toBe(false);
  });

  it("recusa endereco vazio", () => {
    expect(enderecoIncompleto({ logradouro: "", cidade: "", estado: "", cep: "" })).toBe(true);
  });

  it("recusa campo obrigatorio so com espaco", () => {
    for (const campo of ["logradouro", "cidade", "estado", "cep"] as const) {
      expect(enderecoIncompleto({ ...cheio, [campo]: "   " })).toBe(true);
    }
  });
});

describe("adicionarEndereco", () => {
  it("sub-login grava sob o id do PAI", async () => {
    const { db, inseridos } = bancoFalso([]);
    expect(await adicionarEndereco(db, subLogin, cheio)).toEqual({ ok: true });
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0].cliente_id).toBe("pai-1");
  });

  it("titular grava sob a propria ficha", async () => {
    const { db, inseridos } = bancoFalso([]);
    await adicionarEndereco(db, titular, cheio);
    expect(inseridos[0].cliente_id).toBe("titular-1");
  });

  it("endereco em branco nao chega ao banco", async () => {
    const { db, inseridos } = bancoFalso([]);
    const r = await adicionarEndereco(db, subLogin, { ...cheio, logradouro: " ", cidade: "", estado: "", cep: "" });
    expect(r).toEqual({ ok: false, motivo: "incompleto" });
    expect(inseridos).toHaveLength(0);
  });
});

describe("removerEndereco", () => {
  it("remocao filtrada pela RLS nao vira sucesso", async () => {
    const { db, store } = bancoFalso([{ id: "end-1", cliente_id: "pai-1" }], { podeDeletar: () => false });
    expect(await removerEndereco(db, "end-1")).toEqual({ ok: false, motivo: "nada" });
    expect(store.enderecos).toHaveLength(1);
  });

  it("remocao que saiu de fato responde ok", async () => {
    const { db, store } = bancoFalso([{ id: "end-1", cliente_id: "pai-1" }]);
    expect(await removerEndereco(db, "end-1")).toEqual({ ok: true });
    expect(store.enderecos).toHaveLength(0);
  });
});

// ESTRESSE — gente de verdade mexendo ao mesmo tempo. Leitura de codigo nao acha
// nada disto: as chamadas so se cruzam quando ha ida ao servidor no meio.
describe("estresse: enderecos sob concorrencia", () => {
  it("50 abas removendo o MESMO endereco: uma so pode dizer que removeu", async () => {
    const { db, store } = bancoFalso([{ id: "end-1", cliente_id: "pai-1" }]);
    const resultados = await Promise.all(Array.from({ length: 50 }, () => removerEndereco(db, "end-1")));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok && r.motivo === "nada")).toHaveLength(49);
    expect(store.enderecos).toHaveLength(0);
  });

  it("50 sub-logins gravando ao mesmo tempo: todos sob a ficha do PAI, nenhum em branco", async () => {
    const { db, store, inseridos } = bancoFalso([]);
    const resultados = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        adicionarEndereco(db, subLogin, i % 5 === 0
          ? { ...cheio, logradouro: "", cidade: "", estado: "", cep: "" } // 10 tentam salvar em branco
          : { ...cheio, numero: String(i) }),
      ),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(40);
    expect(inseridos).toHaveLength(40);
    expect(inseridos.every((l) => l.cliente_id === "pai-1")).toBe(true);
    expect(inseridos.some((l) => l.cliente_id === "sub-1")).toBe(false);
    expect(store.enderecos.every((l) => l.logradouro.trim() !== "")).toBe(true);
  });

  it("25 gravando e 25 removendo ao mesmo tempo nao se atrapalham", async () => {
    const { db, store } = bancoFalso([{ id: "end-1", cliente_id: "pai-1", logradouro: "Velho" }]);
    const trabalhos = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0
        ? adicionarEndereco(db, subLogin, { ...cheio, numero: String(i) })
        : removerEndereco(db, "end-1"),
    );
    const resultados = await Promise.all(trabalhos);
    expect(resultados.filter((r) => r.ok)).toHaveLength(26); // 25 gravacoes + 1 remocao real
    expect(store.enderecos).toHaveLength(25);
    expect(store.enderecos.every((l: any) => l.cliente_id === "pai-1")).toBe(true);
  });
});
