import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";
// Mesmo motivo declarado em `estoqueUpdateCondicional.test.ts`: `tsconfig.app.json`
// nao inclui os tipos do Node, mas em execucao (vitest) o modulo existe.
// @ts-expect-error
import { readFileSync } from "node:fs";

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8") as string;

// ---------------------------------------------------------------------------
// 1) COMPORTAMENTO: duplicar uma price list precisa paginar.
//
// `tabela_preco_itens` cresce com produtos x reguas (1974 linhas hoje) e o
// PostgREST corta em 1000 SEM erro. A leitura unica copiava as primeiras 1000 e a
// tela ainda dizia "1000 price(s) copied": a regua nova nascia sem os precos que
// sobraram, e esses produtos passavam a vender pelo preco base, mais caro.
// ---------------------------------------------------------------------------
const CAP = 1000; // db-max-rows do PostgREST no Supabase

const itensDaRegua = Array.from({ length: 1974 }, (_, i) => ({ produto_id: `p${i}`, preco: i + 1 }));

// Fake do PostgREST: no maximo CAP linhas por request, e `error: null` mesmo
// quando cortou — e esse silencio que engana.
const leitura = (from: number, to: number) =>
  Promise.resolve({ data: itensDaRegua.slice(from, Math.min(to + 1, from + CAP)), error: null });

describe("duplicar price list: leitura dos itens", () => {
  it("uma leitura so perde os precos depois da milesima linha, sem erro", async () => {
    const { data, error } = await leitura(0, CAP - 1);
    expect(error).toBeNull();
    expect(data.length).toBe(CAP);
    expect(data.some((r) => r.produto_id === "p1973")).toBe(false); // ficaria sem preco custom
  });

  it("fetchAllRows copia todos os itens da regua", async () => {
    const todos = await fetchAllRows<{ produto_id: string }>((from, to) => leitura(from, to));
    expect(todos.length).toBe(itensDaRegua.length);
    expect(todos.some((r) => r.produto_id === "p1973")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2) FIACAO: as guardas moram DENTRO de componentes de pagina (importar arrastaria
// layout, router, auth e o cliente Supabase), entao o que da pra afirmar sem montar
// a tela e a forma da query e a existencia da guarda — que e exatamente o que uma
// mutacao descuidada apaga.
// ---------------------------------------------------------------------------
/** Todo trecho que comeca em `from("<tabela>")` e faz `.select(`. */
const leiturasDe = (fonte: string, tabela: string) => {
  const marca = `from("${tabela}")`;
  const trechos: string[] = [];
  for (let i = fonte.indexOf(marca); i !== -1; i = fonte.indexOf(marca, i + 1)) {
    // A JANELA PARA NA PROXIMA QUERY, e nao num tamanho fixo.
    //
    // GUARDA, NAO CONSERTO. Medi as cinco leituras vigiadas hoje: nenhuma era
    // mascarada pela janela de 320 chars seca — a folga vai de 155 a 201
    // caracteres em todas. Cheguei a escrever aqui que o `openItems` do
    // `TabelasPreco` era mascarado; nao era, e a medicao me desmentiu.
    //
    // Fica porque essa folga e acidente de formatacao, nao projeto: uma query que
    // cresca algumas linhas basta para a janela alcancar o `.range(from, to)` da
    // SEGUINTE, e ai este arquivo passaria a aprovar leitura sem paginacao
    // nenhuma. Cortar na proxima `supabase.from(` tira isso do acaso.
    const proximo = fonte.indexOf("supabase.from(", i + 1);
    const fim = proximo === -1 ? i + 320 : Math.min(i + 320, proximo);
    const trecho = fonte.slice(i, fim);
    if (trecho.includes(".select(")) trechos.push(trecho);
  }
  return trechos;
};

describe("telas de catalogo/config: leitura de tabela que cresce sem limite", () => {
  for (const [arquivo, tabelas] of [
    // `produtos` cresce com o catalogo; `tabela_preco_itens` com produtos x reguas;
    // `clientes` com cada cadastro novo. Nenhuma e tabela de configuracao.
    ["./TabelasPreco.tsx", ["produtos", "tabela_preco_itens"]],
    ["./Categorias.tsx", ["produtos", "clientes"]],
  ] as [string, string[]][]) {
    const fonte = ler(arquivo);
    for (const tabela of tabelas) {
      it(`${arquivo}: le "${tabela}" paginando`, () => {
        const trechos = leiturasDe(fonte, tabela);
        expect(trechos.length, `nenhuma leitura de ${tabela} encontrada`).toBeGreaterThan(0);
        // CONTAGEM (`head: true`) NAO PRECISA PAGINAR: ela nao devolve linha
        // nenhuma, so o total no cabecalho `Content-Range` — o corte de 1000 do
        // PostgREST nao se aplica. Exigir `.range` ali reprovaria a contagem de
        // cascata que `Categorias.handleDelete` faz antes de perguntar.
        const queLeemLinhas = trechos.filter((t) => !/head:\s*true/.test(t));
        expect(queLeemLinhas.length, `nenhuma leitura de linhas de ${tabela}`).toBeGreaterThan(0);
        for (const t of queLeemLinhas) expect(t, t).toContain(".range(from, to)");
      });
    }
  }
});

describe("Categorias: acesso (privacidade) falha fechado", () => {
  const fonte = ler("./Categorias.tsx");

  it("nao salva enquanto o snapshot de acesso nao tiver sido lido", () => {
    // Este e o assert que morre se a guarda for removida: sem ela, `saveAccess`
    // (DELETE + INSERT) apaga grupos e clientes que a tela nunca leu, e o usuario
    // ve "Category updated".
    expect(fonte).toMatch(/if \(editing && !acc\.loaded\)/);
  });

  it("openEdit so marca `loaded` depois de conferir o erro das duas leituras", () => {
    expect(fonte).toMatch(/loaded: false/);
    expect(fonte).toMatch(/if \(caErr \|\| ccaErr\)/);
    expect(fonte).toMatch(/loaded: true/);
  });

  it("descarta a leitura de acesso de uma categoria que ja nao esta aberta", () => {
    // Abrir B (ou "New") enquanto a leitura de A volta: sem esta marca o snapshot
    // de A caia em cima de B e o Save gravava o acesso de A na categoria B.
    expect(fonte).toMatch(/acessoReq\.current = c\.id/);
    expect(fonte).toMatch(/if \(acessoReq\.current !== c\.id\) return/);
    expect(fonte).toMatch(/acessoReq\.current = null/);
  });

  it("saveAccess devolve o erro e handleSave o mostra em vez de dizer 'updated'", () => {
    expect(fonte).toMatch(/saveAccess = async \(categoriaId: string\): Promise<string \| null>/);
    expect(fonte).toMatch(/const accErr = categoriaId \? await saveAccess\(categoriaId\) : null/);
    expect(fonte).toMatch(/if \(accErr\)/);
  });
});

describe("Options: valores de uma opcao", () => {
  const fonte = ler("./Options.tsx");

  it("nao abre o editor quando a leitura dos valores falha", () => {
    // Mostrar "No values yet" para uma opcao que TEM valores fazia o admin
    // recadastrar tudo por cima.
    expect(fonte).toMatch(/Could not load this option's values/);
  });

  it("para na primeira gravacao de valor que falhar", () => {
    expect(fonte).toMatch(/was not saved \(the first \$\{i\} were\)/);
  });
});
