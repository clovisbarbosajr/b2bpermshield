// ============================================================================
// ATENCAO: tudo aqui gasta dinheiro do dono (Twilio por SMS, Resend por e-mail).
//
// Antes de mexer, leia o cabecalho de `b2bwave-sync/index.ts`: em 25/ago/2026
// uma reconciliacao em massa disparou 1281 SMS e centenas de e-mails de alerta
// numa hora. Regra que saiu dali: NENHUM caminho que possa rodar em lote pode
// enviar sem teto.
// ============================================================================

// Núcleo de envio (inline). Lê config do admin, renderiza template, envia por
// cada canal habilitado e registra em notification_log.
import { render, sendEmail, sendSms, sendWhatsapp } from "./senders.ts";

const SUBJECTS: Record<string, string> = {
  new_order: "New order received",
  order_status: "Your order was updated",
  new_customer: "New customer registration",
  account_approved: "Account approved",
  low_stock: "Low stock alert",
};

// deno-lint-ignore no-explicit-any
type Db = any;

export async function dispatchOne(channel: string, to: string, subject: string, message: string, ch: Record<string, any>) {
  switch (channel) {
    case "email": return sendEmail(to, subject, message, ch.email?.config?.from ?? "B2B <onboarding@resend.dev>");
    case "sms": return sendSms(to, message, ch.sms?.config?.from_number ?? "");
    case "whatsapp": return sendWhatsapp(to, message, ch.whatsapp?.config?.from_number ?? "");
    default: return { ok: false, error: `Unknown channel '${channel}'` };
  }
}

