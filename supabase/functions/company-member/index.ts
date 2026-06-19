// company-member — o CLIENTE (dono da conta) ou um CONTATO 'manager' gerencia os
// funcionários (sub-logins) da própria empresa: criar / atualizar papel / desativar.
// Cada funcionário herda o acesso da empresa (mesmo price list / privacidade), via
// company_contacts.cliente_id. Permissões por papel:
//   buyer   = pode finalizar pedido      (is_company_buyer = true)
//   viewer  = só visualiza, NÃO finaliza
//   manager = finaliza + gerencia a equipe
// Roda com service_role (cria auth user), mas valida que o chamador é dono/manager.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["buyer", "viewer", "manager"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("authorization") ?? "";

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    // Resolve a EMPRESA que o chamador gerencia: dono da conta (clientes.user_id) OU contato 'manager'.
    let companyId: string | null = null;
    const { data: ownCliente } = await db.from("clientes").select("id").eq("user_id", caller.id).maybeSingle();
    if (ownCliente) companyId = ownCliente.id;
    if (!companyId) {
      const { data: mgr } = await db.from("company_contacts")
        .select("cliente_id, role").eq("user_id", caller.id).eq("ativo", true).eq("role", "manager").maybeSingle();
      if (mgr) companyId = mgr.cliente_id;
    }
    if (!companyId) return json({ error: "Only the account owner or a manager can manage the team" }, 403);

    const body = await req.json();
    const action = body.action || "create";

    // ── Listar a equipe da empresa ──
    if (action === "list") {
      const { data } = await db.from("company_contacts")
        .select("id, nome, email, role, ativo, created_at").eq("cliente_id", companyId).order("created_at");
      return json({ members: data ?? [] });
    }

    // ── Atualizar papel / ativo ──
    if (action === "update") {
      const { contact_id, role, ativo } = body;
      if (!contact_id) return json({ error: "contact_id required" }, 400);
      const patch: any = {};
      if (role && ROLES.includes(role)) patch.role = role;
      if (typeof ativo === "boolean") patch.ativo = ativo;
      const { error } = await db.from("company_contacts").update(patch).eq("id", contact_id).eq("cliente_id", companyId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ── Remover (desativa o contato; mantém o login pra histórico) ──
    if (action === "delete") {
      const { contact_id } = body;
      if (!contact_id) return json({ error: "contact_id required" }, 400);
      const { error } = await db.from("company_contacts").update({ ativo: false }).eq("id", contact_id).eq("cliente_id", companyId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ── Criar funcionário (sub-login) ──
    const { email, nome, role } = body;
    if (!email || typeof email !== "string" || !email.includes("@")) return json({ error: "Valid email is required" }, 400);
    const memberRole = ROLES.includes(role) ? role : "buyer";

    const { data: newUser, error: createErr } = await db.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { nome: nome || "" },
    });
    if (createErr || !newUser?.user) return json({ error: createErr?.message ?? "Failed to create user" }, 400);

    const { data: ct, error: ctErr } = await db.from("company_contacts").insert({
      cliente_id: companyId, user_id: newUser.user.id, nome: nome || "", email, role: memberRole, ativo: true,
    }).select("id, nome, email, role, ativo, created_at").single();
    if (ctErr) return json({ error: ctErr.message }, 400);

    await db.from("user_roles").upsert({ user_id: newUser.user.id, role: "cliente" }, { onConflict: "user_id" });

    // Email de setup de senha (Resend + Office365 fallback). Não bloqueia a criação.
    let mailOk = true;
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey },
        body: JSON.stringify({ type: "password_reset", email: email.trim().toLowerCase(), redirectTo: body.redirectTo || "" }),
      });
      mailOk = r.ok;
    } catch { mailOk = false; }

    return json({ success: true, member: ct, mailOk });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
