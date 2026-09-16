/**
 * `lerContaDaEmpresa`: leitura direta (staff/"View as") e, quando a RLS devolve
 * `null` sem erro (sub-login), a RPC `minha_conta`. Nunca `null` calado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Res = { data: unknown; error: { message: string } | null };
let direta: Res;
let rpc: Res;
let rpcChamadas = 0;

vi.mock("@/integrations/supabase/client", () => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => direta };
  return {
    supabase: {
      from: () => q,
      rpc: (nome: string) => {
        rpcChamadas++;
        if (nome !== "minha_conta") throw new Error(`rpc inesperada: ${nome}`);
        return { maybeSingle: async () => rpc };
      },
    },
  };
});

const { lerContaDaEmpresa } = await import("./contaDaEmpresa");

const linha = (id: string) => ({
  id, tabela_preco_id: "tab-A", endereco: "Rua 1", endereco2: null, cidade: "Miami", estado: "FL", cep: "33101",
});

beforeEach(() => {
  direta = { data: null, error: null };
  rpc = { data: null, error: null };
  rpcChamadas = 0;
});

describe("lerContaDaEmpresa", () => {
  it("leitura direta devolve a linha: RPC nao e chamada", async () => {
    direta = { data: linha("cli-0"), error: null };
    await expect(lerContaDaEmpresa("cli-0")).resolves.toEqual(linha("cli-0"));
    expect(rpcChamadas).toBe(0);
  });

  it("RLS esconde (null sem erro): cai na RPC e devolve a conta", async () => {
    rpc = { data: linha("cli-0"), error: null };
    await expect(lerContaDaEmpresa("cli-0")).resolves.toEqual(linha("cli-0"));
    expect(rpcChamadas).toBe(1);
  });

  it("RPC devolve OUTRA conta: lanca", async () => {
    rpc = { data: linha("cli-9"), error: null };
    await expect(lerContaDaEmpresa("cli-0")).rejects.toThrow(/company account/);
  });

  it("RPC com erro: lanca", async () => {
    rpc = { data: null, error: { message: "function minha_conta does not exist" } };
    await expect(lerContaDaEmpresa("cli-0")).rejects.toThrow(/minha_conta/);
  });

  it("leitura direta com erro: lanca, sem tentar a RPC", async () => {
    direta = { data: null, error: { message: "boom" } };
    rpc = { data: linha("cli-0"), error: null };
    await expect(lerContaDaEmpresa("cli-0")).rejects.toThrow(/boom/);
    expect(rpcChamadas).toBe(0);
  });

  it("as duas vazias: lanca", async () => {
    await expect(lerContaDaEmpresa("cli-0")).rejects.toThrow(/company account/);
  });
});
