import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.8";

// Deno edge runtime may require an npm install hint when resolving Node packages locally.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Email Templates ──────────────────────────────────────────────────────────
// Following the B2BWave email template style (Zap Supplies, LLC branding)

const COMPANY_NAME = "Zap Supplies, LLC";
const COMPANY_SITE = "https://zapsupplies.b2bwave.com/";
const COMPANY_EMAIL = "jess@zapsupplies.com";

function emailFooter() {
  return `
<p style="margin:20px 0 0 0;border-top:1px solid #ddd;padding-top:12px;color:#555;font-size:13px;">
----------<br/>
<strong>${COMPANY_NAME}</strong><br/>
<a href="${COMPANY_SITE}" style="color:#1a7fbd;">${COMPANY_SITE}</a><br/>
E-mail: ${COMPANY_EMAIL}
</p>`;
}

function wrapTemplate(bodyContent: string) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:20px;">
${bodyContent}
${emailFooter()}
</body></html>`;
}

// Template 1: Account approved
function templateApproval(customerName: string, loginUrl: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Your account has been approved!</h2>
<p>Your account has been approved and you can now see all our products and place your orders.</p>
<p><a href="${loginUrl}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Login</a></p>
`);
}

// Template 2: New customer waiting for approval (sent to customer after signup)
function templateWaitingApproval(customerEmail: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Thank you for your application!</h2>
<p>Thank you for the registration request. We will check your request as soon as possible and activate your account.</p>
<p><strong>Username:</strong> ${customerEmail}</p>
`);
}

// Template 3: New order (sent to admin)
function templateNewOrderAdmin(order: any, customer: any, items: any[]) {
  const itemRows = items
    .map(
      (i) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">
        <span style="color:#1a7fbd;">${i.sku || "–"}</span><br/>
        <small style="color:#888;">${i.sku || ""}</small>
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${i.nome_produto || i.name || ""}<br/><small>${i.notes || ""}</small></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.preco_unitario).toFixed(2)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${i.quantidade}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.subtotal).toFixed(2)}</td>
    </tr>
  `,
    )
    .join("");

  return wrapTemplate(`
<h2 style="color:#1a7fbd;">New Order</h2>
<p>
  <strong>Customer:</strong> ${customer.empresa || customer.nome || ""}<br/>
  <strong>Email:</strong> ${customer.email || ""}<br/>
  <strong>Order Id:</strong> ${order.numero || order.id || ""}<br/>
  ${order.po_number ? `<strong>Purchase order:</strong> ${order.po_number}<br/>` : ""}
  ${order.observacoes ? `<strong>Comments:</strong> ${order.observacoes}<br/>` : ""}
  <strong>Total:</strong> $${Number(order.subtotal || 0).toFixed(2)}<br/>
  <strong>Gross total:</strong> $${Number(order.total || 0).toFixed(2)}<br/>
  ${order.delivery_date ? `<strong>Delivery date:</strong> ${order.delivery_date}<br/>` : ""}
</p>
<p><a href="${COMPANY_SITE}admin/orders/${order.id}" style="color:#1a7fbd;">Link to Order</a></p>
<table style="width:100%;border-collapse:collapse;margin-top:12px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="padding:8px;text-align:left;font-size:12px;">Code</th>
      <th style="padding:8px;text-align:left;font-size:12px;">Name</th>
      <th style="padding:8px;text-align:right;font-size:12px;">Price</th>
      <th style="padding:8px;text-align:center;font-size:12px;">Quantity</th>
      <th style="padding:8px;text-align:right;font-size:12px;">Total</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    ${order.desconto ? `<tr><td colspan="4" style="padding:6px 8px;text-align:right;font-size:13px;">Coupon discount</td><td style="padding:6px 8px;text-align:right;">-$${Number(order.desconto).toFixed(2)}</td></tr>` : ""}
    <tr><td colspan="4" style="padding:6px 8px;text-align:right;font-size:13px;">Total</td><td style="padding:6px 8px;text-align:right;font-weight:bold;">$${Number(order.subtotal || 0).toFixed(2)}</td></tr>
    ${order.shipping_costs ? `<tr><td colspan="4" style="padding:6px 8px;text-align:right;font-size:13px;">Shipping costs</td><td style="padding:6px 8px;text-align:right;">$${Number(order.shipping_costs).toFixed(2)}</td></tr>` : ""}
    ${order.sales_tax ? `<tr><td colspan="4" style="padding:6px 8px;text-align:right;font-size:13px;">Sales Tax</td><td style="padding:6px 8px;text-align:right;">$${Number(order.sales_tax).toFixed(2)}</td></tr>` : ""}
    <tr style="background:#f5f5f5;"><td colspan="4" style="padding:8px;text-align:right;font-weight:bold;">Gross total</td><td style="padding:8px;text-align:right;font-weight:bold;">$${Number(order.total || 0).toFixed(2)}</td></tr>
  </tfoot>
</table>
`);
}

