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

// `_` e `%` sao CURINGAS no ILIKE do Postgres, e `_` e comum em e-mail. Sem
// escapar, "a_b@x.com" casa tambem com "aXb@x.com": a consulta pode achar a
// ficha de OUTRA pessoa. Mesmo helper que o `company-member` ja usa.
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { email, nome, empresa } = await req.json();
    const emailLc = String(email ?? "").trim().toLowerCase();
    if (!emailLc || !emailLc.includes("@")) return json({ error: "valid email required" }, 400);

    // ORACULO PUBLICO (A4)
    //
    // Esta funcao e chamavel SEM SESSAO (`verify_jwt = false`), e devolvia CINCO
    // respostas distintas e mutuamente exclusivas:
    //
    //   "registration closed" | "no auth user yet" | "staff login"
    //   | {existing:true} | {linked:true} | {created:<uuid>}
    //
    // Um `for` numa lista de e-mails separava STAFF de CLIENTE de INEXISTENTE —
    // exatamente o que se quer antes de um phishing dirigido ou de tentar senhas
    // vazadas. As RPCs por tras (`auth_user_id_by_email`, `is_staff_login`) estao
    // corretamente trancadas com REVOKE; era esta funcao publica que as
    // reexportava como oraculo.
    //
    // Agora todo caminho que NAO cria ficha responde a MESMA coisa. O motivo real
    // vai para o log do servidor, onde so o dono ve.
    const opaco = () => json({ ok: true });

    // 0) Cadastro aberto? A tela publica ja barra, mas o front sozinho nao
    //    protege nada — quem chamar esta funcao direto tem que bater na mesma
    //    trava. Fail-open: erro na leitura NAO fecha o cadastro.
    const { data: aberto, error: abertoErr } = await db.rpc("registration_is_open");
    if (!abertoErr && aberto === false) {
      console.log(`[register-customer] cadastro fechado (${emailLc})`);
      return opaco();
    }

    // 1) O auth user com esse email existe? (senão não cria ficha pra email aleatório)
    const { data: uid } = await db.rpc("auth_user_id_by_email", { _email: emailLc });
    if (!uid) {
      console.log(`[register-customer] sem auth user ainda (${emailLc})`);
      return opaco();
    }

    // 2) Staff nunca vira cliente.
    const { data: staff } = await db.rpc("is_staff_login", { _user_id: uid });
    if (staff) {
      console.log(`[register-customer] login de staff (${emailLc})`);
      return opaco();
    }

    // 3) Já existe ficha? (por user_id ou por email de cliente migrado) → vincula, não duplica.
    const { data: byUser } = await db.from("clientes").select("id").eq("user_id", uid).limit(1).maybeSingle();
    if (byUser) {
      console.log(`[register-customer] ja tem ficha (${emailLc})`);
      return opaco();
    }

    const { data: byEmail } = await db.from("clientes").select("id, user_id").ilike("email", likeEscape(emailLc)).limit(1).maybeSingle();
    if (byEmail) {
      if (!byEmail.user_id) await db.from("clientes").update({ user_id: uid }).eq("id", byEmail.id).is("user_id", null);
      console.log(`[register-customer] vinculou ficha existente (${emailLc})`);
      return opaco();
    }

    // 4) Cria a ficha PENDENTE (sem acesso até aprovação).
    const { data: created, error } = await db.from("clientes").insert({
      user_id: uid, nome: nome || emailLc, email: emailLc, empresa: empresa || "",
      status: "pendente", is_active: true, can_confirm_order: false, parent_customer_id: null,
    }).select("id").single();
    if (error) {
      // Nem o erro pode diferenciar: "e-mail ja existe" vira oraculo do mesmo
      // jeito. Vai para o log; a resposta continua a mesma.
      console.error(`[register-customer] falha ao criar ficha (${emailLc}): ${error.message}`);
      return opaco();
    }

    // AMPLIFICADOR DE MENSAGEM
    //
    // Cada chamada desta funcao — publica, sem sessao — disparava TRES envios:
    // um SMS para o dono e dois e-mails. Sem limite nenhum. Depois do incidente
    // de 25/ago (1508 SMS), isso e um botao de "gastar o credito do dono" ao
    // alcance de qualquer um.
    //
    // O limite e por E-MAIL, e nao global, de proposito: um limite global viraria
    // negacao de servico — bastaria alguem cadastrar em massa para impedir que
    // clientes de verdade recebessem o aviso de cadastro.
    //
    // Falha de leitura NAO bloqueia: o cadastro ja foi criado, e engolir o aviso
    // do dono por erro nosso e pior que um aviso a mais.
    let podeAvisar = true;
    try {
      const { count } = await db
        .from("notification_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient", emailLc)
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
      if ((count ?? 0) >= 3) {
        podeAvisar = false;
        console.log(`[register-customer] limite de aviso de cadastro atingido para ${emailLc}`);
      }
    } catch (e) {
      console.error(`[register-customer] nao consegui checar o limite de aviso (${emailLc}): ${String(e)}`);
    }

    // 5) Notificações do cadastro — TODAS do SERVIDOR (o cliente ainda não tem
    // sessão no signup; o frontend não consegue chamar notify-dispatch nem os
    // emails de notificação sem cair na trava anti-relay). Aqui usamos service-role
    // (send-email) e x-cron-secret (notify-dispatch).
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    // 5a) SMS new_customer pro admin
    try {
      if (!podeAvisar) throw new Error("limite de aviso");
      await fetch(`${SB_URL}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": Deno.env.get("CRON_SECRET") ?? "", "apikey": ANON, "Authorization": `Bearer ${ANON}` },
        body: JSON.stringify({ event: "new_customer", vars: { customer_name: nome || "", customer_company: empresa || "", customer_email: emailLc, customer_phone: "" } }),
      });
    } catch (_e) { /* não bloqueia */ }
    // 5b) Email "recebemos seu cadastro" pro CLIENTE
    try {
      if (!podeAvisar) throw new Error("limite de aviso");
      await fetch(`${SB_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SERVICE, "Authorization": `Bearer ${SERVICE}` },
        body: JSON.stringify({ type: "waiting_approval", customerEmail: emailLc }),
      });
    } catch (_e) { /* não bloqueia */ }
    // 5c) Email "novo cadastro" pro ADMIN
    try {
      if (!podeAvisar) throw new Error("limite de aviso");
      await fetch(`${SB_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SERVICE, "Authorization": `Bearer ${SERVICE}` },
        body: JSON.stringify({ type: "new_registration_admin", customerEmail: emailLc, customerName: nome || "", empresa: empresa || "" }),
      });
    } catch (_e) { /* não bloqueia */ }

    console.log(`[register-customer] ficha pendente criada (${emailLc}): ${created.id}`);
    return opaco();
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
