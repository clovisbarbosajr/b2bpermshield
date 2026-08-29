import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";

// TESTE DE ESTRESSE, nao de leitura. A tela de entrada de producao e a de status
// sao usadas AO MESMO TEMPO pela mesma equipe: enquanto o Status pagina
// `producao_pedidos`, alguem esta salvando entradas novas. Cada `.range()` e um
// request separado — entre a pagina 1 e a 2 o mundo muda, e `.range()` vira
// LIMIT/OFFSET, que conta POSICOES, nao linhas.
//
// A tabela falsa reproduz o servidor: reordena o estado a CADA request, como o
// Postgres reexecutando a query, em vez de servir uma fatia congelada. Toda
// perturbacao mexe no ESTADO, nunca no payload ja servido — uma versao anterior
// deste arquivo filtrava o payload e por isso o caso de delecao era um no-op que
// passava por construcao.

type Linha = { id: string; created_at: string };
const T0 = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

function servidorFalso(iniciais: number, ordem: "asc" | "desc") {
  const estado: Linha[] = Array.from({ length: iniciais }, (_, i) => ({
    id: `p-${String(i).padStart(6, "0")}`,
    created_at: iso(T0 + i * 1000),
  }));
  let seq = iniciais;

  // Insercao normal: `created_at` maior que tudo que existe.
  const inserir = () => {
    estado.push({ id: `novo-${String(seq).padStart(6, "0")}`, created_at: iso(T0 + seq * 1000) });
    seq++;
  };

  // Insercao RETROATIVA — e ela nao e hipotese de laboratorio.
  // `producao_pedidos.created_at` e `DEFAULT now()`, e `now()` no Postgres e o
  // horario de INICIO DA TRANSACAO, nao o do commit. Duas transacoes sobrepostas
  // (dois operadores salvando no `ProducaoEntrada`) podem comitar fora da ordem
  // de `now()`: a leitura ve primeiro a linha de `created_at` maior, e a de
  // `created_at` menor aparece depois — no MEIO da ordenacao ASC. Ali ela empurra
  // tudo adiante uma casa, exatamente como o DESC faz com toda insercao.
  const inserirRetroativo = (atrasoMs: number) => {
    estado.push({ id: `atras-${String(seq).padStart(6, "0")}`, created_at: iso(T0 + seq * 1000 - atrasoMs) });
    seq++;
  };

  // Delecao mexe no ESTADO: e o que faz os offsets andarem para tras.
  const remover = (n: number) => {
    const ordenado = [...estado].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const l of ordenado.slice(0, n)) {
      const i = estado.findIndex((x) => x.id === l.id);
      if (i >= 0) estado.splice(i, 1);
    }
  };

  const servir = (from: number, to: number) => {
    const ordenado = [...estado].sort((a, b) => {
      const c = a.created_at.localeCompare(b.created_at);
      const dir = ordem === "asc" ? c : -c;
      return dir !== 0 ? dir : a.id.localeCompare(b.id);   // desempate por id
    });
    return Promise.resolve({ data: ordenado.slice(from, to + 1), error: null });
  };

  return { servir, inserir, inserirRetroativo, remover, get tamanho() { return estado.length; } };
}

const INICIAIS = 2_400;   // 3 paginas de 1.000
const CHUNK = 1_000;

// Roda a leitura completa perturbando o servidor ENTRE as paginas.
async function lerCom(
  s: ReturnType<typeof servidorFalso>,
  perturbar: (pagina: number) => void,
) {
  let pagina = 0;
  return await fetchAllRows<Linha>((f, t) => {
    if (pagina > 0) perturbar(pagina);
    pagina++;
    return s.servir(f, t);
  }, { chunk: CHUNK });
}

const repetidos = (out: Linha[]) => out.length - new Set(out.map((r) => r.id)).size;

// As paginas como o SERVIDOR as entregou, antes do dedupe do `fetchAllRows`. E
// aqui que se mede se a ordenacao evita a repeticao; medir depois do dedupe
// esconderia a diferenca entre ASC e DESC, que e justamente o que se quer provar.
async function paginasCruas(
  s: ReturnType<typeof servidorFalso>,
  perturbar: (pagina: number) => void,
) {
  const paginas: Linha[][] = [];
  let pagina = 0;
  await fetchAllRows<Linha>(async (f, t) => {
    if (pagina > 0) perturbar(pagina);
    pagina++;
    const r = await s.servir(f, t);
    paginas.push(r.data as Linha[]);
    return r;
  }, { chunk: CHUNK });
  return paginas.flat();
}

