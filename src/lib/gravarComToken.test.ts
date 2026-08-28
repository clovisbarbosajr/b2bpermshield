import { describe, it, expect } from "vitest";
import { gravarComToken } from "./gravarComToken";

// ESTE TESTE EXISTE POR CAUSA DE UMA MUTACAO QUE PASSOU.
//
// Com o bloqueio escrito direto no `handleSave`, apagar o `.eq("admin_rev", rev)`
// deixava a suite inteira verde — 120 testes passando com a guarda REMOVIDA. Uma
// protecao contra perda silenciosa que some em silencio nao protege nada.
//
// Por isso os testes abaixo afirmam a FIACAO, e nao so o desfecho: qual filtro foi
// para a query e o que foi para o payload. Apagar o `.eq` ou o incremento faz
// reprovar.
//
// O cliente falso segue o molde de `fetchAllRows.test.ts`: sem framework novo, sem
// mock de rede — so um objeto que registra a cadeia de chamadas do postgrest-js.

type Resposta = { data: any; error: any; status: number };

function clienteFalso(resposta: Resposta) {
  const registro = {
    tabela: "",
    payload: null as any,
    filtros: [] as Array<[string, unknown]>,
    selecionou: "",
  };
  const cadeia: any = {
    update(p: any) { registro.payload = p; return cadeia; },
    eq(coluna: string, valor: unknown) { registro.filtros.push([coluna, valor]); return cadeia; },
    select(cols: string) { registro.selecionou = cols; return cadeia; },
    maybeSingle() { return Promise.resolve(resposta); },
  };
  return {
    registro,
    sb: { from(t: string) { registro.tabela = t; return cadeia; } },
  };
}

const OK: Resposta = { data: { admin_rev: 8 }, error: null, status: 200 };

describe("gravarComToken", () => {
  // ── A FIACAO. Sao estes que morrem se o bloqueio for removido. ──────────────

  it("filtra por id E por admin_rev — sem os dois nao ha bloqueio", async () => {
    const { sb, registro } = clienteFalso(OK);
    await gravarComToken(sb, "produtos", "prod-1", { nome: "x" }, 7);
    expect(registro.tabela).toBe("produtos");
    expect(registro.filtros).toEqual([["id", "prod-1"], ["admin_rev", 7]]);
  });

  // A tabela e parametro: as telas de produto e de cliente usam a MESMA funcao.
  // Se alguem voltar a fixar "produtos" aqui dentro, o save de cliente passaria a
  // gravar em produtos — e este teste acende.
  it("grava na tabela que recebeu, nao numa fixa", async () => {
    const { sb, registro } = clienteFalso(OK);
    await gravarComToken(sb, "clientes", "cli-1", { nome: "x" }, 3);
    expect(registro.tabela).toBe("clientes");
    expect(registro.filtros).toEqual([["id", "cli-1"], ["admin_rev", 3]]);
    expect(registro.payload).toEqual({ nome: "x", admin_rev: 4 });
  });

  it("incrementa o token no MESMO statement, e preserva o payload", async () => {
    const { sb, registro } = clienteFalso(OK);
    await gravarComToken(sb, "produtos", "prod-1", { nome: "x", preco: 10 }, 7);
    expect(registro.payload).toEqual({ nome: "x", preco: 10, admin_rev: 8 });
  });

  it("le o token de volta, senao o proximo save da mesma tela ja nasce defasado", async () => {
    const { sb, registro } = clienteFalso(OK);
    await gravarComToken(sb, "produtos", "prod-1", {}, 7);
    expect(registro.selecionou).toBe("admin_rev");
  });

  // ── OS QUATRO DESFECHOS ────────────────────────────────────────────────────

  it("gravou => ok, com o token novo vindo do banco", async () => {
    const { sb } = clienteFalso(OK);
    expect(await gravarComToken(sb, "produtos", "p", {}, 7)).toEqual({ tipo: "ok", rev: 8 });
  });

  it("banco nao devolveu o token => cai no rev + 1 calculado, nunca em undefined", async () => {
    const { sb } = clienteFalso({ data: {}, error: null, status: 200 });
    expect(await gravarComToken(sb, "produtos", "p", {}, 7)).toEqual({ tipo: "ok", rev: 8 });
  });

  it("zero linhas => conflito (alguem gravou no meio)", async () => {
    const { sb } = clienteFalso({ data: null, error: null, status: 200 });
    expect(await gravarComToken(sb, "produtos", "p", {}, 7)).toEqual({ tipo: "conflito" });
  });

  it("erro COM code => recusado: abortou, o token da tela continua valendo", async () => {
    const { sb } = clienteFalso({ data: null, error: { code: "22003", message: "out of range" }, status: 400 });
    expect(await gravarComToken(sb, "produtos", "p", {}, 7))
      .toEqual({ tipo: "recusado", mensagem: "out of range" });
  });

  it("erro de concorrencia (5xx COM code) tambem e recusado, nao incerto", async () => {
    const { sb } = clienteFalso({ data: null, error: { code: "40001", message: "serialization failure" }, status: 500 });
    expect((await gravarComToken(sb, "produtos", "p", {}, 7)).tipo).toBe("recusado");
  });

  it("falha de transporte (status 0, code vazio) => incerto", async () => {
    const { sb } = clienteFalso({ data: null, error: { code: "", message: "FetchError" }, status: 0 });
    expect(await gravarComToken(sb, "produtos", "p", {}, 7))
      .toEqual({ tipo: "incerto", mensagem: "FetchError" });
  });

  it("5xx de gateway SEM code => incerto, pode ter commitado", async () => {
    const { sb } = clienteFalso({ data: null, error: { message: "<html>502</html>" }, status: 502 });
    expect((await gravarComToken(sb, "produtos", "p", {}, 7)).tipo).toBe("incerto");
  });

  // ── O CASO QUE NAO PODE SER CONFUNDIDO ─────────────────────────────────────
  // `conflito` e `recusado` pedem acoes opostas do admin: um manda recarregar
  // (o dado mudou embaixo dele), o outro manda corrigir o campo e salvar de novo.
  // Trocar os dois foi erro real numa das revisoes.
  it("conflito e recusado sao desfechos distintos", async () => {
    const semLinha = clienteFalso({ data: null, error: null, status: 200 });
    const comErro = clienteFalso({ data: null, error: { code: "22003", message: "x" }, status: 400 });
    const a = await gravarComToken(semLinha.sb, "produtos", "p", {}, 7);
    const b = await gravarComToken(comErro.sb, "produtos", "p", {}, 7);
    expect(a.tipo).not.toBe(b.tipo);
  });
});
