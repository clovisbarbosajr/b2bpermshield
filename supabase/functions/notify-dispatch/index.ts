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
    // Ler o `error`: `supabase-js` devolve {data:null,error}, nao levanta. Sem
    // isto, uma leitura falhada rebaixava um ADMIN a cliente comum em silencio e
    // ele tomava "Not authorized for this event" / "Missing 'vars.order_id'" —
    // mensagens que afirmam algo que o codigo nao sabe. A causa real (banco fora)
    // nao aparecia em lugar nenhum. Continua sem enviar; agora diz por que.
    const { data: papeis, error: papeisErr } = await db.from("user_roles")
      .select("role").eq("user_id", user.id);
    if (papeisErr) return json({ error: "Could not read the caller's role: " + papeisErr.message }, 500);
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
      // O `error` da RPC era descartado: RPC fora do ar respondia "bloqueado pelo
      // teto", que e falso — o teto pode estar folgado. Continua falhando FECHADO,
      // mas agora diz a causa real. Mesmo texto que `_shared/dispatch.ts` usa.
      const { data: perm, error: permErr } = await db.rpc("envio_permitido", { _canal: test.channel === "email" ? "email" : "sms" });
      if (permErr || !perm || (perm as any).ok !== true) {
        return json({
          ok: false, blocked: true,
          reason: permErr
            ? "checagem de teto falhou: " + permErr.message
            : ((perm as any)?.motivo ?? "bloqueado pelo teto"),
        });
      }
      // Idem: com o `error` engolido, `ch` ficava {} e o envio morria adiante com
      // "Twilio 'from' number not configured" — motivo INVENTADO, gravado assim no
      // notification_log. `dispatchEvent` ja recusa nesse caso; aqui nao recusava.
      const { data: channels, error: chErr } = await db.from("notification_channels").select("*");
      if (chErr) {
        const motivo = "falha ao ler notification_channels: " + chErr.message;
        await db.from("notification_log").insert({
          event: event ?? "test", channel: test.channel, recipient: test.to,
          status: "failed", error: motivo, payload: vars,
        });
        return json({ ok: false, error: motivo });
      }
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
      // `pedidos.numero` NAO e unico — nao ha UNIQUE na coluna, e o gatilho
      // `fn_pedido_numero_continua` gera o proximo com `MAX(numero)+1` sem lock,
      // entao dois checkouts concorrentes podem nascer com o mesmo numero.
      //
      // O `.limit(1)` que estava aqui era PIOR do que uma consulta sem limite:
      // ele garantia que o `maybeSingle()` nunca visse duas linhas, e assim
      // resolvia um pedido ARBITRARIO em silencio — sem erro, sem aviso. E este
      // lookup nao e cosmetico: e a checagem de DONO logo abaixo
      // (`ped.cliente_id`) que decide se o chamador pode disparar notificacao
      // daquele pedido. Com dois pedidos de clientes diferentes no mesmo numero,
      // a checagem podia liberar contra o pedido errado.
      //
      // `count: "exact"` e recusa em >1: mesmo tratamento que `_shared/dispatch.ts`
      // e `send-email/index.ts` ja davam. Este era o unico dos tres que faltava.
      const q = db.from("pedidos").select("id, cliente_id", { count: "exact" });
      const { data: peds, error: pedErr, count } = numero !== null
        ? await q.eq("numero", numero)
        : await q.eq("id", ref);
      // "Unknown order" afirmava que o pedido nao existe. Com o `error` engolido,
      // uma leitura que FALHOU dava a mesma resposta — e quem investigasse iria
      // procurar um pedido inexistente em vez de um banco fora do ar.
      if (pedErr) return json({ error: "Could not verify the order: " + pedErr.message }, 500);
      if (!peds || peds.length === 0) return json({ error: "Unknown order" }, 403);
      // Recusa em vez de escolher: com o numero ambiguo nao da para saber de quem
      // e o pedido, e adivinhar aqui e adivinhar o dono.
      if ((count ?? peds.length) > 1) {
        return json({ error: `Order number ${ref} matches ${count ?? peds.length} orders — ambiguous, refused` }, 409);
      }
      const ped = peds[0];

      if (callerUserId) {
        // Fail-open DELIBERADO (ver acima) — mas o erro precisa deixar rastro:
        // sem isto, uma leitura falhada some e a checagem de dono desaparece
        // sem ninguem saber que ela deixou de rodar.
        const { data: minhaFicha, error: fichaErr } = await db.from("clientes")
          .select("id").eq("user_id", callerUserId).maybeSingle();
        if (fichaErr) console.error("notify-dispatch: falha ao ler a ficha do chamador (checagem de dono nao rodou):", fichaErr.message);
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
    // `somente_admin` so restringe (tira o cliente da lista). Nao ha caminho em
    // que aceitar isto faca sair MAIS mensagem, entao nao precisa de checagem de
    // papel — diferente de tudo o mais neste arquivo.
    //
    // JA `vars` e texto livre do chamador, e o `logRow` do dispatch grava
    // `payload = vars`. Como o cadastro e ABERTO, uma conta qualquer podia
    // POSTar `new_order` com `order_numero` inventado e `origem:"b2bwave"`, e
    // plantar em `notification_log` a linha que faz o sync CALAR o aviso de um
    // pedido de verdade. Envenenar o dedupe pela porta da frente.
    //
    // Basta impedir a forja de `origem`: o dedupe do sync exige as DUAS marcas
    // (`origem = "b2bwave"` E o numero). Sem conseguir plantar `origem`, a linha
    // do atacante nunca casa, por mais numero que ele invente.
    //
    // `order_numero` fica como esta de proposito — os modelos de mensagem o
    // usam, e para o cliente ele ja vem do pedido dele na tela.
    if (!isStaff && !viaCron) delete (vars as any).origem;
    const r = await dispatchEvent(db, event, vars, safeCustomer,
      { somenteAdmin: body?.somente_admin === true });
    return json(r);
  } catch (e) {
    console.error("notify-dispatch error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