// Template 4: New order confirmation (sent to customer) — full order details in body
function templateNewOrderCustomer(order: any, customer: any, items?: any[], company?: any) {
  const companyName = company?.company_name || COMPANY_NAME;
  const companyAddress = company?.company_address || "";
  const companyCity = company?.company_city || "";
  const companyState = company?.company_state || "";
  const companyZip = company?.company_zip || "";
  const companyEmail = company?.email_from
    ? company.email_from.match(/<(.+)>/)
      ? company.email_from.match(/<(.+)>/)[1]
      : company.email_from
    : COMPANY_EMAIL;

  // Customer delivery address (first available)
  const addr = order.endereco || customer.endereco || "";
  const custCity = order.cidade || customer.cidade || "";
  const custState = order.estado || customer.estado || "";
  const custZip = order.zip || customer.zip || customer.cep || "";

  const fmt = (n: any) => `$${Number(n || 0).toFixed(2)}`;

  const itemRows =
    items && items.length > 0
      ? items
          .map(
            (i: any) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#1a7fbd;">${i.sku || i.codigo || "–"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${i.nome_produto || i.name || ""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:center;">${i.quantidade}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${fmt(i.preco_unitario)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">${fmt(i.subtotal)}</td>
    </tr>
  `,
          )
          .join("")
      : `<tr><td colspan="5" style="padding:10px;text-align:center;color:#888;font-size:13px;">No items</td></tr>`;

  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.desconto || 0);
  const shippingCosts = Number(order.shipping_costs || 0);
  const salesTax = Number(order.sales_tax || 0);
  const grossTotal = Number(order.total || 0);

  const discountRow =
    discount > 0
      ? `<tr><td colspan="4" style="padding:5px 10px;text-align:right;font-size:13px;color:#555;">Coupon Discount</td><td style="padding:5px 10px;text-align:right;font-size:13px;color:#c00;">-${fmt(discount)}</td></tr>`
      : "";
  const shippingRow =
    shippingCosts > 0
      ? `<tr><td colspan="4" style="padding:5px 10px;text-align:right;font-size:13px;color:#555;">Shipping</td><td style="padding:5px 10px;text-align:right;font-size:13px;">${fmt(shippingCosts)}</td></tr>`
      : "";
  const taxRow =
    salesTax > 0
      ? `<tr><td colspan="4" style="padding:5px 10px;text-align:right;font-size:13px;color:#555;">Sales Tax</td><td style="padding:5px 10px;text-align:right;font-size:13px;">${fmt(salesTax)}</td></tr>`
      : "";

  const orderDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px;margin:0 auto;padding:20px;">

<!-- Header: company name -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr>
    <td style="border-bottom:2px solid #1a7fbd;padding-bottom:12px;">
      <span style="font-size:22px;font-weight:bold;color:#1a7fbd;">${companyName}</span>
      ${companyAddress ? `<br/><span style="font-size:12px;color:#666;">${companyAddress}${companyCity ? `, ${companyCity}` : ""}${companyState ? `, ${companyState}` : ""}${companyZip ? ` ${companyZip}` : ""}</span>` : ""}
      ${companyEmail ? `<br/><span style="font-size:12px;color:#666;">${companyEmail}</span>` : ""}
    </td>
    <td style="border-bottom:2px solid #1a7fbd;padding-bottom:12px;text-align:right;vertical-align:bottom;">
      <span style="font-size:18px;font-weight:bold;color:#333;">ORDER CONFIRMATION</span><br/>
      <span style="font-size:13px;color:#555;">#${order.numero || order.id}</span>
    </td>
  </tr>
</table>

<!-- Order info + Bill to -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  <tr>
    <td width="50%" style="vertical-align:top;padding-right:16px;">
      <p style="margin:0 0 4px 0;font-size:12px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Bill To</p>
      <p style="margin:0;font-size:13px;line-height:1.6;">
        <strong>${customer.empresa || customer.nome || ""}</strong><br/>
        ${customer.nome && customer.empresa ? `${customer.nome}<br/>` : ""}
        ${customer.email ? `${customer.email}<br/>` : ""}
        ${addr ? `${addr}<br/>` : ""}
        ${custCity || custState || custZip ? `${custCity}${custState ? `, ${custState}` : ""}${custZip ? ` ${custZip}` : ""}<br/>` : ""}
      </p>
    </td>
    <td width="50%" style="vertical-align:top;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:13px;">
        <tr><td style="color:#555;">Order Date:</td><td style="text-align:right;font-weight:bold;">${orderDate}</td></tr>
        ${order.po_number ? `<tr><td style="color:#555;">PO Number:</td><td style="text-align:right;font-weight:bold;">${order.po_number}</td></tr>` : ""}
        ${order.delivery_date ? `<tr><td style="color:#555;">Delivery Date:</td><td style="text-align:right;font-weight:bold;">${order.delivery_date}</td></tr>` : ""}
        ${order.pagamento || order.payment_method ? `<tr><td style="color:#555;">Payment:</td><td style="text-align:right;font-weight:bold;">${order.pagamento || order.payment_method}</td></tr>` : ""}
        ${order.frete || order.shipping_method ? `<tr><td style="color:#555;">Shipping:</td><td style="text-align:right;font-weight:bold;">${order.frete || order.shipping_method}</td></tr>` : ""}
      </table>
    </td>
  </tr>
</table>

<!-- Items table -->
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
  <thead>
    <tr style="background:#1a7fbd;color:#fff;">
      <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:bold;">Code</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:bold;">Product</th>
      <th style="padding:8px 10px;text-align:center;font-size:12px;font-weight:bold;">Qty</th>
      <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:bold;">Unit Price</th>
      <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:bold;">Total</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    <tr><td colspan="4" style="padding:6px 10px;text-align:right;font-size:13px;color:#555;">Subtotal</td><td style="padding:6px 10px;text-align:right;font-size:13px;font-weight:bold;">${fmt(subtotal)}</td></tr>
    ${discountRow}
    ${shippingRow}
    ${taxRow}
    <tr style="background:#f0f0f0;"><td colspan="4" style="padding:8px 10px;text-align:right;font-size:14px;font-weight:bold;">Gross Total</td><td style="padding:8px 10px;text-align:right;font-size:14px;font-weight:bold;color:#1a7fbd;">${fmt(grossTotal)}</td></tr>
  </tfoot>
</table>

${order.observacoes ? `<p style="margin:16px 0 0 0;padding:12px;background:#fffbea;border-left:3px solid #f5a623;font-size:13px;color:#333;"><strong>Notes:</strong> ${order.observacoes}</p>` : ""}

<p style="margin:20px 0 4px 0;font-size:13px;color:#555;">You can track your order status at any time by logging into your account.</p>

<p style="margin:20px 0 0 0;border-top:1px solid #ddd;padding-top:12px;color:#555;font-size:13px;">
----------<br/>
<strong>${companyName}</strong><br/>
<a href="${COMPANY_SITE}" style="color:#1a7fbd;">${COMPANY_SITE}</a><br/>
E-mail: ${companyEmail}
</p>

</body></html>`;
}

// Template 5: Order status change (sent to customer)
function templateOrderStatusChange(order: any, customer: any, newStatus: string) {
  const statusLabel: Record<string, string> = {
    recebido: "Submitted",
    processando: "Processing",
    enviado: "Shipped",
    concluido: "Complete",
    cancelado: "Cancelled",
  };
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Order Status Update</h2>
<p>Hello ${customer.nome || customer.empresa || ""},</p>
<p>Your order <strong>#${order.numero || order.id}</strong> status has been updated to: <strong>${statusLabel[newStatus] || newStatus}</strong></p>
<p><a href="${COMPANY_SITE}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">View My Orders</a></p>
`);
}

// Template 5b: Account rejected (sent to customer)
function templateRejection(customerName: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Application Update</h2>
<p>Hello ${customerName || ""},</p>
<p>Thank you for your interest in becoming a ${COMPANY_NAME} customer.</p>
<p>After reviewing your application, we were unable to approve your account at this time.</p>
<p>If you have any questions or believe this was an error, please contact us at <a href="mailto:${COMPANY_EMAIL}" style="color:#1a7fbd;">${COMPANY_EMAIL}</a>.</p>
`);
}

