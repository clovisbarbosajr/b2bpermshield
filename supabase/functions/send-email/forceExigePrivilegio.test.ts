import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// O INTERRUPTOR MESTRE DO CANAL DE E-MAIL NAO PODE SER DESLIGADO POR QUEM CHAMA.
//
// Ate 28/ago/2026 o `send-email` avaliava `body.force !== true` para decidir se
// passava por cima do interruptor mestre — e so calculava `isPrivilegedCaller` 49
// linhas DEPOIS. Qualquer um com a anon key (que esta no bundle do front, e por
// definicao publica) mandava `force: true` e ignorava a torneira.
//
// A torneira existe por causa de 25/ago, quando um sync disparou 1.508 SMS para
// clientes reais. Uma trava que o proprio chamador desliga nao e trava.
//
// Estes testes olham a ORDEM e a CONDICAO no fonte, e nao so a presenca das
// strings: a versao anterior tinha todas as palavras certas, no lugar errado.

const fonte = readFileSync("supabase/functions/send-email/index.ts", "utf8");

const iPrivilegiado = fonte.indexOf("const isPrivilegedCaller = viaCron || viaService || isAdmin;");
const iForcePermitido = fonte.indexOf("const forcePermitido =");
const iInterruptor = fonte.indexOf("emailChannelOff &&");

describe("send-email: `force` exige chamador privilegiado", () => {
  it("as tres pecas existem", () => {
    expect(iPrivilegiado, "sumiu `isPrivilegedCaller`").toBeGreaterThan(-1);
    expect(iForcePermitido, "sumiu `forcePermitido`").toBeGreaterThan(-1);
    expect(iInterruptor, "sumiu a checagem do interruptor mestre").toBeGreaterThan(-1);
  });

  // O DEFEITO ERA DE ORDEM. `isPrivilegedCaller` calculado depois do uso valia
  // `undefined` na pratica — todas as strings estavam la, e a trava nao existia.
  it("quem esta chamando e resolvido ANTES do interruptor", () => {
    expect(iPrivilegiado, "`isPrivilegedCaller` voltou para depois do interruptor")
      .toBeLessThan(iInterruptor);
    expect(iPrivilegiado, "`forcePermitido` nao pode ser calculado antes de saber quem chama")
      .toBeLessThan(iForcePermitido);
  });

  it("o `force` do interruptor passa por `forcePermitido`, nunca por `body.force` cru", () => {
    const linha = fonte.slice(iInterruptor, iInterruptor + 120);
    expect(linha, "o interruptor voltou a olhar `body.force` direto").not.toMatch(/body\.force/);
    expect(linha).toMatch(/!forcePermitido/);
  });

  it("`forcePermitido` exige as DUAS condicoes", () => {
    const linha = fonte.slice(iForcePermitido, fonte.indexOf(";", iForcePermitido));
    expect(linha).toMatch(/body\.force === true/);
    expect(linha, "sem `isPrivilegedCaller` a trava volta a ser desligavel pelo chamador")
      .toMatch(/isPrivilegedCaller/);
  });

  // Os checks `email_on_*` sao a segunda camada. Se o `force` deles continuasse
  // cru, o chamador desligava a camada de dentro mesmo com o interruptor de fora
  // fechado — meia trava.
  it("os checks `email_on_*` usam o mesmo `forcePermitido`", () => {
    expect(fonte).toMatch(/const force = forcePermitido;/);
    expect(fonte, "`const force = body.force === true` reabre o buraco na segunda camada")
      .not.toMatch(/const force = body\.force === true;/);
  });

  // `travaErro` e "nao sei o que esta ligado". Nem admin passa por cima disso.
  it("`travaErro` continua sem aceitar force, nem de admin", () => {
    const cond = fonte.slice(iInterruptor - 200, iInterruptor + 120);
    expect(cond).toMatch(/travaErro \|\|/);
  });
});

// ---------------------------------------------------------------------------
// NENHUM ESTADO MUTAVEL NO ESCOPO DE MODULO.
//
// O isolate de uma Edge Function e REAPROVEITADO entre requisicoes. Um `let` no
// topo do arquivo nao e "uma variavel do arquivo" — e uma variavel COMPARTILHADA
// por todas as chamadas concorrentes, e ninguem a zera no inicio de uma.
//
// Era o caso do `squatParaInvalidar`: a requisicao A gravava o uid dela, a
// requisicao B chegava ao bloco final, encontrava o valor de A e INVALIDAVA A
// SENHA DA CONTA ERRADA — de alguem que nao pediu nada.
// ---------------------------------------------------------------------------
describe("send-email: estado de modulo", () => {
  const iHandler = fonte.indexOf("Deno.serve(async (req)");

  it("o handler existe (senao as buscas abaixo nao querem dizer nada)", () => {
    expect(iHandler).toBeGreaterThan(-1);
  });

  it("nao ha `let` nem `var` antes do handler", () => {
    const topo = fonte.slice(0, iHandler);
    const mutaveis = topo.split("\n").filter((l) => /^(let|var)\s/.test(l));
    expect(mutaveis, `estado compartilhado entre requisicoes: ${mutaveis.join(" | ")}`).toEqual([]);
  });

  it("`squatParaInvalidar` e declarado DENTRO do handler", () => {
    const iDecl = fonte.indexOf("let squatParaInvalidar");
    expect(iDecl, "sumiu a declaracao").toBeGreaterThan(-1);
    expect(iDecl, "voltou para o escopo de modulo — contamina requisicao concorrente")
      .toBeGreaterThan(iHandler);
  });
});
