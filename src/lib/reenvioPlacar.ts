/**
 * Classificacao e texto do resultado do "Resend" de pedido.
 *
 * MORA AQUI, e nao dentro da tela, porque a versao que morava la ja mentiu em
 * TRES direcoes e a quarta foi um erro que nenhum teste de fonte podia pegar:
 * `quemIncerto` acabou declarado ACIMA do `incerto` que ele chama, e `const`
 * fica em temporal dead zone ate a propria linha. `tsc` nao reclama (a chamada
 * esta dentro de um callback), o eslint do projeto nao tem `no-use-before-define`
 * e regex sobre o texto-fonte nao ve ordem de declaracao. Em execucao, TODO
 * reenvio lancava `ReferenceError` depois de os e-mails ja terem saido — sem
 * toast, sem log, e com o botao travado ate F5.
 *
 * Funcao pura, exercitada por teste que EXECUTA: e a unica forma de esse tipo de
 * erro aparecer antes do operador.
 */

/** O `send-email` responde `{ skipped: true }` com HTTP 200 e SEM `error` quando
 *  RECUSA o envio (canal desligado, pedido velho demais, teto por hora, envio
 *  pausado). Ler so `error` fazia envio recusado virar "re-sent" na tela. */
export const bloqueado = (r: any) =>
  r?.status === "fulfilled" && r.value?.data?.skipped === true;

/** `invoke` NUNCA rejeita: o catch dele devolve `{data:null, error}`. O
 *  `rejected` fica aqui como cinto — se a lib mudar, nao vira falso sucesso. */
export const falhou = (r: any) =>
  r?.status === "rejected" || !!r?.value?.error || !!r?.value?.data?.error || bloqueado(r);

/** INCERTO nao e "nao foi enviado". Queda de rede depois que o servidor entregou
 *  o e-mail ao provedor vira `FunctionsFetchError` — e o `notification_log` ja
 *  gravou `sent`. Dizer "nothing was sent" ali faz o operador reenviar e o
 *  cliente receber duas confirmacoes; nao ha idempotencia no `send-email`. */
export const incerto = (r: any) =>
  r?.value?.error?.name === "FunctionsFetchError";

export type Placar = {
  total: number;
  foram: number;
  naoForam: any[];
  quemFalhou: string[];
  quemIncerto: string[];
};

/** `results` vem de `Promise.allSettled`, que preserva a ordem de `quem`. */
export function classificaReenvio(results: any[], quem: string[]): Placar {
  const naoForam = results.filter(falhou);
  return {
    total: results.length,
    foram: results.length - naoForam.length,
    naoForam,
    quemFalhou: results.flatMap((r, i) => (falhou(r) ? [quem[i]] : [])),
    // SO quem ficou de fato incerto. Nomear todos os que falharam nesta lista era
    // a mentira ao contrario: com o cliente recusado pelo teto de e-mail e o
    // admin perdido por rede, a tela mandava NAO reenviar por medo de duplicar, e
    // o cliente nunca recebia.
    quemIncerto: results.flatMap((r, i) => (incerto(r) ? [quem[i]] : [])),
  };
}

/** A saida "peca a um admin" SO resolve o interruptor mestre e os `email_on_*`.
 *  Limite de idade, teto por hora e envio pausado nao tem esse conserto — o
 *  admin repetindo leva o mesmo bloqueio, e a frase mandaria o operador atras de
 *  algo que nao existe. */
export const adminResolve = (motivoBloqueio: string | null, msg: string) =>
  !!motivoBloqueio && /master switch|notification.*(disabled|off)/i.test(msg);

export function montaMensagem(p: Placar & { msg: string; pedirAdmin: boolean }): string {
  const placar = p.foram > 0
    ? `Sent ${p.foram} of ${p.total} — failed: ${p.quemFalhou.join(", ")}. `
    // "Nothing was sent" so quando NENHUMA das falhas foi incerta.
    : p.quemIncerto.length ? "" : "Nothing was sent. ";
  const aviso = p.quemIncerto.length
    ? `Could not confirm ${p.quemIncerto.join(", ")} — the email may have gone out. Check the notification log before re-sending. `
    : "";
  return `${placar}${aviso}${p.msg}${p.pedirAdmin ? " — ask an admin to turn the channel on." : ""}`;
}

/** O texto do log de atividade. Ele NAO pode afirmar reenvio que nao houve: ficava
 *  fora do if/else e gravava "Resent order #N confirmation" mesmo com tudo
 *  bloqueado, contradizendo o `notification_log` que o servidor grava com
 *  `failed` no mesmo instante. E o log persiste; o toast some. */
export const textoDoLog = (numero: string, p: Placar) =>
  p.naoForam.length === 0
    ? `Resent order #${numero} confirmation`
    : `Resend order #${numero}: ${p.foram} of ${p.total} sent, failed: ${p.quemFalhou.join(", ")}`;

/**
 * O motivo real de um erro HTTP so existe no CORPO da resposta.
 *
 * Em qualquer status fora de 2xx o functions-js lanca ANTES de ler o corpo e
 * devolve `data: null` — entao `value.data.error` e sempre nulo e sobrava
 * `error.message`, a string fixa "Edge Function returned a non-2xx status code":
 * 403 de permissao, 400 de config e 502 de provedor caido diziam o mesmo.
 *
 * `error.context` e o Response ainda nao lido — e `value.response` e o MESMO
 * objeto, entao o corpo so pode ser lido UMA vez. Para `FunctionsFetchError` o
 * `context` e o erro de fetch cru (um TypeError, sem `.json`), e o teste de tipo
 * corta antes de tocar nele.
 *
 * Nao ha guarda de `bodyUsed`: uma existiu aqui e uma mutacao mostrou que era
 * redundante — `json()` sobre corpo ja consumido rejeita, e o `catch` devolve o
 * mesmo `null`. O `catch` tambem e o que segura o 502 de gateway, que responde
 * HTML em vez de JSON.
 */
export async function motivoHttp(err: any): Promise<string | null> {
  const ctx = err?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const corpo = await ctx.json();
    return typeof corpo?.error === "string" ? corpo.error : null;
  } catch {
    return null;
  }
}