// Template 5c: New customer registration (sent to admin)
function templateNewRegistrationAdmin(customerName: string, customerEmail: string, empresa: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">New Customer Registration</h2>
<p>A new customer has registered and is waiting for approval:</p>
<ul style="line-height:1.8;">
  <li><strong>Name:</strong> ${customerName || "—"}</li>
  <li><strong>Company:</strong> ${empresa || "—"}</li>
  <li><strong>Email:</strong> ${customerEmail}</li>
</ul>
<p><a href="${COMPANY_SITE}admin/customers" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Review in Admin Panel</a></p>
`);
}

// Template 6: Set password instructions (new customer invited by admin)
function templateSetPassword(customerName: string, resetLink: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Welcome ${customerName}!</h2>
<p>You can now place your orders online</p>
<p>Please use the following link to set your password at ${COMPANY_NAME}</p>
<p><a href="${resetLink}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Set my password and login</a></p>
<p style="font-size:12px;color:#888;">${resetLink}</p>
<p style="font-size:12px;color:#888;">Your password won't change until you access the link above and create a new one.</p>
`);
}

// Template 7: One-time login link (magic link)
function templateMagicLink(customerName: string, magicLink: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Your One-Time Login Link</h2>
<p>Hello ${customerName || ""},</p>
<p>Click the link below to log in. <strong>This link expires in 5 minutes.</strong></p>
<p><a href="${magicLink}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Login Now</a></p>
<p style="font-size:12px;color:#888;">${magicLink}</p>
<p style="font-size:12px;color:#888;">If you did not request this link, you can safely ignore this email.</p>
`);
}

// Template 9: Password reset (sent via our SMTP instead of Supabase default)
function templatePasswordReset(customerName: string, resetLink: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Password Reset Request</h2>
<p>Hello ${customerName || ""},</p>
<p>We received a request to reset your password. Click the button below to set a new password:</p>
<p><a href="${resetLink}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Reset My Password</a></p>
<p style="font-size:12px;color:#888;">${resetLink}</p>
<p style="font-size:12px;color:#888;">This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
`);
}

