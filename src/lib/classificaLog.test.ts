import { describe, it, expect } from 'vitest';
import { classificaLog, CANAL_SEM_ENVIO } from './classificaLog';

// As linhas abaixo são TRANSCRITAS do backend, não inventadas: cada caso cita
// onde ela é gravada. Se o backend mudar o texto, este teste é o que quebra.
describe('classificaLog', () => {
  it('entrega bem-sucedida é enviado', () => {
    expect(classificaLog({ status: 'sent', channel: 'sms', error: null })).toBe('enviado');
  });

  it('canal desligado no interruptor mestre é recusa deliberada, NÃO falha', () => {
    // dispatch.ts:268 empurra `{reason: "channel disabled"}` e :283 grava com prefixo.
    expect(classificaLog({ status: 'failed', channel: 'whatsapp', error: 'skip: channel disabled' })).toBe('recusado');
  });

  it('cliente sem telefone e teto/hora também são recusa deliberada', () => {
    expect(classificaLog({ status: 'failed', channel: 'sms', error: 'skip: customer has no phone' })).toBe('recusado');
    expect(classificaLog({ status: 'failed', channel: 'sms', error: 'skip: bloqueado' })).toBe('recusado');
  });

  it('trava SQL não usa prefixo skip: e ainda assim não é falha de entrega', () => {
    // 20260825180000_teto_notificacao.sql:160 — evento `order_status_teto`, canal '-'.
    expect(classificaLog({
      status: 'failed', channel: '-',
      error: 'teto de 20/hora atingido — notificacoes de status suspensas ate virar a hora',
    })).toBe('sistema');
  });

  it('diagnóstico do b2bwave-sync não é notificação nenhuma', () => {
    // b2bwave-sync/index.ts:1355 e :3106 — canal e destinatário '-'.
    expect(classificaLog({ status: 'failed', channel: '-', error: 'preco em branco na origem' })).toBe('sistema');
    expect(classificaLog({ status: 'failed', channel: '-', error: null })).toBe('sistema');
  });

  it('falha de provider continua sendo falha vermelha', () => {
    expect(classificaLog({ status: 'failed', channel: 'sms', error: 'Twilio: insufficient funds' })).toBe('falhou');
    expect(classificaLog({ status: 'failed', channel: 'email', error: null })).toBe('falhou');
  });

  it('`skip:` vence `channel = "-"`: recusa de config é recusa, não diagnóstico', () => {
    // dispatch.ts:249 grava canal '-' COM prefixo skip:.
    expect(classificaLog({
      status: 'failed', channel: '-',
      error: 'skip: neither notify_admin nor notify_customer is enabled',
    })).toBe('recusado');
  });

  it('a constante do balde é a mesma que a classe `sistema` usa', () => {
    // Se alguém trocar uma e não a outra, a tela filtra por um critério e
    // pinta por outro — que é como o defeito original apareceu.
    expect(classificaLog({ status: 'failed', channel: CANAL_SEM_ENVIO, error: null })).toBe('sistema');
  });
});

