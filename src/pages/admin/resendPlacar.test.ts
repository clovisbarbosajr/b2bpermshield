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
const iBloco = fonte.indexOf("const bloqueado = (r: any)");
const bloco = fonte.slice(iBloco, fonte.indexOf("const loadOrder", iBloco));

describe("Resend do pedido: placar, modal e log", () => {
  it("o bloco existe", () => {
    expect(iBloco, "sumiu o tratamento de resultado do Resend").toBeGreaterThan(-1);
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
    expect(bloco).toMatch(/foram > 0 \? `Sent .*` : "Nothing was sent\. "/);
  });

  // O pior efeito da versao anterior: modal aberto + selecao intacta + mensagem
  // dizendo que nada saiu = operador reenvia para quem ja recebeu.
  it("fecha o modal quando ALGO saiu, nao so no sucesso total", () => {
    expect(bloco, "modal preso aberto faz o retry duplicar o que ja foi enviado")
      .toMatch(/if \(foram > 0\) setResendOpen\(false\)/);
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
