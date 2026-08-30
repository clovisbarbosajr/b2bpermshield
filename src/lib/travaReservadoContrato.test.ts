import { describe, it, expect } from "vitest";
import { travaDeReservadoSeAplica } from "./stock";

/**
 * O CONTRATO, e nao mais uma lista escrita a mao.
 *
 * `travaDeReservadoSeAplica` isenta os mesmos status que o gatilho
 * `fn_reserve_stock_on_order_item` isenta. O gatilho decide assim
 * (`20260825320000_estoque_por_variante.sql:114-116`):
 *
 *   lower(coalesce(_status,'')) NOT LIKE '%pre%venda%'
 *   AND ...                     NOT LIKE '%pre%order%'
 *   AND ...                     NOT LIKE '%encomenda%'
 *
 * A tela traduz isso para uma regex. Enquanto a prova era uma LISTA de exemplos,
 * cada rodada de revisao achou mais um buraco nela — quatro seguidas, sempre a
 * mesma classe: uma dimensao do `%` que ninguem tinha escrito.
 *
 *   rodada 7  — a lista so fixava o limite INFERIOR (regex frouxa passava)
 *   rodada 8  — so tinha casos que casam no COMECO (ancora `^` passava)
 *   rodada 9  — so tinha casos que terminam na palavra (ancora `$` passava)
 *   rodada 10 — o gap nunca tinha LETRA (`/pre[\s_-]*venda/` passava)
 *
 * Enumerar exemplo e perder essa corrida por definicao. Este arquivo implementa o
 * `LIKE` do Postgres como REFERENCIA e compara as duas sobre um corpus gerado.
 * Qualquer regex que divirja do gatilho falha aqui, venha a divergencia de onde
 * vier — inclusive de uma dimensao que ninguem pensou.
 *
 * A lista de exemplos continua em `travaReservado.test.ts`: ela documenta os casos
 * que motivaram cada rodada, e e o que se le para entender. Quem PROTEGE e este.
 */

/**
 * `LIKE` do Postgres, so o que os tres padroes usam: `%` (qualquer sequencia,
 * inclusive vazia) e literal. Sem `_`, sem escape — nenhum dos tres tem.
 *
 * Implementado por avanco guloso, que e correto para padroes do formato
 * `%a%b%`: casar `a` o mais cedo possivel nunca impede um `b` posterior.
 */
function casaLike(texto: string, literais: string[]): boolean {
  let i = 0;
  for (const lit of literais) {
    const achou = texto.indexOf(lit, i);
    if (achou === -1) return false;
    i = achou + lit.length;
  }
  return true;
}

/** O `_enforce` do gatilho: isento quando QUALQUER um dos tres casa. */
function bancoIsenta(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return casaLike(s, ["pre", "venda"])
      || casaLike(s, ["pre", "order"])
      || casaLike(s, ["encomenda"]);
}

/** O que a tela decide, com quantidade CAINDO num produto sem backorder. */
function telaIsenta(status: string | null | undefined): boolean {
  return !travaDeReservadoSeAplica({
    estoqueAtual: 10, estoqueNovo: 5, permitirBackorder: false, statusProduto: status,
  });
}

// Fragmentos escolhidos para cobrir as dimensoes que cada rodada revelou, e as
// que ninguem revelou ainda: gap vazio, separador, letra, digito, quebra de linha,
// acento, e as proprias palavras-chave partidas ou repetidas.
const PEDACOS = [
  "", "pre", "venda", "order", "encomenda", "vend", "pr", "e",
  // TRUNCADAS de proposito: sao elas que pegam a regex com uma letra a menos
  // (`/encomend/`, `/orde/`). Sem elas, `"encomendo"` — que o banco NAO isenta —
  // era isentado pelo mutante e ninguem reclamava.
  "encomend", "orde",
  "-", "_", " ", "  ", "\n", "\t", "2026", "lote", "co", "premium", "sob",
  "pré", "ç", ".", "/",
];