describe("falha de infraestrutura nao pode se disfarcar de recusa deliberada", () => {
  // `podeEnviar` falha FECHADO: quando a RPC `envio_permitido` nao responde,
  // NADA e enviado. O motivo vira `skips` e e gravado com o mesmo prefixo `skip:`
  // das recusas de verdade — entao a tela pintava a janela inteira de cinza,
  // dizendo em negrito no cabecalho que nao e avaria. E esses skips nao entram em
  // `failures`, logo `alertAdmin` nunca dispara: a tela era o UNICO sinal.
  //
  // Linhas TRANSCRITAS do backend (`dispatch.ts:42` e `:48`), nao inventadas.
  it("teto que nao pode ser checado e FALHA, nao recusa", () => {
    expect(classificaLog({
      status: "failed", channel: "sms",
      error: "skip: checagem de teto falhou: canceling statement due to statement timeout",
    })).toBe("falhou");
    expect(classificaLog({
      status: "failed", channel: "email",
      error: "skip: checagem de teto indisponivel: fetch failed",
    })).toBe("falhou");
  });

  it("o teto atingido de verdade continua sendo recusa", () => {
    // Esta e a recusa deliberada, e tem que continuar cinza — senao a correcao
    // acima desfaz o defeito que a funcao veio consertar.
    expect(classificaLog({ status: "failed", channel: "sms", error: "skip: bloqueado pelo teto" }))
      .toBe("recusado");
    expect(classificaLog({ status: "failed", channel: "sms", error: "skip: teto por hora atingido" }))
      .toBe("recusado");
    expect(classificaLog({ status: "failed", channel: "sms", error: "skip: channel disabled" }))
      .toBe("recusado");
    expect(classificaLog({ status: "failed", channel: "sms", error: "skip: customer has no phone" }))
      .toBe("recusado");
  });

  it("pane sem canal e FALHA, nao diagnostico de rotina", () => {
    // `dispatch.ts:180` — pane total de notificacao. Ia para a tabela secundaria,
    // teto de 50 linhas, legendada "nao sao notificacao". O comentario no proprio
    // dispatch diz que a linha existe para NAO ficar invisivel na tela.
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "falha ao ler notification_channels: permission denied for table notification_channels",
    })).toBe("falhou");
    // `dispatch.ts:190`, ramo de ERRO do bloqueio por idade — barrou por nao
    // conseguir decidir, e nao porque o pedido era velho.
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — nao foi possivel checar o pedido 1042: statement timeout",
    })).toBe("falhou");
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — numero 1042 corresponde a 2 pedidos — ambiguo",
    })).toBe("falhou");
  });

  it("a barreira de idade funcionando continua sendo diagnostico", () => {
    // Este e o caso legitimo: o pedido E velho, a barreira barrou de proposito.
    // E a trava que sozinha impede o incidente dos 1.508 SMS de se repetir —
    // pinta-la de vermelho todo dia faria o admin parar de olhar.
    //
    // TRANSCRITO de `dispatch.ts:109`. A versao anterior deste assert usava uma
    // frase INVENTADA ("anterior ao corte retroativo") que o backend nunca emite:
    // ele passava por casar a regra velha (`channel === '-'` sem `skip:`), e teria
    // continuado verde mesmo se a classificacao do bloqueio real quebrasse.
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — pedido 1042 tem 173 dias (limite 3) — nada retroativo",
    })).toBe("sistema");
  });
});

describe("os `BLOQUEADO —` indecidiveis tambem sao falha", () => {
  // A lista e da POLITICA, e nao das falhas: motivo indecidivel NOVO nasce
  // vermelho em vez de nascer cinza. Nesta tela o default seguro e aparecer.
  //
  // Todos TRANSCRITOS de `dispatch.ts:74`, `:94`, `:96`, `:105`.
  it("evento de pedido sem order_id e falha, nao rotina", () => {
    // O caso caro: um chamador que pare de passar `order_id` mata TODA
    // notificacao de pedido, para sempre.
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — evento new_order sem order_id — recusado",
    })).toBe("falhou");
  });

  it("pedido que nao deu para verificar e falha", () => {
    for (const motivo of [
      "pedido 1042 nao encontrado — recusado",
      "numero 1042 corresponde a 2 pedidos — ambiguo, recusado",
      "pedido 1042 sem data — recusado",
      "nao foi possivel checar o pedido 1042: statement timeout",
    ]) {
      expect(classificaLog({ status: "failed", channel: "-", error: "BLOQUEADO — " + motivo }))
        .toBe("falhou");
    }
  });

  it("os DOIS desfechos de politica continuam sendo rotina", () => {
    // A barreira de idade e a trava que sozinha impede o incidente dos 1.508 SMS
    // de se repetir. Pinta-la de vermelho todo dia faria o admin parar de olhar.
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — pedido 1042 tem 173 dias (limite 3) — nada retroativo",
    })).toBe("sistema");
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — pedido 1042 marcado como nao-notificavel",
    })).toBe("sistema");
  });

  // Motivo que ninguem classificou tem que cair do lado VISIVEL. Este assert e o
  // que trava a inversao do padrao: com a lista sendo das falhas, um `BLOQUEADO`
  // novo virava cinza em silencio.
  it("um `BLOQUEADO` desconhecido nasce vermelho", () => {
    expect(classificaLog({
      status: "failed", channel: "-",
      error: "BLOQUEADO — motivo que ainda nao existe no backend",
    })).toBe("falhou");
  });
});
