// Núcleo de envio (inline). Lê config do admin, renderiza template, envia por
// cada canal habilitado e registra em notification_log.
import { render, sendEmail, sendSms, sendWhatsapp } from "./senders.ts";

const SUBJECTS: Record<string, string> = {
  new_order: "Novo pedido recebido",
  order_status: "Atualização do seu pedido",
  new_customer: "Novo cadastro de cliente",
  account_approved: "Conta aprovada",
  low_stock: "Alerta de estoque baixo",
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
  const { data: cfg } = await db.from("configuracoes").select("email_new_orders, email_contato").limit(1).maybeSingle();
  const adminEmail = cfg?.email_new_orders || cfg?.email_contato || "";
  if (!adminEmail) return;
  const orderId = (vars as any)?.order_id ?? "";
  const html =
    `<p>O evento <b>${event}</b>${orderId ? ` (pedido #${orderId})` : ""} foi processado, mas o envio de uma notificação FALHOU:</p>` +
    `<ul>${failures.map((f) => `<li>${f}</li>`).join("")}</ul>` +
    `<p>A ação NÃO foi perdida — só a notificação. Verifique: créditos do Twilio, chave do Resend, ou contato do cliente.</p>`;
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    },
    body: JSON.stringify({ type: "admin_alert", adminEmail, subject: `⚠ Falha de notificação — ${event}${orderId ? ` (pedido #${orderId})` : ""}`, html }),
  });
}

export async function dispatchEvent(db: Db, event: string, vars: Record<string, unknown>, customer?: Record<string, unknown>) {
  const { data: channels } = await db.from("notification_channels").select("*");
  const ch = Object.fromEntries((channels ?? []).map((c: any) => [c.id, c]));

  const { data: evt } = await db.from("notification_events").select("*").eq("id", event).maybeSingle();
  if (!evt || !evt.enabled) return { ok: true, sent: 0, results: [], problems: [] };

  const targets: Array<{ channel: string; to: string }> = [];
  const skips: Array<{ channel: string; who: string; reason: string }> = [];
  const chans: string[] = evt.channels ?? [];

  if (evt.notify_admin) {
    const { data: recips } = await db.from("notification_recipients").select("*").eq("active", true);
    for (const r of recips ?? []) {
      if (chans.includes("email")) r.email ? targets.push({ channel: "email", to: r.email }) : skips.push({ channel: "email", who: "admin", reason: "destinatário sem email" });
      if (chans.includes("sms")) r.phone ? targets.push({ channel: "sms", to: r.phone }) : skips.push({ channel: "sms", who: "admin", reason: "destinatário sem telefone" });
      if (chans.includes("whatsapp") && r.whatsapp) targets.push({ channel: "whatsapp", to: r.whatsapp });
    }
  }
  if (evt.notify_customer && customer) {
    if (chans.includes("email")) customer.email ? targets.push({ channel: "email", to: String(customer.email) }) : skips.push({ channel: "email", who: "cliente", reason: "cliente sem email" });
    if (chans.includes("sms")) customer.phone ? targets.push({ channel: "sms", to: String(customer.phone) }) : skips.push({ channel: "sms", who: "cliente", reason: "cliente sem telefone" });
    if (chans.includes("whatsapp") && customer.whatsapp) targets.push({ channel: "whatsapp", to: String(customer.whatsapp) });
  }

  const subject = SUBJECTS[event] ?? "Notificação";
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
