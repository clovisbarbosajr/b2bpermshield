import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node). Mesma nota dos outros testes de fonte.
import { readFileSync } from "node:fs";

// A LOGICA saiu deste arquivo. Classificacao, texto do toast, texto do log e
// leitura do corpo do erro moram em `src/lib/reenvioPlacar.ts` e sao exercitadas
// por testes que EXECUTAM (`src/lib/reenvioPlacar.test.ts`) — foi assim que um
// `const` usado antes da declaracao deixou de poder passar: `tsc`, eslint e
// regex sobre a fonte deixaram esse erro passar, e ele derrubava TODO reenvio
// depois de os e-mails ja terem saido.
//
// O que sobra aqui e o que so existe na tela e que um teste de unidade nao ve:
// a ORDEM das coisas no handler e o que ele faz com o estado do React. Uma
// reversao que traga a logica de volta para dentro do componente reprova aqui.

const fonte = readFileSync("src/pages/admin/OrderDetail.tsx", "utf8");
// O DELIMITADOR TEM QUE VIR DEPOIS DO BLOCO, e isso ja falhou: uma versao
// anterior fatiava ate `const loadOrder`, que esta ANTES do bloco no arquivo.
// `indexOf` devolvia -1, `slice(i, -1)` pegava 1064 linhas e uma assercao casava
// com o `handleSave`. Passava por construcao.
const iBloco = fonte.indexOf("const calls: { quem: string");
const iFim = fonte.indexOf("const handleSave", iBloco);
const bloco = fonte.slice(iBloco, iFim);

describe("Resend do pedido: o que so a tela faz", () => {
  it("o bloco existe e a fatia e mesmo o bloco", () => {
    expect(iBloco, "sumiu o tratamento de resultado do Resend").toBeGreaterThan(-1);
    expect(iFim, "o delimitador de fim nao foi encontrado DEPOIS do bloco").toBeGreaterThan(iBloco);
    expect(bloco.split("\n").length, "a fatia esta grande demais para ser so o bloco")
      .toBeLessThan(120);
  });

  it("sai antes quando nao ha destinatario montado", () => {
    // As guardas do topo checam as CAIXAS marcadas, nao as chamadas montadas: com
    // a caixa do cliente marcada e o cliente sem e-mail, `calls` ficava vazio e o
    // bloco caia no ramo de SUCESSO — toast verde e log de reenvio, zero requests.
    expect(bloco).toMatch(/if \(calls\.length === 0\)/);
    expect(bloco).toMatch(/No recipient with an email address/);
  });

  it("a logica vem do modulo, nao esta inline de novo", () => {
    expect(bloco).toMatch(/classificaReenvio\(results as any\[\], calls\.map\(\(c\) => c\.quem\)\)/);
    expect(bloco).toMatch(/toast\.error\(montaMensagem\(/);
    expect(bloco).toMatch(/textoDoLog\(String\(order\.numero \|\| order\.id\), placar\)/);
    expect(bloco, "sem isto, todo erro HTTP volta a virar a mesma frase fixa")
      .toMatch(/await motivoHttp\(primeiro\?\.value\?\.error\)/);
    expect(bloco).toMatch(/adminResolve\(motivoBloqueio, msg\)/);
  });

  // O bug mais caro deste arquivo: `handleResend` esta pendurado direto no
  // `onClick`, sem catch. Um throw entre o envio e o fim deixava `resending` em
  // true para sempre — botao morto ate F5, sem toast e sem log, DEPOIS de os
  // e-mails terem saido.
  it("o botao volta mesmo se algo lancar", () => {
    expect(bloco, "sem `finally`, um throw no meio trava o Resend ate F5")
      .toMatch(/\} finally \{\s+setResending\(false\);\s+\}/);
  });

  // `try/finally` sem `catch` RE-LANCA. So com o `finally`, um throw depois do
  // envio devolvia o botao e deixava o modal aberto com as caixas marcadas, sem
  // toast e sem log — e o passo natural dali e clicar Send de novo, duplicando.
  // Um `catch {}` vazio passaria por qualquer teste que so procure a palavra:
  // o que se exige aqui e que ele AVISE.
  it("o catch avisa o operador em vez de engolir", () => {
    // O QUE IMPORTA E O CORPO, nao o nome do binding. Uma versao anterior casava
    // a string exata "} catch (e) {": renomear a variavel para `err` reprovava a
    // suite com mudanca de comportamento ZERO, e ainda por cima com a mensagem
    // "sem `catch`, a excecao sobe" — acusando ausencia de um `catch` que estava
    // ali. Quem topasse com isso ia cacar um bug que nao existe.
    const m = /\}\s*catch\s*(\([^)]*\)\s*)?\{/.exec(bloco);
    expect(m, "sem `catch`, a excecao sobe como unhandled rejection").not.toBeNull();
    const corpo = bloco.slice(m!.index, bloco.indexOf("} finally {", m!.index));
    expect(corpo, "sem o toast o operador nao fica sabendo de nada")
      .toMatch(/toast\.error\(/);
    expect(corpo, "e tem que ser mandado ao log antes de reenviar")
      .toMatch(/check the notification log before re-sending/i);
    // `console.error` COM o objeto do erro: e a unica coisa que sobra para
    // diagnostico. Sem esta linha, remove-lo (ou rebaixar para `console.log`)
    // passava verde — duas mutacoes sobreviveram exatamente assim.
    // Segundo argumento e um identificador QUALQUER, nao o nome `e`: prender ao
    // nome era o mesmo defeito da linha acima, so que uma linha abaixo.
    expect(corpo, "sem `console.error(msg, erro)` a excecao se perde")
      .toMatch(/console\.error\([^)]*,\s*\w+\s*\)/);
    // ALFINETE na frase que ja esteve aqui, e so isso: o catch alcanca o caso em
    // que tudo foi recusado e nada saiu, e dizer "the emails were sent" ali seria
    // mentira. Nao e regra contra afirmar entrega — "your messages went out"
    // passaria por esta assercao. Impede o revert literal, nao a classe.
    expect(corpo, "com tudo recusado, dizer que os e-mails sairam e mentira")
      .not.toMatch(/emails were sent/i);
  });

  // E o `finally` no FIM: soltar o botao logo apos o `allSettled` deixava a tela
  // clicavel durante o `await` da leitura do corpo — modal aberto, caixas
  // marcadas — e um clique ali dispara um segundo envio inteiro.
  it("o botao NAO volta antes do await do motivo", () => {
    const depois = bloco.slice(bloco.indexOf("await Promise.allSettled"));
    const iSolta = depois.search(/\n\s+setResending\(false\);/);
    const iAwaitMotivo = depois.indexOf("await motivoHttp(");
    expect(iAwaitMotivo).toBeGreaterThan(-1);
    expect(iSolta, "soltar o botao ANTES do await reabre o caminho da duplicata")
      .toBeGreaterThan(iAwaitMotivo);
  });

  // Modal aberto + selecao intacta + "falhou" = operador reenvia para quem ja
  // recebeu. E limpar sob `foram === 0` seria o oposto: apaga o endereco digitado
  // no meio de uma tentativa que ele vai repetir.
  it("fecha o modal e limpa a selecao — so quando algo saiu", () => {
    expect(bloco).toMatch(
      /if \(placar\.foram > 0\) \{\s+setResendOpen\(false\);\s+setResend\(\{ customer: false, admin: false, other: false, otherEmail: "" \}\);\s+\}/);
  });

  it("o log de atividade fica DENTRO do bloco, com o placar", () => {
    expect(bloco).toMatch(/log\("updated", "order", order\.id, textoDoLog\(/);
  });
});
