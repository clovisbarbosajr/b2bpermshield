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
