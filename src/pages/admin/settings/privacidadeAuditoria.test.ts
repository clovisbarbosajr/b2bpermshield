import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

const priv = readFileSync("src/pages/admin/settings/PrivacyGroups.tsx", "utf8");
const pay = readFileSync("src/pages/admin/settings/PaymentOptions.tsx", "utf8");
const logs = readFileSync("src/pages/admin/settings/ActivityLogs.tsx", "utf8");
const hook = readFileSync("src/hooks/useActivityLog.ts", "utf8");

describe("a trilha de auditoria nao pode sumir calada", () => {
  // `.insert()` do supabase-js RESOLVE com `{ error }` em falha de RLS — nao
  // lanca. O `catch` so pegava queda de rede, entao a tela dizia "40 products
  // adjusted" e o Activity Logs mostrava "No logs found" no periodo: o mesmo que
  // "ninguem fez nada". O risco concreto e de ordem de deploy — este arquivo
  // parou de mandar a identidade (o gatilho de 20260825340000 a reescreve), e o
  // front subindo antes do SQL faz todo insert ser recusado pela policy antiga.
  it("o `error` do insert e lido", () => {
    // Comeca no `try`, nao no `insert`: o destructuring do `error` esta ANTES do
    // texto do insert, e ancorar nele deixava a assercao fora da fatia.
    const fn = fatiaEntre(hook, "    try {", "return { log }", 45);
    expect(fn, "sem destructuring do `error`, a falha some").toMatch(/const \{ error \} = await/);
    // O `console.error` TEM QUE ESTAR NO RAMO DO `if (error)`. Exigir so a
    // presenca de `console.error(` na fatia deixava passar apagar essa linha: o
    // `console.error` do `catch` ja satisfazia a busca, e o efeito da correcao
    // — reportar a falha de RLS — ficava sem cobertura nenhuma.
    expect(fn, "o `if (error)` voltou a nao reportar nada")
      .toMatch(/if \(error\) console\.error\([^)]*error\)/);
  });

  it("o `catch` tambem deixa rastro", () => {
    expect(hook, "`catch {}` vazio e a mesma falha silenciosa por outra porta")
      .toMatch(/\} catch \(e\) \{[\s\S]{0,300}?console\.error\(/);
  });
});

describe("nome obrigatorio nas duas telas de cadastro", () => {
  // `nome` e NOT NULL, mas string VAZIA satisfaz NOT NULL. Grupo sem nome vira
  // checkbox EM BRANCO em seis telas de privacidade; opcao de pagamento sem nome
  // vira radio em branco no checkout do cliente.
  it("PrivacyGroups recusa nome vazio", () => {
    const fn = fatiaEntre(priv, "const handleSave", "const handleDelete", 40);
    expect(fn).toMatch(/const nome = form\.nome\.trim\(\)/);
    expect(fn, "sem o `return`, salva assim mesmo").toMatch(/if \(!nome\) \{ toast\.error\([^)]*\); return; \}/);
    expect(fn, "o payload tem que usar o nome APARADO").toMatch(/nome,/);
  });

  it("PaymentOptions recusa nome vazio", () => {
    const fn = fatiaEntre(pay, "const handleSave", "const handleDelete", 45);
    expect(fn).toMatch(/const nome = form\.nome\.trim\(\)/);
    expect(fn).toMatch(/if \(!nome\) \{ toast\.error\([^)]*\); return; \}/);
  });
});

describe("delete que apaga em cascata tem que dizer quanto", () => {
  // `cliente_payment_options` e ON DELETE CASCADE: apagar a opcao apaga TODA
  // atribuicao de cliente, sem volta. O irmao `PrivacyGroups.handleDelete` ja
  // contava antes; esta tela dizia so "Delete this payment option?".
  it("PaymentOptions conta as atribuicoes antes de perguntar", () => {
    const fn = fatiaEntre(pay, "const handleDelete", "const toggleSecret", 45);
    expect(fn).toMatch(/from\("cliente_payment_options"\)/);
    expect(fn).toMatch(/count: "exact", head: true/);
    expect(fn, "contagem falhada NAO pode virar delete as cegas")
      .toMatch(/if \(contaErr\) \{[\s\S]{0,200}?return;/);
    expect(fn, "o confirm tem que dizer o numero").toMatch(/customer assignment\(s\)/);
  });
});

describe("ActivityLogs: paginacao e corrida", () => {
  // O filtro entrava em vigor sem passar por Search, na pagina em que o admin
  // estivesse: 12 registros filtrados com `range(150,199)` davam tabela vazia sob
  // "12 record(s) found".
  it("trocar filtro volta para a pagina 1", () => {
    // Exigir so o identificador deixava passar `trocaFiltro = (set) => (v) => {
    // set(v); }` — sem o `setPage(1)`, que e a correcao inteira.
    expect(logs, "`trocaFiltro` sem `setPage(1)` nao faz nada")
      .toMatch(/const trocaFiltro = \(set: \(v: string\) => void\) => \(v: string\) => \{ set\(v\); setPage\(1\); \}/);
    for (const f of ["setFilterAction", "setFilterEntity", "setFilterUser"]) {
      expect(logs, `${f} nao reseta a pagina`).toMatch(new RegExp(`trocaFiltro\\(v => ${f}`));
    }
  });

  // Refresh + Next em sequencia rapida deixavam a resposta mais VELHA vencer: a
  // tabela mostrando uma pagina e o rodape nomeando outra. Numa auditoria, isso e
  // atribuir a acao a quem nao fez.
  it("so a leitura mais recente escreve na tela", () => {
    expect(logs).toMatch(/const leituraSeq = useRef\(0\)/);
    expect(logs).toMatch(/const meu = \+\+leituraSeq\.current/);
    const guardas = logs.match(/if \(meu !== leituraSeq\.current\) return;/g) ?? [];
    expect(guardas.length, "o ramo de ERRO tambem precisa da guarda").toBeGreaterThanOrEqual(2);
  });
});
