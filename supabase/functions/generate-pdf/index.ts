import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fmtUSD(v: number | string | null | undefined): string {
  const n = Number(v) || 0;
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return (dt.getUTCMonth() + 1).toString().padStart(2, "0") + "/" +
    dt.getUTCDate().toString().padStart(2, "0") + "/" +
    dt.getUTCFullYear();
}

/** Default PDF HTML template. Supports {{placeholder}} substitution. */
function buildDefaultTemplate(data: {
  orderNumber: string;
  orderDate: string;
  poNumber: string;
  deliveryDate: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  itemsRows: string;
  subtotal: string;
  discount: string;
  tax: string;
  grossTotal: string;
  notes: string;
}): string {
  const {
    orderNumber, orderDate, poNumber, deliveryDate,
    customerName, customerEmail, customerAddress,
    companyName, companyAddress, companyEmail, companyWebsite,
    itemsRows, subtotal, discount, tax, grossTotal, notes,
  } = data;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#222; padding:32px; }

  /* ─── Header ─── */
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1a2d5a; padding-bottom:14px; margin-bottom:18px; }
  .logo-text { font-size:22px; font-weight:800; color:#1a2d5a; letter-spacing:-0.5px; }
  .logo-text span { color:#e88a1a; }
  .logo-sub { font-size:9px; color:#999; margin-top:2px; }
  .doc-info { text-align:right; }
  .doc-title { font-size:18px; font-weight:700; color:#1a2d5a; }
  .doc-num   { font-size:13px; color:#e88a1a; font-weight:700; margin-top:2px; }
  .doc-date  { font-size:10px; color:#666; margin-top:2px; }

  /* ─── Two-column info ─── */
  .info-row { display:flex; gap:0; margin-bottom:18px; }
  .info-left { flex:1; padding-right:20px; border-right:1px solid #ddd; }
  .info-right { flex:1; padding-left:20px; }
  .info-block { margin-bottom:6px; }
  .info-label { color:#888; font-size:9px; text-transform:uppercase; letter-spacing:0.5px; }
  .info-value { font-size:11px; font-weight:600; color:#1a2d5a; margin-top:1px; }
  .info-value.normal { font-weight:400; color:#333; }

  /* ─── Items table ─── */
  table { width:100%; border-collapse:collapse; margin-bottom:12px; }
  thead tr { background:#1a2d5a; color:#fff; }
  th { padding:7px 10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; text-align:left; }
  th:nth-child(3) { text-align:center; }
  th:nth-child(4), th:nth-child(5) { text-align:right; }
  td { padding:7px 10px; border-bottom:1px solid #eee; font-size:11px; vertical-align:top; }
  td:nth-child(3) { text-align:center; }
  td:nth-child(4), td:nth-child(5) { text-align:right; }
  tr:nth-child(even) td { background:#f8f9fb; }

  /* ─── Totals ─── */
  .totals { display:flex; justify-content:flex-end; margin-bottom:18px; }
  .totals-table { min-width:240px; border-collapse:collapse; }
  .totals-table td { padding:4px 10px; font-size:11px; }
  .totals-table td:first-child { color:#666; text-align:right; }
  .totals-table td:last-child { font-weight:600; text-align:right; color:#1a2d5a; min-width:80px; }
  .totals-table tr.grand td { border-top:2px solid #1a2d5a; font-size:13px; font-weight:800; padding-top:7px; }

  /* ─── Notes ─── */
  .notes-box { background:#f5f7fa; border-left:3px solid #e88a1a; padding:10px 12px; font-size:10px; color:#555; margin-bottom:18px; }

  /* ─── Footer ─── */
  .footer { border-top:1px solid #ddd; padding-top:12px; display:flex; justify-content:space-between; align-items:flex-end; }
  .footer-company { font-size:10px; color:#555; line-height:1.6; }
  .footer-company strong { font-size:11px; color:#1a2d5a; }
  .footer-brand { font-size:16px; font-weight:800; color:#1a2d5a; }
  .footer-brand span { color:#e88a1a; }
</style>
</head>
<body>

<!-- Header -->
<div class="hdr">
  <div>
    <div class="logo-text">Perm<span>Shield</span></div>
    <div class="logo-sub">B2B Portal — Flooring</div>
  </div>
  <div class="doc-info">
    <div class="doc-title">ORDER</div>
    <div class="doc-num">#${orderNumber}</div>
    <div class="doc-date">${orderDate}</div>
  </div>
</div>

<!-- Order info + Company info side by side -->
<div class="info-row">
  <div class="info-left">
    <div class="info-block">
      <div class="info-label">Order</div>
      <div class="info-value">#${orderNumber}</div>
    </div>
    <div class="info-block">
      <div class="info-label">Customer</div>
      <div class="info-value">${customerName}</div>
    </div>
    ${customerEmail ? `<div class="info-block"><div class="info-label">Email</div><div class="info-value normal">${customerEmail}</div></div>` : ""}
    ${customerAddress ? `<div class="info-block"><div class="info-label">Ship To</div><div class="info-value normal">${customerAddress}</div></div>` : ""}
    ${poNumber ? `<div class="info-block"><div class="info-label">Purchase Order</div><div class="info-value">${poNumber}</div></div>` : ""}
    ${deliveryDate ? `<div class="info-block"><div class="info-label">Requested Delivery</div><div class="info-value">${deliveryDate}</div></div>` : ""}
  </div>
  <div class="info-right">
    <div class="info-block">
      <div class="info-label">From</div>
      <div class="info-value">${companyName}</div>
    </div>
    ${companyAddress ? `<div class="info-block"><div class="info-value normal">${companyAddress}</div></div>` : ""}
    ${companyEmail ? `<div class="info-block"><div class="info-label">Email</div><div class="info-value normal">${companyEmail}</div></div>` : ""}
    ${companyWebsite ? `<div class="info-block"><div class="info-label">Website</div><div class="info-value normal">${companyWebsite}</div></div>` : ""}
  </div>
</div>

<!-- Items -->
<table>
  <thead>
    <tr>
      <th>Code</th>
      <th>Name / Description</th>
      <th>Qty</th>
      <th>Price</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemsRows}
  </tbody>
</table>

<!-- Totals -->
<div class="totals">
  <table class="totals-table">
    <tr><td>Subtotal</td><td>${subtotal}</td></tr>
    ${discount !== "$0.00" ? `<tr><td>Discount</td><td>- ${discount}</td></tr>` : ""}
    ${tax !== "$0.00" ? `<tr><td>Sales Tax</td><td>${tax}</td></tr>` : ""}
    <tr class="grand"><td>Gross Total</td><td>${grossTotal}</td></tr>
  </table>
</div>

<!-- Notes -->
${notes ? `<div class="notes-box"><strong>Notes:</strong> ${notes}</div>` : ""}

<!-- Footer -->
<div class="footer">
  <div class="footer-company">
    <strong>${companyName}</strong><br>
    ${companyAddress ? companyAddress + "<br>" : ""}
    ${companyEmail ? `E-mail: ${companyEmail}` : ""}
  </div>
  <div class="footer-brand">Perm<span>Shield</span></div>
</div>

</body>
</html>`;
}

/** Apply {{placeholders}} from a custom template stored in DB */
function applyCustomTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { pedido_id } = body;

    if (!pedido_id) {
      return new Response(JSON.stringify({ error: "pedido_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch all needed data in parallel
    const [{ data: pedido, error: pedidoErr }, { data: cfg }] = await Promise.all([
      supabase
        .from("pedidos")
        .select("*, clientes(nome, empresa, email, telefone)")
        .eq("id", pedido_id)
        .single(),
      supabase
        .from("configuracoes")
        .select("nome_empresa, email_contato, endereco, telefone_contato, pdf_order_template")
        .limit(1)
        .maybeSingle(),
    ]);

    if (pedidoErr || !pedido) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch items
    const { data: itens } = await supabase
      .from("pedido_itens")
      .select("*")
      .eq("pedido_id", pedido_id)
      .order("created_at");

    // Fetch delivery address
    let endereco: any = null;
    if (pedido.endereco_entrega_id) {
      const { data } = await supabase
        .from("enderecos")
        .select("*")
        .eq("id", pedido.endereco_entrega_id)
        .single();
      endereco = data;
    }

    const cliente = pedido.clientes as any;

    // Company info from config
    const companyName    = cfg?.nome_empresa    || "Zap Supplies, LLC";
    const companyEmail   = cfg?.email_contato   || "jess@zapsupplies.com";
    const companyAddress = cfg?.endereco        || "1800 N Powerline Rd Ste A6, POMPANO BEACH FL 33069";
    const companyWebsite = "https://zapsupplies.b2bwave.com/";

    // Customer address
    const customerAddress = endereco
      ? [
          endereco.logradouro,
          endereco.complemento,
          endereco.cidade && endereco.estado ? `${endereco.cidade}, ${endereco.estado}` : (endereco.cidade || endereco.estado),
          endereco.cep,
        ].filter(Boolean).join(", ")
      : "";

    // Items rows HTML
    const itemsRows = (itens ?? []).map((i: any) => `
      <tr>
        <td>${i.sku || "—"}</td>
        <td>${i.nome_produto || "—"}</td>
        <td>${i.quantidade}</td>
        <td>${fmtUSD(i.preco_unitario)}</td>
        <td>${fmtUSD(i.subtotal)}</td>
      </tr>
    `).join("");

    const data = {
      orderNumber:     String(pedido.numero || pedido.id),
      orderDate:       fmtDate(pedido.created_at),
      poNumber:        pedido.po_number || "",
      deliveryDate:    pedido.delivery_date ? fmtDate(pedido.delivery_date) : "",
      customerName:    cliente?.empresa || cliente?.nome || "—",
      customerEmail:   cliente?.email || "",
      customerAddress,
      companyName,
      companyAddress,
      companyEmail,
      companyWebsite,
      itemsRows,
      subtotal:        fmtUSD(pedido.subtotal),
      discount:        fmtUSD(pedido.desconto),
      tax:             fmtUSD(pedido.sales_tax),
      grossTotal:      fmtUSD(pedido.total),
      notes:           pedido.observacoes || "",
    };

    // Use custom template from DB or build default
    const html = cfg?.pdf_order_template
      ? applyCustomTemplate(cfg.pdf_order_template, data)
      : buildDefaultTemplate(data);

    return new Response(JSON.stringify({ html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[generate-pdf] error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
