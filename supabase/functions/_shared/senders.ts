// Channel senders. Secrets come from Edge Function env (never the database).
export interface SendResult { ok: boolean; error?: string }

// ---- Email via Resend -------------------------------------------------------
export async function sendEmail(to: string, subject: string, text: string, from: string): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
  return { ok: true };
}

// ---- Twilio (SMS + WhatsApp) ------------------------------------------------
async function twilioSend(to: string, from: string, body: string): Promise<SendResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, error: "TWILIO_ACCOUNT_SID/AUTH_TOKEN not set" };
  if (!from) return { ok: false, error: "Twilio 'from' number not configured" };
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${await res.text()}` };
  return { ok: true };
}

export function sendSms(to: string, body: string, fromNumber: string): Promise<SendResult> {
  return twilioSend(to, fromNumber, body);
}
export function sendWhatsapp(to: string, body: string, fromNumber: string): Promise<SendResult> {
  const wTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const wFrom = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;
  return twilioSend(wTo, wFrom, body);
}

// ---- Template rendering: {key} -> vars[key] --------------------------------
export function render(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : "");
}
