// notify-dispatch — envia notificações (Email/Resend, SMS/WhatsApp/Twilio).
// Autorização: usuário logado pode disparar um EVENTO (destinatários vêm da
// config/servidor); só ADMIN (ou um X-Cron-Secret válido, p/ forçar) pode disparar
// um TESTE com destino arbitrário.
//
// Body: { event, vars, customer?, test?: { channel, to, message } }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { dispatchEvent, dispatchOne, SUBJECTS } from "../_shared/dispatch.ts";
import { render } from "../_shared/senders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Quem chama? Cron-secret (força, = admin) OU usuário logado.
  let isAdmin = viaCron;
  let callerUserId: string | null = null;
  if (!viaCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);
    callerUserId = user.id;
    const { data: adminRow } = await db.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    isAdmin = !!adminRow;
  }

  try {
    const body = await req.json();
    const { event, vars = {}, customer, test } = body ?? {};

    // ---- Teste (admin ou cron-secret; destino arbitrário) -----------------
    if (test?.channel && test?.to) {
      if (!isAdmin) return json({ error: "Only admins can send test notifications" }, 403);
      const { data: channels } = await db.from("notification_channels").select("*");
      const ch = Object.fromEntries((channels ?? []).map((c) => [c.id, c]));
      const result = await dispatchOne(
        test.channel, test.to,
        SUBJECTS[event] ?? "Teste de notificação",
        render(String(test.message ?? "Mensagem de teste."), vars), ch,
      );
      await db.from("notification_log").insert({
        event: event ?? "test", channel: test.channel, recipient: test.to,
        status: result.ok ? "sent" : "failed", error: result.error ?? null, payload: vars,
      });
      return json({ ok: result.ok, error: result.error });
    }

    // ---- Evento (qualquer logado/cron; destinatários vêm da config) -------
    if (!event) return json({ error: "Missing 'event'" }, 400);
    // SEGURANÇA: chamador não-admin NÃO escolhe o destino. Ignora o `customer`
    // do body e usa o cliente do próprio usuário logado (evita SMS/email pra
    // número/endereço arbitrário = fraude de toll). Admin/cron mantêm o controle.
    let safeCustomer = customer;
    if (!isAdmin && !viaCron) {
      safeCustomer = undefined;
      if (callerUserId) {
        const { data: ownCli } = await db.from("clientes")
          .select("email, telefone").eq("user_id", callerUserId).maybeSingle();
        if (ownCli) safeCustomer = { email: ownCli.email, phone: ownCli.telefone, whatsapp: ownCli.telefone };
      }
    }
    const r = await dispatchEvent(db, event, vars, safeCustomer);
    return json(r);
  } catch (e) {
    console.error("notify-dispatch error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