// Template 8: Notify customer — product available
function templateProductAvailable(customerName: string, products: { name: string; sku: string }[]) {
  const productList = products
    .map((p) => `<a href="${COMPANY_SITE}" style="color:#1a7fbd;">${p.sku}</a> - ${p.name}`)
    .join("<br/>");
  return wrapTemplate(`
<p>Hello,</p>
<p>The following items are back in stock!</p>
<p>${productList}</p>
`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Parse a comma-separated email string into a clean array */
function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

// ─── Send via provider ────────────────────────────────────────────────────────
// `to` and `bcc` accept comma-separated strings or arrays
async function sendViaProvider(
  provider: string,
  apiKey: string,
  fromEmail: string,
  to: string | string[],
  subject: string,
  html: string,
  replyTo?: string,
  bcc?: string | string[],
) {
  const toStr = Array.isArray(to) ? to.join(", ") : to;
  const bccStr = Array.isArray(bcc) ? bcc.join(", ") : bcc || "";
  const toArr = Array.isArray(to) ? to : parseEmails(to);
  const bccArr = Array.isArray(bcc) ? bcc : parseEmails(bcc);

  // ── SMTP (Office 365 / any SMTP server) ──────────────────────────────────
  // All SMTP credentials come from Supabase Secrets — NEVER from the database.
  if (provider === "smtp") {
    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.office365.com";
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("SMTP_USERNAME") || (fromEmail.match(/<(.+)>/)?.[1] ?? fromEmail);
    const smtpPassword = Deno.env.get("SMTP_PASSWORD") || "";

    if (!smtpPassword) {
      throw new Error("SMTP_PASSWORD secret not configured. Add it in backend secrets.");
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword },
      tls: { ciphers: "SSLv3", rejectUnauthorized: false },
    });

    const mailOptions: any = { from: fromEmail, to: toStr, subject, html };
    if (replyTo) mailOptions.replyTo = replyTo;
    if (bccStr) mailOptions.bcc = bccStr;

    await transporter.sendMail(mailOptions);
    return true;
  }

  let response: Response;
  if (provider === "resend") {
    const payload: any = { from: fromEmail, to: toArr, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    if (bccArr.length) payload.bcc = bccArr;
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else if (provider === "sendgrid") {
    const sgPayload: any = {
      personalizations: [{ to: toArr.map((e) => ({ email: e })), subject }],
      from: { email: fromEmail },
      content: [{ type: "text/html", value: html }],
    };
    if (replyTo) sgPayload.reply_to = { email: replyTo };
    if (bccArr.length) sgPayload.personalizations[0].bcc = bccArr.map((e) => ({ email: e }));
    response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(sgPayload),
    });
  } else {
    throw new Error(`Unknown provider: "${provider}". Use "resend", "sendgrid", or "smtp".`);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`${provider} API error [${response.status}]: ${errBody}`);
  }
  return true;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: config } = await adminClient
      .from("configuracoes")
      .select(
        "email_provider, email_api_key, email_from, email_reply_to, email_on_approval, email_on_new_order, email_on_order_status, email_on_new_registration, email_on_rejection, email_contato, email_new_orders, email_new_customer, bcc_outgoing_emails",
      )
      .limit(1)
      .maybeSingle();

    const provider = config?.email_provider || "";
    const apiKey = config?.email_api_key || "";
    const fromEmail = config?.email_from || "noreply@permshield.com";
    const replyTo = config?.email_reply_to || "";

    // For SMTP, credentials come from secrets — apiKey in DB is not required
    if (!provider) {
      return new Response(
        JSON.stringify({ error: "Email service not configured. Go to Settings → Email and select a provider." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (provider !== "smtp" && !apiKey) {
      return new Response(JSON.stringify({ error: "Email API key not configured. Go to Settings → Email." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { type } = body;

    // ── Route by email type ──────────────────────────────────────────────────
    let to = "";
    let subject = "";
    let html = "";

    if (type === "approval") {
      // Customer approved
      if (config?.email_on_approval === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "approval notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName, loginUrl } = body;
      to = customerEmail;
      subject = "Your account has been approved!";
      html = templateApproval(customerName, loginUrl || `${COMPANY_SITE}customers-login`);
    } else if (type === "waiting_approval") {
      // New customer signup — notify customer
      const { customerEmail } = body;
      to = customerEmail;
      subject = "Thank you for your application!";
      html = templateWaitingApproval(customerEmail);
    } else if (type === "new_order_admin") {
      // New order — notify admin(s)
      if (config?.email_on_new_order === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "new_order admin notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order, customer, items, adminEmail } = body;
      // email_new_orders = comma-separated admin notification emails; fallback to single adminEmail / email_contato
      const adminEmails = parseEmails(config?.email_new_orders) || [];
      to = adminEmails.length ? adminEmails : adminEmail || config?.email_contato || COMPANY_EMAIL;
      subject = `New Order #${order.numero || order.id} from ${customer.empresa || customer.nome}`;
      html = templateNewOrderAdmin(order, customer, items || []);
    } else if (type === "new_order_customer") {
      // New order — confirm to customer (+ BCC to configured addresses)
      if (config?.email_on_new_order === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "new_order customer notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order, customer, items } = body;
      // Fetch company branding from configuracoes for the email header
      const { data: companyData } = await adminClient
        .from("configuracoes")
        .select("company_name, company_address, company_city, company_state, company_zip, email_from")
        .limit(1)
        .maybeSingle();
      to = customer.email;
      subject = `Order #${order.numero || order.id} received – ${companyData?.company_name || COMPANY_NAME}`;
      html = templateNewOrderCustomer(order, customer, items || [], companyData);
    } else if (type === "order_status_change") {
      // Order status updated — notify customer
      if (config?.email_on_order_status === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "status_change notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order, customer, newStatus } = body;
      to = customer.email;
      subject = `Order #${order.numero || order.id} status update – ${COMPANY_NAME}`;
      html = templateOrderStatusChange(order, customer, newStatus);
    } else if (type === "rejection") {
      // Customer rejected — notify customer
      if (config?.email_on_rejection === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "rejection notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName } = body;
      to = customerEmail;
      subject = `Application Update — ${COMPANY_NAME}`;
      html = templateRejection(customerName);
    } else if (type === "new_registration_admin") {
      // New customer registered — notify admin(s)
      if (config?.email_on_new_registration === false) {
        return new Response(JSON.stringify({ skipped: true, reason: "new_registration notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName, empresa, adminEmail } = body;
      // email_new_customer = comma-separated emails for new customer alerts
      const customerAdminEmails = parseEmails(config?.email_new_customer) || [];
      to = customerAdminEmails.length ? customerAdminEmails : adminEmail || config?.email_contato || COMPANY_EMAIL;
      subject = `New Customer Registration: ${empresa || customerName}`;
      html = templateNewRegistrationAdmin(customerName, customerEmail, empresa);
    } else if (type === "set_password") {
      // New contact/user created — send set password link
      const { customerEmail, customerName, resetLink } = body;
      to = customerEmail;
      subject = `Welcome to ${COMPANY_NAME} — Set your password`;
      html = templateSetPassword(customerName, resetLink);
    } else if (type === "magic_link") {
      // One-time login link (generated by Supabase, we just send the formatted email)
      const { customerEmail, customerName, magicLink } = body;
      to = customerEmail;
      subject = `Your one-time login link – ${COMPANY_NAME}`;
      html = templateMagicLink(customerName, magicLink);
    } else if (type === "product_available") {
      // Back-in-stock notification
      const { customerEmail, customerName, products } = body;
      to = customerEmail;
      subject = `Products back in stock – ${COMPANY_NAME}`;
      html = templateProductAvailable(customerName, products || []);
    } else if (type === "password_reset") {
      // Password reset — generate link via admin API and send via our SMTP
      const { email: resetEmail, redirectTo } = body;
      if (!resetEmail) {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Generate the reset link using Supabase Admin API
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: resetEmail,
        options: { redirectTo: redirectTo || undefined },
      });
      if (linkError) {
        // Don't reveal if the user doesn't exist — just return success silently
        console.log(`[send-email] password_reset: user not found or error for ${resetEmail}:`, linkError.message);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Build the proper redirect URL with token hash
      const actionLink = linkData?.properties?.action_link || "";
      // Try to find customer name
      const { data: customerData } = await adminClient
        .from("clientes")
        .select("nome")
        .eq("email", resetEmail)
        .maybeSingle();
      const custName = customerData?.nome || "";
      to = resetEmail;
      subject = `Password Reset — ${COMPANY_NAME}`;
      html = templatePasswordReset(custName, actionLink);
    } else if (type === "raw") {
      // Direct send (for testing and custom uses)
      const { to: rawTo, subject: rawSubject, html: rawHtml } = body;
      to = rawTo;
      subject = rawSubject;
      html = rawHtml;
    } else {
      return new Response(
        JSON.stringify({
          error: `Unknown email type: "${type}". Use: approval, waiting_approval, new_order_admin, new_order_customer, order_status_change, set_password, magic_link, product_available, raw`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // BCC: add configured bcc_outgoing_emails to all customer-facing emails
    const CUSTOMER_TYPES = [
      "approval",
      "waiting_approval",
      "new_order_customer",
      "order_status_change",
      "rejection",
      "set_password",
      "magic_link",
      "product_available",
      "password_reset",
    ];
    const bcc = CUSTOMER_TYPES.includes(type) ? config?.bcc_outgoing_emails || "" : "";

    await sendViaProvider(provider, apiKey, fromEmail, to, subject, html, replyTo || undefined, bcc || undefined);

    const toDisplay = Array.isArray(to) ? to.join(", ") : to;
    console.log(`[send-email] Sent "${type}" to ${toDisplay}${bcc ? ` | BCC: ${bcc}` : ""}`);
    return new Response(JSON.stringify({ success: true, type, to }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[send-email] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
