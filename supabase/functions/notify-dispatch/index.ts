// notify-dispatch — envia notificações (Email/Resend, SMS/WhatsApp/Twilio).
// Chamado pelos gatilhos do app (novo pedido, status, etc.) e pelo "enviar teste"
// do admin. Segue o modelo do send-email do permshield: qualquer usuário logado
// pode disparar um EVENTO (destinatários vêm da config/servidor); só ADMIN pode
// disparar um TESTE com destino arbitrário.
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

  const authHeader = req.headers.get("Authorization") ?? "";
  // Usuário logado (qualquer um). Anônimo é barrado pelo verify_jwt no gateway.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Authentication required" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Admin? (reusa user_roles do permshield)
  const { data: adminRow } = await db.from("user_roles")
    .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  const isAdmin = !!adminRow;

  try {
    const body = await req.json();
    const { event, vars = {}, customer, test } = body ?? {};

    // ---- Teste (só admin, destino arbitrário) -----------------------------
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

    // ---- Evento (qualquer logado; destinatários vêm da config/servidor) ----
    if (!event) return json({ error: "Missing 'event'" }, 400);
    const r = await dispatchEvent(db, event, vars, customer);
    return json(r);
  } catch (e) {
    console.error("notify-dispatch error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
