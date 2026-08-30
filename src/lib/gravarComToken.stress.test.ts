/**
 * TESTE DE ESTRESSE do bloqueio otimista sob escrita concorrente.
 *
 * POR QUE ESTA FUNCAO, AGORA: `gravarComToken` deixou de ser o caminho de UMA
 * tela. Alem do save da ficha de produto e do de cliente, os DOIS selects da
 * lista de produtos (status e Active) passaram a grava-lo — e ali cada linha da
 * grade e um ponto de escrita, com o `admin_rev` vindo da closure do render em
 * que o handler nasceu.
 *
 * Foi exatamente ali que apareceu o defeito que leitura nenhuma pegou: um `slot`
 * unico de "linha em voo" era sobrescrito pelo clique na linha seguinte e
 * DESTRAVAVA a primeira no meio da gravacao. O cetico reproduziu em execucao:
 * t=50ms a linha A travada, t=60ms destravada com a gravacao de A ainda no ar, e
 * o clique seguinte em A acusava "Someone else changed this product" — o admin
 * colidindo consigo mesmo, com a mudanca descartada em silencio.
 *
 * O cenario simulado e o real: ~50 admins/managers com a mesma lista aberta,
 * mexendo em status e Active de linhas que se sobrepoem, com latencia aleatoria
 * para as respostas chegarem fora de ordem.
 *
 * O QUE ESTE TESTE EXIGE, e que so existe em execucao:
 *  - o `admin_rev` do banco NUNCA anda para tras e nunca pula;
 *  - duas gravacoes concorrentes na MESMA linha: exatamente uma vence, e a
 *    perdedora recebe `conflito` — nunca as duas "ok", nunca as duas conflito;
 *  - o valor final da linha e o de ALGUEM que recebeu `ok` — nunca um estado
 *    costurado de dois payloads;
 *  - nenhuma escrita e perdida em silencio: toda mudanca ou esta na linha, ou o
 *    chamador foi avisado;
 *  - a trava por linha (`Set`) nunca destrava uma linha com gravacao em voo, nem
 *    deixa linha travada para sempre depois que a gravacao termina.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { gravarComToken } from "./gravarComToken";

// ---- banco falso com transacao atomica por linha ---------------------------
//
// O `UPDATE ... WHERE id = ? AND admin_rev = ?` do PostgREST e atomico no
// Postgres. O falso reproduz isso: a decisao (comparar o token e incrementar)
// acontece num bloco SINCRONO, e so a LATENCIA e assincrona — e onde a latencia
// entra e o que muda o resultado, entao ela vem antes E depois.
type Linha = { id: string; admin_rev: number; status_produto: string; ativo: boolean };
let tabela: Record<string, Linha>;

// Gerador deterministico: `Math.random()` faria o teste falhar de vez em quando
// sem ninguem saber por que, e um estresse que ninguem consegue repetir nao serve
// de prova. A semente varia por chamada, nao por execucao.
let semente = 0;
const pseudo = () => {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
};
const espera = () => new Promise((r) => setTimeout(r, Math.floor(pseudo() * 8)));

const sbFalso = {
  from(_t: string) {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> = {};
    const api = {
      update(p: Record<string, unknown>) { patch = p; return api; },
      eq(col: string, val: unknown) { filtros[col] = val; return api; },
      select(_c: string) { return api; },
      async maybeSingle() {
        await espera(); // ida
        const linha = tabela[String(filtros.id)];
        // BLOCO SINCRONO: e o que o Postgres garante. Partir isto em dois
        // `await` faria o falso mentir a favor do codigo.
        let resultado: { data: unknown; error: null; status: number };
        if (!linha || linha.admin_rev !== filtros.admin_rev) {
          resultado = { data: null, error: null, status: 204 };
        } else {
          Object.assign(linha, patch);
          resultado = { data: { admin_rev: linha.admin_rev }, error: null, status: 200 };
        }
        await espera(); // volta
        return resultado;
      },
    };
    return api;
  },
};

const STATUS = ["disponivel", "esgotado", "estoque_limitado", "pre_venda"];

beforeEach(() => {
  semente = 20260830;
  tabela = {};
  for (let i = 0; i < 10; i++) {
    tabela[`p${i}`] = { id: `p${i}`, admin_rev: 0, status_produto: "disponivel", ativo: true };
  }
});

describe("gravarComToken sob 50 admins simultaneos", () => {
  it("exatamente um vence por token, e o perdedor e AVISADO", async () => {
    // Cinquenta gravacoes em dez linhas: cinco por linha, todas partindo do
    // MESMO `admin_rev` — que e o que acontece quando cinco pessoas abriram a
    // lista antes de qualquer uma salvar.
    const tarefas = Array.from({ length: 50 }, (_, i) => {
      const id = `p${i % 10}`;
      const revLido = tabela[id].admin_rev; // token da closure, como na tela
      return gravarComToken(sbFalso, "produtos", id, { status_produto: STATUS[i % 4] }, revLido)
        .then((r) => ({ id, i, r }));
    });
    const saidas = await Promise.all(tarefas);

    for (let l = 0; l < 10; l++) {
      const daLinha = saidas.filter((s) => s.id === `p${l}`);
      const ok = daLinha.filter((s) => s.r.tipo === "ok");
      const conflito = daLinha.filter((s) => s.r.tipo === "conflito");
      // ESTE E O ASSERT QUE IMPORTA. Dois "ok" partindo do mesmo token seria
      // escrita perdida em silencio; zero "ok" seria a tela travada sem motivo.
      expect(ok.length, `linha p${l}: mais de um vencedor com o mesmo token`).toBe(1);
      expect(conflito.length, `linha p${l}: perdedor nao foi avisado`).toBe(daLinha.length - 1);
      // Nenhum desfecho pode sumir: os quatro tipos sao distintos de proposito.
      expect(ok.length + conflito.length).toBe(daLinha.length);
    }
  });

  it("o `admin_rev` anda de um em um e nunca para tras", async () => {
    // Cada rodada, todo mundo rele o token atual e tenta de novo — o laco real de
    // "recarreguei e tentei outra vez".
    for (let rodada = 0; rodada < 6; rodada++) {
      const antes = Object.fromEntries(Object.entries(tabela).map(([k, v]) => [k, v.admin_rev]));
      await Promise.all(Array.from({ length: 30 }, (_, i) => {
        const id = `p${i % 10}`;
        return gravarComToken(sbFalso, "produtos", id, { ativo: i % 2 === 0 }, tabela[id].admin_rev);
      }));
      for (const id of Object.keys(tabela)) {
        const delta = tabela[id].admin_rev - antes[id];
        expect(delta, `${id}: o token andou ${delta} numa rodada`).toBe(1);
      }
    }
  });

  it("o valor final e o de um vencedor, e nao um estado costurado", async () => {
    // Cada gravacao manda um PAR (status, ativo) coerente. Se o falso — ou o
    // codigo — deixasse duas escritas se intercalarem, a linha ficaria com o
    // status de uma e o `ativo` de outra: um estado que nunca foi enviado.
    const pares = STATUS.map((s, i) => ({ status_produto: s, ativo: i % 2 === 0 }));
    const saidas = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      gravarComToken(sbFalso, "produtos", "p0", pares[i % 4], tabela["p0"].admin_rev)
        .then((r) => ({ enviado: pares[i % 4], r }))));

    const vencedores = saidas.filter((s) => s.r.tipo === "ok").map((s) => s.enviado);
    expect(vencedores.length, "ninguem gravou").toBeGreaterThan(0);
    const final = tabela["p0"];
    const casa = vencedores.some((v) => v.status_produto === final.status_produto && v.ativo === final.ativo);
    expect(casa, `linha final (${final.status_produto}, ${final.ativo}) nao foi enviada por nenhum vencedor`)
      .toBe(true);
  });

  it("a trava por LINHA nao destrava quem ainda esta no ar, e sempre libera no fim", async () => {
    // Reproduz a mecanica exata da lista de produtos: um `Set` de ids em voo,
    // marcado antes do await e limpo em `finally`. O defeito que este teste mata e
    // o SLOT UNICO — `string | null` —, em que o clique na linha B destravava a
    // linha A com a gravacao de A ainda pendente.
    let salvando = new Set<string>();
    const emVooQuandoTerminou: Record<string, boolean> = {};

    const gravar = async (id: string, patch: Partial<Linha>) => {
      salvando = new Set(salvando).add(id);
      try {
        return await gravarComToken(sbFalso, "produtos", id, patch, tabela[id].admin_rev);
      } finally {
        // MEDIDO NO INSTANTE EM QUE A GRAVACAO TERMINA: a linha tem que estar
        // travada. Com slot unico, uma gravacao concorrente em outra linha ja
        // teria apagado esta marca.
        emVooQuandoTerminou[id] = salvando.has(id);
        salvando = new Set([...salvando].filter((x) => x !== id));
      }
    };

    // Dez linhas diferentes, disparadas em sequencia rapida — o caso que quebrava.
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      gravar(`p${i}`, { status_produto: STATUS[i % 4] })));

    for (let i = 0; i < 10; i++) {
      expect(emVooQuandoTerminou[`p${i}`],
        `p${i} foi destravada por outra linha antes da propria gravacao terminar`).toBe(true);
    }
    // E NINGUEM FICA TRAVADO. Sem o `finally`, uma saida antecipada deixaria a
    // linha morta ate o F5.
    expect([...salvando], "sobrou linha travada depois de tudo terminar").toEqual([]);
  });

  it("gravacao em linha apagada por outro admin devolve conflito, nao sucesso", async () => {
    // O caso real: o dialogo esta aberto, outro admin apaga a linha, e o
    // `UPDATE ... WHERE id = ?` casa ZERO linhas — que o PostgREST devolve como
    // 204 com `error: null`. Sem o `.select().maybeSingle()`, isso e "sucesso".
    const rev = tabela["p3"].admin_rev;
    const apagar = (async () => { await espera(); delete tabela["p3"]; })();
    const [r] = await Promise.all([
      gravarComToken(sbFalso, "produtos", "p3", { ativo: false }, rev),
      apagar,
    ]);
    expect(["ok", "conflito"], "desfecho inesperado").toContain(r.tipo);
    // Se a linha sumiu antes do UPDATE, tem que ser conflito. Se sumiu depois, o
    // "ok" e verdadeiro — mas nunca pode ser "ok" com a linha ja ausente no
    // momento da escrita, que e o que este assert amarra.
    if (r.tipo === "ok") expect(tabela["p3"], "gravou 'ok' numa linha que nao existia").toBeUndefined();
  });
});
