import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node). Mesma nota dos outros testes de fonte.
import { readFileSync } from "node:fs";

// O "Resend" da tela de pedido faz ATE TRES chamadas independentes — cliente,
// admin, outro destinatario — e o bloqueio e decidido DENTRO de cada uma. O teto
// de e-mail por hora derruba a terceira e deixa as duas primeiras passarem.
//
// Este caminho ja mentiu nas DUAS direcoes:
//   1. `{ skipped: true }` chega com HTTP 200 e sem `error`. O filtro so olhava
//      `error`, entao envio bloqueado virava "Order confirmation re-sent.";
//   2. a correcao disso marcou TUDO como falha: com 1 bloqueado e 2 enviados a
//      tela dizia "Nothing was sent" — e, como o modal so fechava no sucesso
//      total, o operador reenviava e DUPLICAVA os e-mails que ja tinham saido.
//
// Os testes olham a fiacao do bloco, que e onde as duas mentiras moraram.

const fonte = readFileSync("src/pages/admin/OrderDetail.tsx", "utf8");
// O DELIMITADOR TEM QUE VIR DEPOIS DO BLOCO, e isso ja falhou aqui: a versao
// anterior fatiava ate `const loadOrder`, que esta ANTES de `const bloqueado` no
// arquivo. `indexOf` a partir do bloco devolvia -1, `slice(i, -1)` pegava 1064
// linhas — quase o arquivo inteiro — e a assercao do `log` casava com o
// `handleSave`, nao com o Resend. Passava por construcao.
const iBloco = fonte.indexOf("const calls: { quem: string");
const iFim = fonte.indexOf("const handleSave", iBloco);
const bloco = fonte.slice(iBloco, iFim);

