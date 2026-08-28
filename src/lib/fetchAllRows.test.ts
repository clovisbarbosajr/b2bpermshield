import { describe, it, expect, vi } from "vitest";
import { fetchAllRows } from "./fetchAllRows";

// A paginacao adicionada no `ProductEdit` (clientes, produtos, precos por cliente,
// acesso por cliente, grupos de privacidade) depende INTEIRA deste modulo. Se ele
// pular ou repetir linha, o save — que apaga e reescreve a partir do que leu —
// grava o resultado errado sem erro nenhum.
//
// O teste usa uma tabela falsa em memoria para poder simular o que nao da para
// simular contra o banco: escrita concorrente ACONTECENDO no meio da leitura.

/** Tabela falsa: paginacao por OFFSET/LIMIT sobre uma lista ordenada, igual ao
 *  `.range()` do PostgREST. `onPage` roda ANTES de servir cada pagina — e por ali
 *  que o teste injeta a escrita concorrente. */
function tabelaFalsa(
  linhas: { id: string }[],
  opts: { onPage?: (pagina: number) => void; erroNaPagina?: number } = {},
) {
  const estado = [...linhas];
  let pagina = 0;
  const servir = (from: number, to: number) => {
    if (opts.erroNaPagina === pagina) {
      pagina++;
      return Promise.resolve({ data: null, error: { message: "falha de rede" } });
    }
    opts.onPage?.(pagina);
    pagina++;
    // O PostgREST ordena no servidor; a ordem estavel e responsabilidade de quem
    // chama (`.order("id")`). Reproduzimos isso ordenando a cada request.
    const ordenado = [...estado].sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({ data: ordenado.slice(from, to + 1), error: null });
  };
  return {
    servir,
    inserir: (linha: { id: string }) => estado.push(linha),
    remover: (id: string) => {
      const i = estado.findIndex((l) => l.id === id);
      if (i >= 0) estado.splice(i, 1);
    },
    get tamanho() { return estado.length; },
  };
}

