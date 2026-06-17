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

export async function dispatchEvent(db: Db, event: string, vars: Record<string, unknown>, customer?: Record<string, unknown>) {
  const { data: channels } = await db.from("notification_channels").select("*");
  const ch = Object.fromEntries((channels ?? []).map((c: any) => [c.id, c]));

  const { data: evt } = await db.from("notification_events").select("*").eq("id", event).maybeSingle();
  if (!evt || !evt.enabled) return { ok: true, sent: 0, results: [] };

  const targets: Array<{ channel: string; to: string }> = [];
  const chans: string[] = evt.channels ?? [];

  if (evt.notify_admin) {
    const { data: recips } = await db.from("notification_recipients").select("*").eq("active", true);
    for (const r of recips ?? []) {
      if (chans.includes("email") && r.email) targets.push({ channel: "email", to: r.email });
      if (chans.includes("sms") && r.phone) targets.push({ channel: "sms", to: r.phone });
      if (chans.includes("whatsapp") && r.whatsapp) targets.push({ channel: "whatsapp", to: r.whatsapp });
    }
  }
  if (evt.notify_customer && customer) {
    if (chans.includes("email") && customer.email) targets.push({ channel: "email", to: String(customer.email) });
    if (chans.includes("sms") && customer.phone) targets.push({ channel: "sms", to: String(customer.phone) });
    if (chans.includes("whatsapp") && customer.whatsapp) targets.push({ channel: "whatsapp", to: String(customer.whatsapp) });
  }

  const subject = SUBJECTS[event] ?? "Notificação";
  const results: any[] = [];
  for (const t of targets) {
    if (!ch[t.channel]?.enabled) { results.push({ ...t, ok: false, error: "channel disabled" }); continue; }
    const template = t.channel === "email" ? evt.template_email
      : t.channel === "sms" ? evt.template_sms : evt.template_whatsapp;
    const result = await dispatchOne(t.channel, t.to, subject, render(template, vars), ch);
    await logRow(db, event, t.channel, t.to, result, vars);
    results.push({ ...t, ok: result.ok, error: result.error });
  }
  return { ok: true, sent: results.filter((r) => r.ok).length, results };
}

export { SUBJECTS };
