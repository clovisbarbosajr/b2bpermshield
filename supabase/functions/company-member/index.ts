// company-member — o DONO da conta gerencia os funcionários (sub-logins) da própria
// empresa no modelo ÚNICO do B2BWave: cada funcionário é um registro próprio em
// `clientes` com `parent_customer_id` = a conta do dono + 2 flags:
//   can_confirm_order      = pode finalizar pedido sem aprovação
//   can_view_full_history  = vê o histórico completo da empresa
// O funcionário HERDA a tabela de preço do pai (trigger fn_subuser_inherit_pricelist)
// e recebe SEMPRE o papel 'cliente' (nunca admin/manager/warehouse → sem escalonamento).
// Roda com service_role (cria auth user), mas valida que o chamador é o DONO da conta.
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("authorization") ?? "";

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action || "create";

    // Quem é a EMPRESA-alvo?
    // - Cliente dono logado: a própria linha em `clientes` (user_id = caller, sem pai).
    // - STAFF em "view as": a sessão real é do STAFF (o view-as não troca o JWT!),
    //   então o alvo vem EXPLÍCITO no body (cliente_id) e validamos o papel. Sem isso,
    //   o funcionário era criado embaixo da linha de clientes atrelada ao usuário do
    //   admin (caso "Nextgen Flooring") — empresa errada, invisível pro dono certo.
    let owner: { id: string; empresa: string | null; nome: string | null; parent_customer_id: string | null } | null = null;

    const { data: roleRow } = await db.from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
    const isStaff = ["admin", "manager"].includes(roleRow?.role ?? "");

    if (isStaff) {
      if (!body.cliente_id) return json({ error: "cliente_id is required when managing a team as staff (view as)" }, 400);
      const { data } = await db.from("clientes")
        .select("id, empresa, nome, parent_customer_id")
        .eq("id", body.cliente_id).maybeSingle();
      owner = data;
    } else {
      const { data } = await db.from("clientes")
        .select("id, empresa, nome, parent_customer_id")
        .eq("user_id", caller.id).maybeSingle();
      owner = data;
    }

    if (!owner || owner.parent_customer_id) {
      return json({ error: "Only the account owner can manage the team" }, 403);
    }
    const companyId = owner.id;

    // ── Listar a equipe (sub-clientes desta conta) ──
    if (action === "list") {
      const { data } = await db.from("clientes")
        .select("id, nome, email, can_confirm_order, can_view_full_history, status")
        .eq("parent_customer_id", companyId).order("created_at");
      const members = (data ?? []).map((m: any) => ({
        id: m.id, nome: m.nome, email: m.email,
        can_confirm_order: m.can_confirm_order, can_view_full_history: m.can_view_full_history,
        ativo: m.status !== "inativo",
      }));
      return json({ members });
    }

    // ── Atualizar flags / status ── (sempre amarrado a parent_customer_id = companyId)
    if (action === "update") {
      const { member_id, can_confirm_order, can_view_full_history, ativo } = body;
      if (!member_id) return json({ error: "member_id required" }, 400);
      const patch: any = {};
      if (typeof can_confirm_order === "boolean") patch.can_confirm_order = can_confirm_order;
      if (typeof can_view_full_history === "boolean") patch.can_view_full_history = can_view_full_history;
      if (typeof ativo === "boolean") { patch.status = ativo ? "ativo" : "inativo"; patch.is_active = ativo; }
      const { error } = await db.from("clientes").update(patch)
        .eq("id", member_id).eq("parent_customer_id", companyId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ── Remover (desativa; mantém o login para histórico) ──
    if (action === "delete") {
      const { member_id } = body;
      if (!member_id) return json({ error: "member_id required" }, 400);
      const { error } = await db.from("clientes").update({ status: "inativo", is_active: false })
        .eq("id", member_id).eq("parent_customer_id", companyId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ── Criar funcionário (sub-login) ──
    const { email, nome } = body;
    if (!email || typeof email !== "string" || !email.includes("@")) return json({ error: "Valid email is required" }, 400);
    const canConfirm = body.can_confirm_order === true;
    const canHistory = body.can_view_full_history === true;

    const { data: newUser, error: createErr } = await db.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { nome: nome || "" },
    });
    if (createErr || !newUser?.user) {
      // Email já tem login. Mensagens ESPECÍFICAS (não "non-2xx") + reativação
      // automática quando for um funcionário removido DESTA mesma empresa.
      const emailLc = email.trim().toLowerCase();
      const { data: sameCompany } = await db.from("clientes")
        .select("id, nome, status, can_confirm_order, can_view_full_history")
        .ilike("email", emailLc).eq("parent_customer_id", companyId).limit(1).maybeSingle();
      if (sameCompany) {
        const { error: reErr } = await db.from("clientes").update({
          status: "ativo", is_active: true,
          nome: nome || sameCompany.nome,
          can_confirm_order: canConfirm, can_view_full_history: canHistory,
        }).eq("id", sameCompany.id);
        if (reErr) return json({ error: reErr.message });
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey },
            body: JSON.stringify({ type: "password_reset", email: emailLc, redirectTo: body.redirectTo || "" }),
          });
        } catch { /* reenvio falhou; membro reativado mesmo assim */ }
        return json({
          success: true, reactivated: true,
          member: { id: sameCompany.id, nome: nome || sameCompany.nome, email: emailLc, can_confirm_order: canConfirm, can_view_full_history: canHistory, ativo: true },
          mailOk: true,
        });
      }
      const { data: elsewhere } = await db.from("clientes")
        .select("id, empresa, parent_customer_id").ilike("email", emailLc).limit(1).maybeSingle();
      if (elsewhere?.parent_customer_id) {
        return json({ error: `This email is already an employee of another company ("${elsewhere.empresa || "unknown"}"). Remove it there first, or use a different email.` });
      }
      if (elsewhere) {
        return json({ error: `This email already belongs to the customer account "${elsewhere.empresa || emailLc}" — it can't also be added as an employee.` });
      }
      return json({ error: `This email already has a login in the system (staff or pending account). Use a different email.` });
    }

    // Sub-cliente: papel 'cliente' apenas, pai = a própria conta, herda price list (trigger).
    const { data: sub, error: subErr } = await db.from("clientes").insert({
      user_id: newUser.user.id,
      parent_customer_id: companyId,
      nome: nome || email,
      email,
      empresa: owner.empresa || owner.nome || "",
      can_confirm_order: canConfirm,
      can_view_full_history: canHistory,
      status: "ativo",
      is_active: true,
    }).select("id, nome, email, can_confirm_order, can_view_full_history, status").single();
    if (subErr) return json({ error: subErr.message }, 400);

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

    return json({
      success: true,
      member: { id: sub.id, nome: sub.nome, email: sub.email, can_confirm_order: sub.can_confirm_order, can_view_full_history: sub.can_view_full_history, ativo: true },
      mailOk,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
