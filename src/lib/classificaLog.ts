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

// NEM TODO `skip:` É RECUSA DELIBERADA — e confundir os dois é pior do que o
// defeito que esta função veio consertar.
//
// `podeEnviar` (`dispatch.ts:39-50`) falha FECHADO por decisão: quando a RPC
// `envio_permitido` não responde, NADA é enviado. O motivo dessa falha vira
// `skips` (`dispatch.ts:270`) e é gravado com o mesmo prefixo `skip:` das
// recusas de verdade (`dispatch.ts:283`).
//
// Ou seja: um statement timeout durante uma rodada de sync, o pool saturado, ou
// uma regressão de GRANT derrubam a notificação INTEIRA — e a tela pintava a
// janela toda de cinza dizendo, em negrito no cabeçalho, que não é avaria. E
// esses skips não entram em `failures` (`dispatch.ts:278`), então `alertAdmin`
// nunca dispara para eles: a tela era o ÚNICO sinal.
//
// Transcritos do backend, não inventados — mesmo critério do resto do arquivo.
const FALHA_DISFARCADA_DE_SKIP = [
  'skip: checagem de teto falhou:',      // dispatch.ts:42 — a RPC devolveu erro
  'skip: checagem de teto indisponivel:', // dispatch.ts:48 — a RPC nem respondeu
];

// Linhas de `channel = '-'` que são PANE, e não diagnóstico de rotina. Sem isto
// elas caíam em `sistema` e iam para a tabela secundária, teto de 50 linhas,
// legendada "não são notificação".
const PANE_SEM_CANAL = [
  // `dispatch.ts:180` — não deu para ler `notification_channels`. É pane total, e
  // o comentário no próprio dispatch diz que a linha existe justamente para que
  // ela NÃO fique invisível na tela.
  'falha ao ler notification_channels:',
  // `dispatch.ts:190`, ramo de erro do `bloqueioPorIdade`: "nao foi possivel
  // checar o pedido X" e "numero X corresponde a N pedidos — ambiguo". A barreira
  // barrou por não conseguir decidir, não porque o pedido era velho.
  'BLOQUEADO — nao foi possivel checar',
  'BLOQUEADO — numero',
];

export function classificaLog(l: { status: string; channel: string; error: string | null }): ClasseLog {
  if (l.status === 'sent') return 'enviado';
  const err = l.error ?? '';
  // ANTES do teste de `skip:`: estas linhas TÊM o prefixo, e é exatamente por
  // isso que passavam por recusa deliberada.
  if (FALHA_DISFARCADA_DE_SKIP.some((p) => err.startsWith(p))) return 'falhou';
  if (PANE_SEM_CANAL.some((p) => err.startsWith(p))) return 'falhou';
  if (err.startsWith('skip:')) return 'recusado';
  if (l.channel === '-') return 'sistema';
  return 'falhou';
}

// A separação de baldes é por `channel = '-'`, e é PARECIDA com a classe
// `sistema`, não idêntica: a classe exige `channel = '-'` E ausência de `skip:`
// (e agora também não ser uma das panes acima). Uma recusa de configuração é
// gravada com canal `'-'` e cai no balde de sistema mesmo classificando como
// `recusado` — é o motivo de o cabeçalho da segunda tabela não poder dizer que
// ali "não são notificação".
//
// Sem a separação, o `.limit(200)` não distingue, e uma rodada de sync com 300
// diagnósticos (`b2bwave-sync` grava um por pedido fantasma apagado,
// `index.ts:3106`) expulsa TODOS os envios reais da janela — sob um cabeçalho
// que diz "Últimos 200 envios".
export const CANAL_SEM_ENVIO = '-';
