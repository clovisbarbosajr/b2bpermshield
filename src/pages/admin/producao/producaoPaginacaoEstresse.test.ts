import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";

// TESTE DE ESTRESSE, nao de leitura. A tela de Producao (Status) e a de entrada
// sao usadas AO MESMO TEMPO pela mesma equipe: enquanto o Status pagina
// `producao_pedidos`, alguem esta salvando entradas novas. Cada `.range()` e um
// request separado — entre a pagina 1 e a 2 o mundo muda.
//
// O QUE ISTO PROVA, e leitura de codigo nao provaria:
//   * com `created_at DESC` (o que a tela usava), cada insercao nova ocupa a
//     posicao 0 e empurra tudo uma casa para baixo: a linha do offset 999
//     reaparece no 1000 e entra DUAS vezes em `rows` — key duplicada no React,
//     linha repetida na tabela, contagem errada no "Received log";
//   * com `created_at ASC`, a linha nova entra no FIM e nao mexe no que ja foi
//     lido. Nenhuma duplicata, e o unico efeito e nao ver algumas das entradas
//     criadas durante a propria leitura — que e o correto para um snapshot.
//
// A tabela falsa abaixo reproduz o servidor: ordena a CADA request, como o
// Postgres faz, em vez de servir uma fatia congelada.

type Linha = { id: string; created_at: string };

function servidorFalso(iniciais: number, ordem: "asc" | "desc") {
  // `created_at` crescente e `id` casado com ele: e o estado real de uma tabela
  // que so recebe insercao.
  const estado: Linha[] = Array.from({ length: iniciais }, (_, i) => ({
    id: `p-${String(i).padStart(6, "0")}`,
    created_at: new Date(1_800_000_000_000 + i * 1000).toISOString(),
  }));
  let seq = iniciais;
  const inserir = () => {
    estado.push({
      id: `novo-${String(seq).padStart(6, "0")}`,
      created_at: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
    });
    seq++;
  };
  const servir = (from: number, to: number) => {
    const ordenado = [...estado].sort((a, b) => {
      const c = a.created_at.localeCompare(b.created_at);
      const dir = ordem === "asc" ? c : -c;
      return dir !== 0 ? dir : a.id.localeCompare(b.id);   // desempate por id
    });
    return Promise.resolve({ data: ordenado.slice(from, to + 1), error: null });
  };
  return { servir, inserir };
}

// 2.400 linhas com chunk 1.000 = 3 paginas. A equipe salva entradas entre elas.
const INICIAIS = 2_400;
const CHUNK = 1_000;

describe("Producao: paginacao sob insercao concorrente", () => {
  it("DESC duplica linha — e por isso a tela nao usa DESC", async () => {
    const s = servidorFalso(INICIAIS, "desc");
    let paginas = 0;
    const out = await fetchAllRows<Linha>((f, t) => {
      // 50 entradas salvas por outros operadores entre uma pagina e a seguinte.
      if (paginas++ > 0) for (let i = 0; i < 50; i++) s.inserir();
      return s.servir(f, t);
    }, { chunk: CHUNK });

    const vistos = new Set(out.map((r) => r.id));
    expect(out.length - vistos.size,
      "se isto der 0, o cenario do teste parou de reproduzir o problema e o teste " +
      "abaixo deixou de provar alguma coisa").toBeGreaterThan(0);
  });

  it("ASC nao duplica nenhuma linha, com 50 insercoes entre paginas", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    let paginas = 0;
    const out = await fetchAllRows<Linha>((f, t) => {
      if (paginas++ > 0) for (let i = 0; i < 50; i++) s.inserir();
      return s.servir(f, t);
    }, { chunk: CHUNK });

    const vistos = new Set(out.map((r) => r.id));
    expect(vistos.size, "linha repetida vira key duplicada no React e contagem errada")
      .toBe(out.length);
    // E nenhuma das 2.400 originais pode ter sumido: e o que a tela precisa.
    expect(out.filter((r) => r.id.startsWith("p-")), "sumiu linha que ja existia")
      .toHaveLength(INICIAIS);
  });

  it("ASC aguenta insercao a CADA pagina, em volume alto", async () => {
    const s = servidorFalso(9_000, "asc");
    let paginas = 0;
    const out = await fetchAllRows<Linha>((f, t) => {
      if (paginas++ > 0) for (let i = 0; i < 200; i++) s.inserir();
      return s.servir(f, t);
    }, { chunk: CHUNK });

    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
    expect(out.filter((r) => r.id.startsWith("p-"))).toHaveLength(9_000);
  });

  it("DELECAO concorrente nao duplica em ASC (so pode fazer pular)", async () => {
    // Remover uma linha ja lida encurta o inicio e puxa tudo para tras — o risco
    // e PULAR, nunca repetir. Vale registrar qual dos dois erros e possivel: uma
    // linha a menos na tela e recuperavel com F5; duplicata quebra a contagem.
    const s = servidorFalso(3_000, "asc");
    const removidos: string[] = [];
    let paginas = 0;
    const estadoRemover = (n: number) => { for (let i = 0; i < n; i++) removidos.push(`p-${String(i).padStart(6, "0")}`); };
    const out = await fetchAllRows<Linha>((f, t) => {
      if (paginas++ === 1) estadoRemover(5);
      return s.servir(f, t).then((r: any) => ({
        ...r,
        data: (r.data ?? []).filter((l: Linha) => !removidos.includes(l.id)),
      }));
    }, { chunk: CHUNK });

    expect(new Set(out.map((r) => r.id)).size, "delecao nao pode produzir duplicata")
      .toBe(out.length);
  });
});