const repetidosCru = (cru: Linha[]) => cru.length - new Set(cru.map((r) => r.id)).size;

describe("Producao: paginacao sob escrita concorrente", () => {
  // CANARIO, medido nas PAGINAS CRUAS. O `fetchAllRows` deduplica, entao olhar o
  // resultado dele aqui passaria ate com o cenario quebrado — e o teste deixaria
  // de provar que DESC e mesmo pior. O que se afirma e sobre o SERVIDOR: com
  // DESC, ele serve a mesma linha duas vezes.
  it("DESC faz o servidor repetir linha — e por isso a tela nao usa DESC", async () => {
    const s = servidorFalso(INICIAIS, "desc");
    const cru = await paginasCruas(s, () => { for (let i = 0; i < 50; i++) s.inserir(); });
    expect(repetidosCru(cru), "o cenario parou de reproduzir o problema").toBeGreaterThan(0);
  });

  it("ASC nao faz o servidor repetir com insercao normal", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    const cru = await paginasCruas(s, () => { for (let i = 0; i < 50; i++) s.inserir(); });
    expect(repetidosCru(cru),
      "e esta e a diferenca entre ASC e DESC, medida e nao suposta").toBe(0);
  });

  it("ASC nao duplica com 50 insercoes entre paginas", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    const out = await lerCom(s, () => { for (let i = 0; i < 50; i++) s.inserir(); });
    expect(repetidos(out), "linha repetida vira key duplicada e contagem errada").toBe(0);
    expect(out.filter((r) => r.id.startsWith("p-")), "sumiu linha que ja existia").toHaveLength(INICIAIS);
  });

  it("ASC aguenta insercao a cada pagina, em volume alto", async () => {
    const s = servidorFalso(9_000, "asc");
    const out = await lerCom(s, () => { for (let i = 0; i < 200; i++) s.inserir(); });
    expect(repetidos(out)).toBe(0);
    expect(out.filter((r) => r.id.startsWith("p-"))).toHaveLength(9_000);
  });

  // O LIMITE DA DEFESA, medido em vez de suposto. `created_at ASC` protege contra
  // a insercao normal, NAO contra a retroativa: `now()` congela no inicio da
  // transacao, entao duas gravacoes sobrepostas podem entrar fora de ordem. Fica
  // registrado que existe, e por isso a defesa de verdade e o dedupe do
  // `fetchAllRows` — a paginacao ASC so reduz a frequencia.
  it("ASC SOZINHO nao cobre insercao retroativa (por isso ha dedupe)", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    const cru = await paginasCruas(s, () => { for (let i = 0; i < 50; i++) s.inserirRetroativo(3_000_000); });
    expect(repetidosCru(cru),
      "se isto zerar, a ressalva do comentario acima virou obsoleta").toBeGreaterThan(0);
  });

  it("com o dedupe do fetchAllRows, nem a retroativa duplica", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    const out = await lerCom(s, () => { for (let i = 0; i < 50; i++) s.inserirRetroativo(3_000_000); });
    expect(repetidos(out)).toBe(0);
  });

  // DELECAO concorrente encurta o inicio e puxa tudo para tras: o risco e PULAR,
  // nunca repetir. Vale registrar qual dos dois erros e possivel — uma linha a
  // menos na tela se resolve com F5; duplicata quebra a contagem.
  it("delecao concorrente pode fazer pular, e nunca duplicar", async () => {
    const s = servidorFalso(INICIAIS, "asc");
    const out = await lerCom(s, () => s.remover(5));
    expect(repetidos(out), "delecao nao pode produzir duplicata").toBe(0);
    // E o pulo acontece de fato — sem isto o teste nao exercita nada.
    //
    // Comparar `out.length` com o total do servidor NAO serve: as linhas apagadas
    // depois de lidas continuam em `out` e compensam, na conta, as que ficaram de
    // fora. Uma versao anterior fazia isso e a igualdade acidental (2390 = 2390)
    // dava a impressao de que nada tinha sido pulado. Entao pergunta-se pelo id.
    const lidos = new Set(out.map((r) => r.id));
    expect(lidos.has("p-001000"), "a linha da fronteira tinha que ter sido pulada").toBe(false);
  });
});
