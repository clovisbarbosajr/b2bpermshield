// `notification_log.status` só tem DOIS valores em todo o backend: "sent" e
// "failed" (`_shared/dispatch.ts:118`, e o default da coluna em
// `20260617210000_notifications_system.sql:88`). Isso faz "failed" carregar
// TRÊS coisas semanticamente opostas, e a tela lia as três como avaria:
//
//  1. recusa DELIBERADA do dispatch — canal desligado no interruptor mestre,
//     teto/hora atingido, cliente sem telefone. Vai com prefixo `skip:` no
//     `error` (`dispatch.ts:283`, e o de config em `:249`).
//  2. trava SQL e diagnóstico de sync — `order_status_teto`, `low_stock_lote`,
//     `preco_em_branco_na_origem`, `pedido_fantasma_apagado`... Essas NÃO usam
//     o prefixo `skip:`; o que todas têm em comum é `channel = '-'`, porque
//     nunca houve canal nem destinatário (não é tentativa de entrega nenhuma).
//  3. falha de verdade — Twilio sem crédito, Resend recusando.
//
// Com a política SMS-only vigente (WhatsApp desligado) e a torneira fechada,
// QUASE TODA linha é (1) ou (2): a tela pintava centenas de badges vermelhos
// "falhou" para o sistema se comportando exatamente como mandado, na mesma
// tela onde se decide se um envio precisa ser refeito.
export type ClasseLog = 'enviado' | 'recusado' | 'sistema' | 'falhou';

export function classificaLog(l: { status: string; channel: string; error: string | null }): ClasseLog {
  if (l.status === 'sent') return 'enviado';
  if (l.error?.startsWith('skip:')) return 'recusado';
  if (l.channel === '-') return 'sistema';
  return 'falhou';
}

// A separação de baldes usa a MESMA regra da classe `sistema`: `channel = '-'`
// é linha que nunca foi tentativa de entrega. Sem isso o `.limit(200)` não
// distingue, e uma rodada de sync com 300 diagnósticos (`b2bwave-sync` grava
// um por pedido fantasma apagado, `index.ts:3106`) expulsa TODOS os envios
// reais da janela — sob um cabeçalho que diz "Últimos 200 envios".
export const CANAL_SEM_ENVIO = '-';
