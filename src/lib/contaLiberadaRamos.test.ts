import { describe, it, expect } from "vitest";

// O BLOCO DE VERIFICACAO DE UMA MIGRATION, VERIFICADO AQUI.
//
// `supabase/migrations/20260828030000_bloqueio_de_pedido_herda_do_titular.sql`
// muda `conta_liberada_de`, a funcao que decide se um cliente enxerga catalogo e
// preco. Ela falha em SILENCIO: nao levanta excecao, so devolve `false` e a loja
// fica vazia para alguem.
//
// O rodape daquela migration traz um bloco SQL que exercita a funcao. Esse bloco
// ja esteve ERRADO DUAS VEZES, e das duas o erro foi o mesmo: ficha de teste com
// DOIS defeitos ao mesmo tempo, um mascarando o outro, aprovando funcoes que
// tinham perdido um ramo inteiro.
//
// Este teste espelha a logica da funcao e prova que as seis assercoes do bloco
// cobrem os quatro ramos, um por um. Se alguem mexer nas fichas de la e reintroduzir
// o mascaramento, aqui acende — sem precisar de banco.
//
// NAO substitui rodar o bloco no banco: o SQL de verdade pode divergir deste
// espelho. O que ele garante e que o CENARIO discrimina.

const DENY = new Set([
  "pendente", "inativo", "rejeitado", "suspenso",
  "pending", "inactive", "rejected", "suspended", "blocked",
]);

type Ficha = { status: string; ativo: boolean; pai: string | null };

/** As oito fichas do bloco (3) da migration, na mesma configuracao. */
const FICHAS: Record<string, Ficha> = {
  pai_ok:          { status: "ativo",    ativo: true,  pai: null },
  pai_status_ruim: { status: "inativo",  ativo: true,  pai: null },
  pai_flag_ruim:   { status: "ativo",    ativo: false, pai: null },
  filho_ok:        { status: "ativo",    ativo: true,  pai: "pai_ok" },
  filho_status:    { status: "pendente", ativo: true,  pai: "pai_ok" },
  filho_flag:      { status: "ativo",    ativo: false, pai: "pai_ok" },
  filho_ps:        { status: "ativo",    ativo: true,  pai: "pai_status_ruim" },
  filho_pf:        { status: "ativo",    ativo: true,  pai: "pai_flag_ruim" },
};

/** As seis assercoes do bloco, com o valor que a migration declara esperar. */
const ASSERCOES: Array<[string, string, boolean]> = [
  ["c1_titular",      "pai_ok",       true],
  ["c2_filho_ok",     "filho_ok",     true],
  ["r1_status_filho", "filho_status", false],
  ["r2_flag_filho",   "filho_flag",   false],
  ["r3_status_pai",   "filho_ps",     false],
  ["r4_flag_pai",     "filho_pf",     false],
];

type Mutacao = "join" | "me_status" | "me_flag" | "dono_status" | "dono_flag" | null;

/** Espelho do corpo novo de `conta_liberada_de`. `mut` remove um ramo. */
function contaLiberadaDe(id: string, mut: Mutacao = null): boolean {
  const me = FICHAS[id];
  let dono: Ficha | null = null;
  if (me.pai === null) {
    if (mut === "join") return false; // LEFT JOIN virou JOIN: sem pai, sem linha
  } else {
    dono = FICHAS[me.pai];
  }

  let inativo = false;
  if (mut !== "me_flag") inativo = inativo || me.ativo === false;
  if (mut !== "dono_flag") inativo = inativo || dono?.ativo === false;
  if (inativo) return false;

  if (mut !== "me_status" && DENY.has(me.status.toLowerCase())) return false;
  if (mut !== "dono_status" && dono && DENY.has(dono.status.toLowerCase())) return false;
  return true;
}

const roda = (mut: Mutacao) => ASSERCOES.map(([, ficha]) => contaLiberadaDe(ficha, mut));
const ESPERADO = ASSERCOES.map(([, , e]) => e);

describe("bloco de verificacao de conta_liberada_de (20260828030000)", () => {
  it("aprova a funcao CORRETA — senao o bloco barraria a migration boa", () => {
    expect(roda(null)).toEqual(ESPERADO);
  });

  // O coracao: cada ramo perdido tem que derrubar UMA assercao, e so uma. Duas
  // assercoes caindo junto significa que uma delas e redundante; nenhuma caindo
  // significa que o ramo nao esta coberto — foi o que aconteceu duas vezes.
  it.each([
    ["join",        "LEFT JOIN virou JOIN",                     "c1_titular"],
    ["me_status",   "denylist sobre o status do FILHO removida", "r1_status_filho"],
    ["me_flag",     "me.is_active removido",                     "r2_flag_filho"],
    ["dono_status", "denylist sobre o status do PAI removida",   "r3_status_pai"],
    ["dono_flag",   "dono.is_active removido",                   "r4_flag_pai"],
  ] as Array<[Mutacao, string, string]>)(
    "%s (%s) reprova exatamente uma assercao: %s",
    (mut, _desc, esperada) => {
      const r = roda(mut);
      const caidas = ASSERCOES
        .map(([nome], i) => (r[i] !== ESPERADO[i] ? nome : null))
        .filter(Boolean);
      expect(caidas).toEqual([esperada]);
    },
  );

  // A armadilha, fixada: se `filho_status` voltar a nascer com os dois defeitos
  // (como nas duas versoes anteriores do bloco), remover a denylist do filho para
  // de reprovar — porque a execucao sai antes, pelo `is_active`.
  it("ficha com DOIS defeitos mascara um ramo — por isso cada uma tem so um", () => {
    const comDoisDefeitos = { status: "pendente", ativo: false, pai: "pai_ok" };
    const salvo = FICHAS.filho_status;
    FICHAS.filho_status = comDoisDefeitos;
    try {
      // Sem a denylist do filho, ele AINDA sai `false` — pelo outro ramo.
      expect(contaLiberadaDe("filho_status", "me_status")).toBe(false);
    } finally {
      FICHAS.filho_status = salvo;
    }
    // Com a ficha correta, a mesma mutacao passa a ser detectada.
    expect(contaLiberadaDe("filho_status", "me_status")).toBe(true);
  });
});
