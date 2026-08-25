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
  // `isStaff` e SEPARADO de `isAdmin` de proposito. As telas que disparam evento
  // (/admin/orders/:id e /admin/customers/:id) sao `requiredRole="staff"`, ou
  // seja, manager e warehouse tambem entram e tambem salvam status/aprovam
  // cliente. Se o portao de EVENTO exigisse admin, o Save de um manager tomaria
  // 403 — e o front chama com `.catch(() => {})`, entao ninguem veria o erro:
  // o cliente simplesmente deixaria de ser avisado. O gate de TESTE (destino
  // arbitrario) continua exigindo admin.
  let isStaff = viaCron;
  let callerUserId: string | null = null;
  if (!viaCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);
    callerUserId = user.id;
    const { data: papeis } = await db.from("user_roles")
      .select("role").eq("user_id", user.id);
    const meus = new Set((papeis ?? []).map((r: any) => r.role));
    isAdmin = meus.has("admin");
    isStaff = isAdmin || meus.has("manager") || meus.has("warehouse");
  }

  try {
    const body = await req.json();
    const { event, vars = {}, customer, test } = body ?? {};

    // ---- Teste (admin ou cron-secret; destino arbitrário) -----------------
    if (test?.channel && test?.to) {
      if (!isAdmin) return json({ error: "Only admins can send test notifications" }, 403);
      // O teste tambem respeita a TORNEIRA. Era o unico caminho que chamava
      // `dispatchOne` direto, fora do portao — com os envios pausados, o SMS de
      // teste ainda saia. E pouco dinheiro, mas "sem bypass" tem que ser
      // verdade, senao a torneira nao e confiavel.
      const { data: perm } = await db.rpc("envio_permitido", { _canal: test.channel === "email" ? "email" : "sms" });
      if (!perm || (perm as any).ok !== true) {
        return json({ ok: false, blocked: true, reason: (perm as any)?.motivo ?? "bloqueado pelo teto" });
      }
      const { data: channels } = await db.from("notification_channels").select("*");
      const ch = Object.fromEntries((channels ?? []).map((c) => [c.id, c]));
      const result = await dispatchOne(
        test.channel, test.to,
        SUBJECTS[event] ?? "Test notification",
        render(String(test.message ?? "Test message."), vars), ch,
      );
      await db.from("notification_log").insert({
        event: event ?? "test", channel: test.channel, recipient: test.to,
        status: result.ok ? "sent" : "failed", error: result.error ?? null, payload: vars,
      });
      return json({ ok: result.ok, error: result.error });
    }

    // ---- Evento (destinatários vêm da config) -----------------------------
    if (!event) return json({ error: "Missing 'event'" }, 400);

    // QUAIS eventos um não-admin pode disparar.
    //
    // A proteção de destinatário abaixo já impedia mandar SMS pra número
    // arbitrário, mas o EVENTO em si era livre: qualquer sessão autenticada — e o
    // cadastro é aberto — podia disparar quantos "new_order" quisesse, com os
    // `vars` que quisesse, direto pros `notification_recipients` do admin. Isso
    // queima crédito Twilio e afoga o alerta real no meio do lixo.
    //
    // Só o Checkout do cliente dispara evento sem ser admin, e só `new_order`
    // (as outras chamadas — account_approved, order_status, testes — vêm de telas
    // de admin).
    const EVENTOS_DO_CLIENTE = new Set(["new_order"]);
    if (!isStaff && !viaCron) {
      if (!EVENTOS_DO_CLIENTE.has(String(event))) {
        return json({ error: "Not authorized for this event" }, 403);
      }
      // O pedido citado precisa EXISTIR. Sem isto dava pra repetir a chamada à
      // vontade inventando número; com isto, cada alerta corresponde a um pedido
      // real no banco.
      //
      // Fail-open de propósito quando NÃO dá pra resolver a ficha do chamador:
      // parte da base é migrada e nem toda ficha está ligada a um login. Bloquear
      // aí faria o admin PARAR de receber aviso de pedido novo — pior que o spam
      // que estamos evitando. Se a ficha resolve e o pedido é de OUTRO cliente, aí
      // sim recusa.
      const ref = String((vars as any)?.order_id ?? "").trim();
      if (!ref) return json({ error: "Missing 'vars.order_id'" }, 400);
      const numero = /^\d+$/.test(ref) ? Number(ref) : null;
      const q = db.from("pedidos").select("id, cliente_id").limit(1);
      const { data: ped } = numero !== null
        ? await q.eq("numero", numero).maybeSingle()
        : await q.eq("id", ref).maybeSingle();
      if (!ped) return json({ error: "Unknown order" }, 403);

      if (callerUserId) {
        const { data: minhaFicha } = await db.from("clientes")
          .select("id").eq("user_id", callerUserId).maybeSingle();
        if (minhaFicha && ped.cliente_id && minhaFicha.id !== ped.cliente_id) {
          return json({ error: "Order does not belong to caller" }, 403);
        }
      }
    }
    // SEGURANÇA: chamador não-admin NÃO escolhe o destino. Ignora o `customer`
    // do body e usa o cliente do próprio usuário logado (evita SMS/email pra
    // número/endereço arbitrário = fraude de toll). Admin/cron mantêm o controle.
    let safeCustomer = customer;
    if (!isStaff && !viaCron) {
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