describe("Resend do pedido: placar, modal e log", () => {
  it("o bloco existe e a fatia e mesmo o bloco", () => {
    expect(iBloco, "sumiu o tratamento de resultado do Resend").toBeGreaterThan(-1);
    // Sem esta linha, um delimitador que nao existe devolve -1 e a fatia vira o
    // arquivo quase inteiro — foi exatamente o que aconteceu na versao anterior.
    expect(iFim, "o delimitador de fim nao foi encontrado DEPOIS do bloco").toBeGreaterThan(iBloco);
    expect(bloco.split("\n").length, "a fatia esta grande demais para ser so o bloco")
      .toBeLessThan(200);
  });

  it("sai antes quando nao ha destinatario montado", () => {
    expect(bloco, "sem esta guarda, `calls` vazio cai no caminho de SUCESSO")
      .toMatch(/if \(calls\.length === 0\)/);
    expect(bloco).toMatch(/No recipient with an email address/);
  });

  it("o placar diz QUEM falhou, nao so quantos", () => {
    expect(bloco).toMatch(/const quemFalhou =/);
    expect(bloco, "sem o rotulo, o operador nao sabe quem ficou sem o e-mail")
      .toMatch(/failed: \$\{quemFalhou\.join\(", "\)\}/);
  });

  // Terceira direcao em que este bloco ja mentiu, e a mais cara: o `invoke` NUNCA
  // rejeita, e uma queda de rede DEPOIS do envio vira `FunctionsFetchError`. O
  // servidor ja gravou `notification_log` como `sent`; a tela dizia "Nothing was
  // sent", e o operador reenviava para quem ja tinha recebido.
  it("rede caida depois do envio nao vira 'nothing was sent'", () => {
    expect(bloco).toMatch(/const incerto = \(r: any\) => r\.value\?\.error\?\.name === "FunctionsFetchError"/);
    expect(bloco).toMatch(/const houveIncerto = naoForam\.some\(incerto\)/);
    expect(bloco, "tem que mandar conferir o log antes de reenviar")
      .toMatch(/Check the notification log before re-sending/);
  });

  // Em nao-2xx o functions-js lanca ANTES de ler o corpo e devolve `data: null`,
  // entao `value.data.error` e sempre nulo e sobrava a string fixa "Edge Function
  // returned a non-2xx status code" — 403, 400 e 502 viravam a mesma frase.
  it("le o motivo real do corpo da resposta HTTP", () => {
    expect(bloco).toMatch(/const motivoHttp = async/);
    expect(bloco, "`context` e o Response ainda nao lido").toMatch(/const ctx = err\?\.context/);
    expect(bloco, "ler duas vezes estoura: `value.response` e o MESMO objeto")
      .toMatch(/ctx\.bodyUsed/);
    expect(bloco, "502 de gateway responde HTML, nao JSON — o parse tem que ser guardado")
      .toMatch(/await ctx\.json\(\)[\s\S]{0,120}?\} catch \{/);
    expect(bloco).toMatch(/\(await motivoHttp\(primeiro\?\.value\?\.error\)\)/);
  });

  it("limpa a selecao quando algo saiu — e SO entao", () => {
    expect(bloco, "reabrir com as caixas marcadas duplica para quem ja recebeu")
      .toMatch(/setResend\(\{ customer: false, admin: false, other: false, otherEmail: "" \}\)/);
    // Junto com o fechar, no mesmo ramo. Com `foram === 0` nao ha duplicata a
    // evitar e apagar o "To email" digitado so atrapalha quem vai tentar de novo.
    expect(bloco).toMatch(
      /if \(foram > 0\) \{\s+setResendOpen\(false\);\s+setResend\(\{ customer: false/);
  });

  it("`skipped` conta como falha — senao envio bloqueado vira sucesso", () => {
    expect(bloco).toMatch(/value\?\.data\?\.skipped === true/);
    expect(bloco, "`bloqueado` tem que entrar no predicado de falha").toMatch(/\|\| bloqueado\(r\)/);
  });

  it("conta quantos FORAM, e nao so quantos falharam", () => {
    expect(bloco, "sem o placar, 1 bloqueado de 3 vira 'nothing was sent'")
      .toMatch(/const foram = results\.length - naoForam\.length/);
    expect(bloco).toMatch(/Sent \$\{foram\} of \$\{results\.length\}/);
  });

  it("'Nothing was sent' so quando NADA saiu", () => {
    // Ternario aninhado: com envio INCERTO (rede caiu depois de o servidor
    // entregar), "Nothing was sent" tambem seria mentira — ver o teste seguinte.
    expect(bloco).toMatch(/foram > 0\s*\n?\s*\? `Sent [\s\S]*?`\s*\n?\s*: houveIncerto \? "" : "Nothing was sent\. ";/);
  });

  // O pior efeito da versao anterior: modal aberto + selecao intacta + mensagem
  // dizendo que nada saiu = operador reenvia para quem ja recebeu.
  it("fecha o modal quando ALGO saiu, nao so no sucesso total", () => {
    expect(bloco, "modal preso aberto faz o retry duplicar o que ja foi enviado")
      .toMatch(/if \(foram > 0\) \{\s+setResendOpen\(false\);/);
  });

  it("o log de atividade nao afirma reenvio que nao houve", () => {
    expect(bloco, "o `log` tem que ficar DENTRO do bloco, com o placar").toMatch(/log\(\s*\n?\s*"updated"/);
    expect(bloco).toMatch(/naoForam\.length === 0/);
    expect(bloco).toMatch(/of \$\{results\.length\} sent/);
  });

  // A saida "peca a um admin" so resolve o interruptor mestre. Limite de idade,
  // teto por hora e envio pausado nao tem esse conserto — o admin repetindo leva o
  // mesmo bloqueio, e a frase mandaria o operador atras do que nao existe.
  it("so sugere o admin quando o admin resolve", () => {
    expect(bloco).toMatch(/const adminResolve =/);
    expect(bloco).toMatch(/master switch/);
    expect(bloco).toMatch(/adminResolve \? " — ask an admin/);
  });
});
