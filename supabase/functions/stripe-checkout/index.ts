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
            .update({ status: "cancelado", admin_notes: `Payment failed: ${reason}` } as any)
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

    if (action === "create_payment_intent") {
      const { amount, currency = "usd", pedido_id, metadata = {} } = body;

      if (!amount || amount <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid amount" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const paymentIntent = await (stripe as any).paymentIntents.create({
        amount: Math.round(amount * 100),
        currency,
        metadata: { pedido_id: pedido_id || "", ...metadata },
        automatic_payment_methods: { enabled: true },
      });

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
        if (pedidoId) {
          await adminClient
            .from("pedidos")
            .update({ is_paid: true, payment_intent_id } as any)
            .eq("id", pedidoId);
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
