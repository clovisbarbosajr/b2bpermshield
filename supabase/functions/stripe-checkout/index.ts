import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const stripeSignature = req.headers.get("stripe-signature");
  if (stripeSignature) {
    try {
      const { data: config } = await adminClient
        .from("configuracoes")
        .select("stripe_secret_key, stripe_webhook_secret")
        .limit(1)
        .maybeSingle();

      if (!config?.stripe_secret_key || !config?.stripe_webhook_secret) {
        console.error("[stripe-webhook] Missing stripe_secret_key or stripe_webhook_secret in configuracoes");
        return new Response(JSON.stringify({ error: "Stripe not configured" }), { status: 400 });
      }

      const stripe = new Stripe(config.stripe_secret_key, { apiVersion: "2023-10-16" });

      const rawBody = await req.text();
      let event: any;
      try {
        event = await (stripe as any).webhooks.constructEventAsync(
          rawBody,
          stripeSignature,
          config.stripe_webhook_secret
        );
      } catch (sigErr: any) {
        console.error("[stripe-webhook] Signature verification failed:", sigErr.message);
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
      }

      console.log(`[stripe-webhook] Event: ${event.type} — id: ${event.id}`);

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const pedidoId = pi.metadata?.pedido_id;

        if (pedidoId) {
          const { error } = await adminClient
            .from("pedidos")
            .update({ is_paid: true, payment_intent_id: pi.id } as any)
            .eq("id", pedidoId)
            .eq("is_paid", false);

          if (error) {
            console.error("[stripe-webhook] DB update error:", error);
          } else {
            console.log(`[stripe-webhook] Order ${pedidoId} marked as paid (PI: ${pi.id})`);
          }
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as any;
        const pedidoId = pi.metadata?.pedido_id;
        const reason = pi.last_payment_error?.message || "Payment failed";

        if (pedidoId) {
          await adminClient
            .from("pedidos")
            .update({ status: "cancelled", admin_notes: `Payment failed: ${reason}` } as any)
            .eq("id", pedidoId)
            .eq("is_paid", false);

          console.log(`[stripe-webhook] Order ${pedidoId} payment failed: ${reason}`);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("[stripe-webhook] Unhandled error:", err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  try {
    const { data: config } = await adminClient
      .from("configuracoes")
      .select("stripe_secret_key, stripe_publishable_key, stripe_enabled")
      .limit(1)
      .maybeSingle();

    if (!config?.stripe_enabled || !config?.stripe_secret_key) {
      return new Response(
        JSON.stringify({ error: "Stripe is not enabled. Configure it in Settings → Payments." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(config.stripe_secret_key, { apiVersion: "2023-10-16" });
    const body = await req.json();
    const { action } = body;

    // ----------------------------------------------------------------------
    // POSSE DO PEDIDO (A7)
    //
    // Esta funcao roda com SERVICE ROLE e nao conferia de quem era o
    // `pedido_id`. O cadastro deste sistema e ABERTO, entao qualquer pessoa com
    // uma conta podia criar intencao de cobranca sobre o pedido de OUTRO
    // cliente, e — pior — chamar `confirm_payment` com um `payment_intent_id`
    // alheio e carimbar `is_paid` num pedido que nao e dela.
    //
    // Hoje e inofensivo porque o Stripe esta desligado (`stripe_enabled`). Vira
    // plataforma de teste de cartao de terceiros na conta do dono no dia em que
    // ligar — por isso entra ANTES.
    //
    // O caminho do WEBHOOK nao passa por aqui: ele e tratado la em cima, pela
    // assinatura `stripe-signature`, e nao tem JWT nenhum.
    const donoDoPedido = async (pedidoId: string): Promise<boolean> => {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.toLowerCase().startsWith("bearer ")) return false;

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth } } },
      );
      const { data: u } = await userClient.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return false;

      // Staff resolve pedido de qualquer cliente (atendimento, cobranca manual).
      const { data: papel } = await adminClient
        .from("user_roles").select("role").eq("user_id", uid).maybeSingle();
      if (papel && ["admin", "manager"].includes(String(papel.role))) return true;

      // Cliente: o pedido tem que ser da ficha dele, ou da conta da EMPRESA
      // (sub-usuario paga pedido da empresa).
      const { data: ficha } = await adminClient
        .from("clientes").select("id, parent_customer_id").eq("user_id", uid).maybeSingle();
      if (!ficha) return false;
      const raiz = ficha.parent_customer_id ?? ficha.id;

      const { data: ped } = await adminClient
        .from("pedidos")
        .select("cliente_id, clientes:cliente_id ( id, parent_customer_id )")
        .eq("id", pedidoId).maybeSingle();
      if (!ped) return false;

      const dono: any = (ped as any).clientes ?? {};
      const raizDoPedido = dono.parent_customer_id ?? ped.cliente_id;
      return String(raizDoPedido) === String(raiz);
    };

    const recusaPosse = () => new Response(
      JSON.stringify({ error: "not allowed for this order" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
    // ----------------------------------------------------------------------

    if (action === "create_payment_intent") {
      const { currency = "usd", pedido_id, metadata = {} } = body;

      // SEGURANÇA (7-4 / 2-A): NUNCA confiar no `amount` enviado pelo cliente.
      // O valor a cobrar é lido do próprio pedido no banco (service role).
      if (!pedido_id) {
        return new Response(
          JSON.stringify({ error: "pedido_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!(await donoDoPedido(String(pedido_id)))) {
        console.error(`[stripe-checkout] create_payment_intent negado para o pedido ${pedido_id}`);
        return recusaPosse();
      }

      const { data: pedido, error: pedidoError } = await adminClient
        .from("pedidos")
        .select("total")
        .eq("id", pedido_id)
        .maybeSingle();

      if (pedidoError || !pedido) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const serverAmount = Number((pedido as any).total) || 0;
      if (serverAmount <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid order total" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const paymentIntent = await (stripe as any).paymentIntents.create({
        amount: Math.round(serverAmount * 100),
        currency,
        // `pedido_id` DEPOIS do spread: o metadata vem do cliente e, com ele por
        // último, dava pra sobrescrever o pedido_id — pagava-se um pedido de $10
        // e o webhook/confirm_payment marcava OUTRO pedido (de qualquer valor)
        // como pago, ou o cancelava. O valor cobrado sempre veio do banco; o que
        // faltava era amarrar o metadata ao MESMO pedido que definiu o valor.
        metadata: { ...metadata, pedido_id: pedido_id || "" },
        automatic_payment_methods: { enabled: true },
      });

      // CARIMBA A INTENCAO NO PEDIDO, AGORA.
      //
      // Antes, `payment_intent_id` so era gravado quando o pagamento CONFIRMAVA
      // (webhook ou `confirm_payment`). Entre criar a intencao e confirmar, o
      // banco nao tinha sinal nenhum de que havia cobranca em curso — e o guard
      // `ROLLBACK_PAID` de `pedido_rollback_checkout` (20260825250000) le
      // exatamente esse campo.
      //
      // Consequencia: se o `confirmCardPayment` devolvesse erro de REDE depois de
      // a cobranca passar, o Checkout chamava o desfazer e o pedido PAGO virava
      // 'cancelled', liberando a reserva de estoque. O guard existia mas era
      // corrida — so pegava se o webhook chegasse antes.
      //
      // Com o carimbo aqui, o guard passa a valer desde o instante em que a
      // cobranca comeca. Falhar em gravar NAO impede o pagamento: o cliente esta
      // com o cartao na tela, e recusar aqui seria pior que a corrida.
      const { error: carimboErr } = await adminClient
        .from("pedidos")
        .update({ payment_intent_id: paymentIntent.id } as any)
        .eq("id", pedido_id);
      if (carimboErr) {
        console.error(`[stripe-checkout] nao consegui carimbar payment_intent_id no pedido ${pedido_id}: ${carimboErr.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id,
          publishable_key: config.stripe_publishable_key,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "confirm_payment") {
      const { payment_intent_id } = body;
      const paymentIntent = await (stripe as any).paymentIntents.retrieve(payment_intent_id);

      if (paymentIntent.status === "succeeded") {
        const pedidoId = paymentIntent.metadata?.pedido_id;
        // Confere a posse ANTES de carimbar `is_paid`. Sem isto, quem tivesse um
        // `payment_intent_id` de outra pessoa marcava o pedido dela como pago.
        if (pedidoId && !(await donoDoPedido(String(pedidoId)))) {
          console.error(`[stripe-checkout] confirm_payment negado para o pedido ${pedidoId}`);
          return recusaPosse();
        }
        if (pedidoId) {
          await adminClient
            .from("pedidos")
            .update({ is_paid: true, payment_intent_id } as any)
            .eq("id", pedidoId)
            .eq("is_paid", false);   // idempotente (igual ao webhook) — evita re-stamp
        }
        return new Response(
          JSON.stringify({ success: true, status: "succeeded", pedido_id: pedidoId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, status: paymentIntent.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use: create_payment_intent, confirm_payment" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[stripe-checkout] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