const linhas = (n: number, prefixo = "id") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefixo}-${String(i).padStart(6, "0")}` }));

describe("fetchAllRows", () => {
  it("le tudo quando cabe numa pagina", async () => {
    const t = tabelaFalsa(linhas(7));
    expect(await fetchAllRows(t.servir, { chunk: 1000 })).toHaveLength(7);
  });

  it("le tudo em varias paginas, sem pular nem repetir", async () => {
    const t = tabelaFalsa(linhas(2500));
    const out = await fetchAllRows<{ id: string }>(t.servir, { chunk: 1000 });
    expect(out).toHaveLength(2500);
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
  });

  // O caso que mais engana: total EXATAMENTE multiplo do chunk. A ultima pagina
  // cheia nao encerra o laco — quem encerra e a pagina vazia seguinte. Se o
  // `if (page.length < chunk)` virasse `<=`, este teste quebraria e o de 2500 nao.
  it("total multiplo exato do chunk le tudo e para", async () => {
    const t = tabelaFalsa(linhas(2000));
    const out = await fetchAllRows<{ id: string }>(t.servir, { chunk: 1000 });
    expect(out).toHaveLength(2000);
    expect(new Set(out.map((r) => r.id)).size).toBe(2000);
  });

  it("tabela vazia devolve lista vazia", async () => {
    const t = tabelaFalsa([]);
    expect(await fetchAllRows(t.servir, { chunk: 1000 })).toEqual([]);
  });

  // FAIL-CLOSED. Erro no meio TEM que virar excecao: se virasse lista parcial, o
  // save apagaria o que nao foi lido. O `tudo()` do ProductEdit converte esta
  // excecao em `{ error }`, que e o que a trava de carregamento le.
  it("erro em pagina do meio lanca, nao devolve parcial", async () => {
    const t = tabelaFalsa(linhas(2500), { erroNaPagina: 1 });
    await expect(fetchAllRows(t.servir, { chunk: 1000 })).rejects.toThrow("falha de rede");
  });

  it("erro na primeira pagina lanca", async () => {
    const t = tabelaFalsa(linhas(10), { erroNaPagina: 0 });
    await expect(fetchAllRows(t.servir, { chunk: 1000 })).rejects.toThrow("falha de rede");
  });

  it("para no teto de maxRows sem laco infinito", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Tabela sempre maior que o teto: toda pagina volta cheia.
    const servir = (from: number, to: number) =>
      Promise.resolve({ data: linhas(to - from + 1, `p${from}`), error: null });
    const out = await fetchAllRows(servir, { chunk: 100, maxRows: 500 });
    expect(out).toHaveLength(500);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  // ── ESTRESSE: escrita concorrente durante a leitura ────────────────────────
  //
  // Isto e o que leitura de codigo nao acha e o banco nao deixa reproduzir de
  // proposito. `.range()` vira LIMIT/OFFSET, e cada pagina e um request separado:
  // escrita ANTES do offset atual desloca a janela inteira.
  //
  //   INSERE uma linha que ordena antes -> a janela anda para a direita, a ultima
  //   linha da pagina anterior e servida DE NOVO: duplicata (e a linha nova, que
  //   entrou depois do ponto ja lido, nunca aparece);
  //   REMOVE uma linha que ordena antes -> a janela anda para a esquerda e uma
  //   linha e PULADA — some do resultado sem que nada acuse.
  //
  // Eu escrevi estes dois testes com os efeitos TROCADOS e o teste me corrigiu.
  // E o motivo de eles existirem: fixar o limite real, nao o que eu achava.
  //
  // Nao dizem que o modulo esta errado — dizem ate onde a garantia vai. Se alguem
  // trocar OFFSET por cursor (keyset), os dois passam a nao perder nada e vao
  // falhar, avisando que a garantia mudou.

  it("insercao concorrente antes do offset REPETE uma linha", async () => {
    const tt = tabelaFalsa(linhas(2000), {
      // Ao servir a pagina 1 (offset 1000), entra uma linha que ordena no comeco.
      onPage: (p) => { if (p === 1) tt.inserir({ id: "aaa-nova" }); },
    });
    const out = await fetchAllRows<{ id: string }>(tt.servir, { chunk: 1000 });
    const unicos = new Set(out.map((r) => r.id));
    // A duplicata e o efeito: mais linhas devolvidas do que ids distintos.
    expect(out.length).toBeGreaterThan(unicos.size);
    // E a linha recem-inserida nao foi lida — entrou atras do ponto ja percorrido.
    expect(unicos.has("aaa-nova")).toBe(false);
  });

  it("remocao concorrente antes do offset PULA uma linha", async () => {
    const tt = tabelaFalsa(linhas(2000), {
      onPage: (p) => { if (p === 1) tt.remover("id-000000"); },
    });
    const out = await fetchAllRows<{ id: string }>(tt.servir, { chunk: 1000 });
    const unicos = new Set(out.map((r) => r.id));
    // Sem duplicata aqui — o estrago e o oposto, silencioso: `id-001000` continua
    // na tabela e nao esta no resultado.
    expect(out.length).toBe(unicos.size);
    expect(unicos.has("id-001000")).toBe(false);
    // A linha apagada, por outro lado, veio — foi lida antes de sumir.
    expect(unicos.has("id-000000")).toBe(true);
  });

  // Sem escrita concorrente, muitas paginas seguidas tem que sair exatas — e o
  // caso real do `produtos` (passa de 1000 hoje) e do `clientes`.
  it("50 paginas cheias saem completas e sem duplicata", async () => {
    const t = tabelaFalsa(linhas(50_000));
    const out = await fetchAllRows<{ id: string }>(t.servir, { chunk: 1000 });
    expect(out).toHaveLength(50_000);
    expect(new Set(out.map((r) => r.id)).size).toBe(50_000);
  });
});