function* corpus(): Generator<string> {
  // Todas as trincas de fragmentos — `PEDACOS.length ** 3` strings, cobrindo
  // prefixo, gap e sufixo de uma vez. Sem numero escrito a mao: acrescentar um
  // fragmento mudaria a conta e o comentario passaria a mentir, que e a classe de
  // defeito mais frequente nesta serie.
  for (const a of PEDACOS) for (const b of PEDACOS) for (const c of PEDACOS) yield a + b + c;
  // Gap de UM caractere entre `pre` e `venda`/`order`, varrendo o latim-1 inteiro
  // mais os terminadores de linha exoticos. E a dimensao que a flag `s` fechou.
  for (let cp = 0; cp <= 0x2FFF; cp++) {
    const ch = String.fromCharCode(cp);
    if (ch === "\0") continue;   // `text` do Postgres nao armazena NUL
    yield `pre${ch}venda`;
    yield `pre${ch}order`;
  }
  // Os valores que o proprio sistema grava, e as bordas.
  yield* ["disponivel", "esgotado", "estoque_limitado", "indisponivel", "pre_venda",
          "descontinuado", "", " ", "\n", "PRE-VENDA", "Pre-Order", "ENCOMENDA"];
}

describe("a trava de reservado concorda com o `LIKE` do gatilho", () => {
  it("nenhuma divergencia no corpus gerado", () => {
    const divergem: string[] = [];
    let n = 0;
    for (const s of corpus()) {
      n++;
      if (bancoIsenta(s) !== telaIsenta(s)) divergem.push(JSON.stringify(s));
      if (divergem.length >= 10) break;   // dez bastam para diagnosticar
    }
    expect(n, "o corpus encolheu — este teste passou a nao exercitar quase nada")
      .toBeGreaterThan(20000);
    expect(divergem, "a tela e o gatilho discordam sobre estes status").toEqual([]);
  });

  // O corpus so prova alguma coisa se ele CONTIVER os dois desfechos. Um corpus em
  // que tudo trava passaria com uma regex que nunca isenta.
  it("o corpus exercita os dois desfechos, e as quatro formas de gap", () => {
    let isentos = 0, travados = 0;
    for (const s of corpus()) (bancoIsenta(s) ? isentos++ : travados++);
    expect(isentos, "o corpus nao tem caso isento").toBeGreaterThan(100);
    expect(travados, "o corpus nao tem caso travado").toBeGreaterThan(100);
    // As quatro formas de gap que as rodadas 7 a 10 descobriram, uma a uma.
    for (const [nome, s] of [
      ["vazio", "prevenda"], ["separador", "pre-venda"],
      ["letra", "pre lancamento venda"], ["quebra de linha", "pre\nvenda"],
    ] as const) {
      expect(bancoIsenta(s), `o gap "${nome}" deixou de ser isento pelo banco`).toBe(true);
      expect(telaIsenta(s), `o gap "${nome}" deixou de ser isento pela tela`).toBe(true);
    }
  });

  // A referencia tambem pode estar errada. Estes casos vem do texto do gatilho, e
  // sao conferidos a mao no comentario de cada linha.
  it("a referencia de `LIKE` esta correta nos casos conhecidos", () => {
    expect(casaLike("prevenda", ["pre", "venda"]), "`pre` colado em `venda`").toBe(true);
    expect(casaLike("venda pre", ["pre", "venda"]), "ordem invertida NAO casa").toBe(false);
    expect(casaLike("pre", ["pre", "venda"]), "falta o segundo literal").toBe(false);
    expect(casaLike("prevenda", ["pre", "venda", "pre"]), "avanco guloso nao volta atras").toBe(false);
    expect(casaLike("preXvendaYpre", ["pre", "venda", "pre"]), "tres literais em ordem").toBe(true);
    expect(casaLike("qualquer", []), "padrao so com `%` casa tudo").toBe(true);
    expect(casaLike("", ["pre"]), "string vazia nao casa literal").toBe(false);
  });
});
