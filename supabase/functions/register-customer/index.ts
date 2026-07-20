// register-customer — cria a ficha PENDENTE em `clientes` no AUTO-CADASTRO
// (Cadastro.tsx), pra o admin ver/aprovar o cadastro SEM esperar o 1º login.
//
// Por que não no trigger handle_new_user: aquele trigger roda pra TODO auth user
// (inclusive staff via admin-create-user e sub-clientes via company-member) e
// criar clientes lá duplicava/gerava o bug "Nextgen". Esta função é chamada SÓ
// pelo fluxo de auto-cadastro do cliente — nunca por staff/sub.
//
// Segurança: service role. Verifica que o auth user REALMENTE existe com esse
// email (não cria ficha pra email aleatório). Cria só status 'pendente' (sem
// acesso até o admin aprovar). Se já existe ficha com o email (migrado) ou pelo
// user_id, apenas VINCULA / não duplica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { email, nome, empresa } = await req.json();
    const emailLc = String(email ?? "").trim().toLowerCase();
    if (!emailLc || !emailLc.includes("@")) return json({ error: "valid email required" }, 400);

    // 1) O auth user com esse email existe? (senão não cria ficha pra email aleatório)
    const { data: uid } = await db.rpc("auth_user_id_by_email", { _email: emailLc });
    if (!uid) return json({ ok: true, skipped: "no auth user yet" });

    // 2) Staff nunca vira cliente.
    const { data: staff } = await db.rpc("is_staff_login", { _user_id: uid });
    if (staff) return json({ ok: true, skipped: "staff login" });

    // 3) Já existe ficha? (por user_id ou por email de cliente migrado) → vincula, não duplica.
    const { data: byUser } = await db.from("clientes").select("id").eq("user_id", uid).limit(1).maybeSingle();
    if (byUser) return json({ ok: true, existing: true });

    const { data: byEmail } = await db.from("clientes").select("id, user_id").ilike("email", emailLc).limit(1).maybeSingle();
    if (byEmail) {
      if (!byEmail.user_id) await db.from("clientes").update({ user_id: uid }).eq("id", byEmail.id).is("user_id", null);
      return json({ ok: true, linked: true });
    }

    // 4) Cria a ficha PENDENTE (sem acesso até aprovação).
    const { data: created, error } = await db.from("clientes").insert({
      user_id: uid, nome: nome || emailLc, email: emailLc, empresa: empresa || "",
      status: "pendente", is_active: true, can_confirm_order: false, parent_customer_id: null,
    }).select("id").single();
    if (error) return json({ error: error.message }, 400);

    // 5) SMS/notificação new_customer pro admin — do SERVIDOR (o cliente ainda não
    // tem sessão no signup, então o frontend não consegue chamar o notify-dispatch,
    // que exige usuário logado; aqui usamos o x-cron-secret).
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": Deno.env.get("CRON_SECRET") ?? "",
          "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
        },
        body: JSON.stringify({
          event: "new_customer",
          vars: { customer_name: nome || "", customer_company: empresa || "", customer_email: emailLc, customer_phone: "" },
        }),
      });
    } catch (_e) { /* não bloqueia o cadastro */ }

    return json({ ok: true, created: created.id });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