// TORNEIRA + TETO. Consultado antes de CADA envio, sem excecao e sem bypass.
//
// Falha FECHADO: se a RPC nao responder, NAO envia. Depois de 25/ago a ordem de
// prioridade e essa — melhor uma notificacao perdida do que mil disparadas.
async function podeEnviar(db: Db, canal: string): Promise<{ ok: boolean; motivo?: string }> {
  const c = canal === "email" ? "email" : "sms";
  try {
    const { data, error } = await db.rpc("envio_permitido", { _canal: c });
    if (error) return { ok: false, motivo: "checagem de teto falhou: " + error.message };
    if (!data || (data as any).ok !== true) {
      return { ok: false, motivo: (data as any)?.motivo ?? "bloqueado pelo teto" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "checagem de teto indisponivel: " + String((e as any)?.message ?? e) };
  }
}

async function logRow(db: Db, event: string, channel: string, recipient: string,
  result: { ok: boolean; error?: string }, vars: Record<string, unknown>) {
  await db.from("notification_log").insert({
    event, channel, recipient,
    status: result.ok ? "sent" : "failed",
    error: result.error ?? null, payload: vars,
  });
}

// Alerta o ADMIN por EMAIL quando uma notificação falha (ex.: Twilio sem créditos).
// Vai pelo send-email (Resend primário + Office365 fallback) p/ chegar mesmo se o
// SMS/Twilio estiver fora. Nunca derruba o fluxo (o chamador faz try/catch).
async function alertAdmin(db: Db, event: string, vars: Record<string, unknown>, failures: string[]) {
  // TETO. Este alerta sai UMA VEZ POR FALHA, e falha vem em lote: no incidente de
  // 25/ago foram 227 SMS falhados, ou seja, ate 227 e-mails para o MESMO endereco
  // em poucos minutos. Alerta que chega 227 vezes nao e alerta — e o que congela
  // a fila do servidor de e-mail e faz o admin ignorar o aviso de verdade.
  //
  // 5 por hora e suficiente: o objetivo e avisar QUE esta falhando, nao listar
  // cada ocorrencia. O detalhe completo esta no Notifications Log.
  try {
    const { data: n } = await db.rpc("bump_notify_counter", { _chave: "admin_alert_counter" });
    if (typeof n === "number" && n > 5) return;
  } catch {
    // RPC ausente (SQL nao rodado): segue sem teto, como era antes.
  }
  const { data: cfg } = await db.from("configuracoes").select("email_new_orders, email_contato").limit(1).maybeSingle();
  const adminEmail = cfg?.email_new_orders || cfg?.email_contato || "";
  if (!adminEmail) return;
  const orderId = (vars as any)?.order_id ?? "";
  const html =
    `<p>The event <b>${event}</b>${orderId ? ` (order #${orderId})` : ""} was processed, but a notification FAILED to send:</p>` +
    `<ul>${failures.map((f) => `<li>${f}</li>`).join("")}</ul>` +
    `<p>The action itself was NOT lost — only the notification. Check: Twilio credits, Resend API key, or the customer contact info.</p>`;
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    },
    body: JSON.stringify({ type: "admin_alert", adminEmail, subject: `⚠ Notification failure — ${event}${orderId ? ` (order #${orderId})` : ""}`, html }),
  });
}

export async function dispatchEvent(db: Db, event: string, vars: Record<string, unknown>, customer?: Record<string, unknown>) {
  // Erro aqui NAO pode ser tratado como "nenhum canal ligado": com `ch = {}`
  // todo destino cai em "channel disabled", que por decisao e SKIP e nao
  // FAILURE — entao `failures` fica vazio, o alerta ao admin nao dispara, e a
  // funcao devolve ok:true/sent:0. Ou seja, ninguem receberia nada e ninguem
  // seria avisado, com o canal visivelmente ligado na tela.
  const { data: channels, error: chErr } = await db.from("notification_channels").select("*");
  if (chErr) {
    // Deixa rastro ANTES de lancar. Este era o unico caminho de nao-envio sem
    // registro no Notifications Log — e o throw vira 500, que TODOS os chamadores
    // do front engolem com `.catch(() => {})`. Sem esta linha, a falha total de
    // notificacao ficava invisivel na tela E no log.
    // Em try/catch proprio: se o banco esta fora, gravar o log tambem falha, e
    // nesse caso o que importa e o throw abaixo, nao o log.
    try {
      await logRow(db, event, "-", "-", { ok: false, error: "falha ao ler notification_channels: " + chErr.message }, vars);
    } catch { /* banco fora: segue pro throw */ }
    throw new Error("falha ao ler notification_channels: " + chErr.message);
  }
  const ch = Object.fromEntries((channels ?? []).map((c: any) => [c.id, c]));

  const { data: evt } = await db.from("notification_events").select("*").eq("id", event).maybeSingle();

  // OBSERVABILIDADE: todo NÃO-envio precisa deixar rastro no log — antes esses
  // returns/skips sumiam e em produção não dava pra saber o motivo da falha.
  if (!evt) {
    await logRow(db, event, "-", "-", { ok: false, error: "skip: event not found in notification_events" }, vars);
    return { ok: true, sent: 0, results: [], problems: ["event not found"] };
  }
  if (!evt.enabled) {
    await logRow(db, event, "-", "-", { ok: false, error: "skip: event disabled (enabled=false)" }, vars);
    return { ok: true, sent: 0, results: [], problems: ["event disabled"] };
  }

  const targets: Array<{ channel: string; to: string }> = [];
  const skips: Array<{ channel: string; who: string; reason: string }> = [];
  const chans: string[] = evt.channels ?? [];

  if ((chans ?? []).length === 0) {
    await logRow(db, event, "-", "-", { ok: false, error: "skip: event has no channels selected" }, vars);
  }

  if (evt.notify_admin) {
    const { data: recips } = await db.from("notification_recipients").select("*").eq("active", true);
    if (!recips || recips.length === 0) {
      await logRow(db, event, "-", "(admin)", { ok: false, error: "skip: notify_admin on but no ACTIVE recipients configured" }, vars);
    }
    for (const r of recips ?? []) {
      if (chans.includes("email")) r.email ? targets.push({ channel: "email", to: r.email }) : skips.push({ channel: "email", who: "admin", reason: "recipient has no email" });
      if (chans.includes("sms")) r.phone ? targets.push({ channel: "sms", to: r.phone }) : skips.push({ channel: "sms", who: "admin", reason: "recipient has no phone" });
      if (chans.includes("whatsapp") && r.whatsapp) targets.push({ channel: "whatsapp", to: r.whatsapp });
    }
  }
  if (evt.notify_customer) {
    if (!customer) {
      await logRow(db, event, "-", "(customer)", { ok: false, error: "skip: notify_customer on but no customer data passed to this event" }, vars);
    } else {
      if (chans.includes("email")) customer.email ? targets.push({ channel: "email", to: String(customer.email) }) : skips.push({ channel: "email", who: "customer", reason: "customer has no email" });
      if (chans.includes("sms")) customer.phone ? targets.push({ channel: "sms", to: String(customer.phone) }) : skips.push({ channel: "sms", who: "customer", reason: "customer has no phone" });
      if (chans.includes("whatsapp") && customer.whatsapp) targets.push({ channel: "whatsapp", to: String(customer.whatsapp) });
    }
  }

  if (!evt.notify_admin && !evt.notify_customer) {
    await logRow(db, event, "-", "-", { ok: false, error: "skip: neither notify_admin nor notify_customer is enabled" }, vars);
  }

  const subject = SUBJECTS[event] ?? "Notification";
  const results: any[] = [];
  const failures: string[] = [];
  for (const t of targets) {
    if (!ch[t.channel]?.enabled) {
      // Canal desligado DE PROPÓSITO (interruptor mestre na UI) = SKIP, não falha.
      // Antes era failure → alertAdmin mandava UM EMAIL POR EVENTO avisando
      // "canal desligado" — exatamente o que o admin quis silenciar ao desligar.
      // (O loop de skips abaixo já registra no notification_log.)
      results.push({ ...t, ok: false, error: "channel disabled" });
      skips.push({ channel: t.channel, who: t.to, reason: "channel disabled" });
      continue;
    }
    // TORNEIRA + TETO, imediatamente antes de gastar. Nao ha caminho que pule
    // isto: vale para qualquer evento, qualquer canal, qualquer destinatario.
    const permissao = await podeEnviar(db, t.channel);
    if (!permissao.ok) {
      results.push({ ...t, ok: false, error: permissao.motivo });
      skips.push({ channel: t.channel, who: t.to, reason: permissao.motivo ?? "bloqueado" });
      continue;
    }
    const template = t.channel === "email" ? evt.template_email
      : t.channel === "sms" ? evt.template_sms : evt.template_whatsapp;
    const result = await dispatchOne(t.channel, t.to, subject, render(template, vars), ch);
    await logRow(db, event, t.channel, t.to, result, vars);
    results.push({ ...t, ok: result.ok, error: result.error });
    if (!result.ok) failures.push(`${t.channel} → ${t.to}: ${result.error}`);
  }

  // Loga os SKIPS (contato faltando) — antes sumiam sem rastro nenhum.
  for (const s of skips) {
    await logRow(db, event, s.channel, `(${s.who})`, { ok: false, error: `skip: ${s.reason}` }, vars);
  }

  // Só FALHA real de provider (ex.: Twilio/Resend com erro) alerta o admin por email.
  // "Cliente sem telefone" e "canal desligado de propósito" ficam só no log
  // (senão spamaria a cada pedido / anularia o interruptor mestre).
  if (failures.length > 0) {
    try { await alertAdmin(db, event, vars, failures); } catch (_e) { /* alerta nunca derruba o fluxo */ }
  }

  const problems = [...failures, ...skips.map((s) => `${s.channel} (${s.who}): ${s.reason}`)];
  return { ok: true, sent: results.filter((r) => r.ok).length, results, problems };
}

export { SUBJECTS };
