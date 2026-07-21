import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.8";
import { Buffer } from "node:buffer";
// Import ESTÁTICO do gerador de PDF — garante que o código ATUAL do gerador
// entra no bundle a cada deploy. (Era import dinâmico, que podia rodar uma
// versão em cache — causa do "PDF continua o antigo" mesmo após redeploy.)
// ─── GERADOR DE PDF EMBUTIDO (era ../_shared/pdfGenerator.ts) ────────────────
// Embutido AQUI de propósito: garante que o código ATUAL do PDF entra no deploy
// da send-email, sem depender do arquivo compartilhado ser reempacotado (causa
// do "PDF continua o antigo" apesar de redeploy). Fonte canônica p/ teste local:
// _shared/pdfGenerator.ts — manter os dois em sincronia se mudar o layout.
import { PDFDocument, StandardFonts, rgb, PDFFont } from "npm:pdf-lib@1.17.1";

interface PdfOrderItem { sku: string; name: string; qty: number; price: number; total: number; }
interface PdfOrderData {
  orderNumber: string; orderDate: string; poNumber?: string; deliveryDate?: string;
  customerName: string; customerContact?: string; customerEmail?: string; customerPhone?: string;
  customerAddress?: string; companyName: string; companyAddress?: string; companyEmail?: string;
  logoUrl?: string; logoPosition?: "left" | "center" | "right";
  items: PdfOrderItem[]; subtotal: number; discount: number; shipping: number; tax: number;
  grossTotal: number; notes?: string;
}
const _PW = 612, _PH = 792, _MG = 40;
const _NAVY = rgb(0.102, 0.176, 0.353), _GRAY = rgb(0.4, 0.4, 0.4), _LIGHT = rgb(0.92, 0.93, 0.96);
function _fmtUSD(n: number): string { return "$" + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
async function _embedLogo(pdfDoc: PDFDocument, url: string) {
  try {
    const res = await fetch(url); if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return await pdfDoc.embedPng(bytes);
    return await pdfDoc.embedJpg(bytes);
  } catch { return null; }
}
async function generateOrderPdf(data: PdfOrderData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const logoImg = data.logoUrl ? await _embedLogo(pdfDoc, data.logoUrl) : null;
  let page = pdfDoc.addPage([_PW, _PH]); let y = _PH - _MG;
  const newPage = () => { page = pdfDoc.addPage([_PW, _PH]); y = _PH - _MG; };
  const text = (t: string, x: number, yy: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(t || "", { x, y: yy, size: opts.size ?? 10, font: opts.font ?? regular, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
  const rightText = (t: string, xRight: number, yy: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? regular, size = opts.size ?? 10;
    text(t, xRight - font.widthOfTextAtSize(t || "", size), yy, opts);
  };
  const leftX = _MG;
  const clean = (t?: string) => (t || "").split(",").map((s) => s.trim()).filter((s) => s && !["-", "—", "n/a", "na"].includes(s.toLowerCase())).join(", ");
  const addr = clean(data.customerAddress);
  const headerTop = y;
  if (logoImg) {
    const scale = Math.min(200 / logoImg.width, 46 / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    page.drawImage(logoImg, { x: (_PW - w) / 2, y: headerTop - h, width: w, height: h });
    y = headerTop - h - 6;
  } else {
    const name = data.companyName || "PermShield";
    text(name, (_PW - bold.widthOfTextAtSize(name, 18)) / 2, headerTop - 18, { font: bold, size: 18, color: _NAVY });
    y = headerTop - 30;
  }
  const title = "Order";
  text(title, (_PW - regular.widthOfTextAtSize(title, 20)) / 2, y - 18, { size: 20, color: _GRAY });
  y -= 30;
  page.drawLine({ start: { x: _MG, y }, end: { x: _PW - _MG, y }, thickness: 1.5, color: _NAVY });
  y -= 20;
  const labelRight = _MG + 68, valueLeft = _MG + 76, valueMax = _MG + 68 + 190;
  let ly = y;
  const wrapAt = (t: string, maxRight: number, size = 9) => {
    const words = (t || "").split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const tt = cur ? `${cur} ${w}` : w; if (regular.widthOfTextAtSize(tt, size) > (maxRight - valueLeft) && cur) { lines.push(cur); cur = w; } else cur = tt; }
    if (cur) lines.push(cur); return lines;
  };
  const field = (label: string, value: string, opts: { bold?: boolean } = {}) => {
    rightText(label, labelRight, ly, { size: 8, color: rgb(0.42, 0.52, 0.66) });
    const lines = wrapAt(value || "", valueMax); if (lines.length === 0) lines.push("");
    lines.forEach((l, i) => text(l, valueLeft, ly - i * 12, { size: 9, font: opts.bold ? bold : regular, color: rgb(0.13, 0.13, 0.13) }));
    ly -= 13 + (lines.length - 1) * 12;
  };
  let ry = y;
  const companyLine = (t: string, opts: { bold?: boolean; color?: any } = {}) => {
    if (!t) return;
    rightText(t, _PW - _MG, ry, { size: opts.bold ? 11 : 9, font: opts.bold ? bold : regular, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
    ry -= 13;
  };
  const wrapRight = (t: string, maxW: number, size = 9) => {
    const words = (t || "").split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const tt = cur ? `${cur} ${w}` : w; if (regular.widthOfTextAtSize(tt, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = tt; }
    if (cur) lines.push(cur); return lines;
  };
  companyLine(data.companyName || "", { bold: true, color: _NAVY });
  if (data.companyAddress) for (const l of wrapRight(clean(data.companyAddress), 230)) companyLine(l);
  if (data.companyEmail) companyLine(data.companyEmail, { color: rgb(0.16, 0.5, 0.74) });
  field("Order", String(data.orderNumber || ""), { bold: true });
  field("PO", data.poNumber || "");
  field("Customer", data.customerName || "");
  if (data.customerContact) field("Contact", data.customerContact);
  field("Address", addr);
  field("Email", data.customerEmail || "");
  field("Date", data.orderDate || "");
  field("Delivery date", data.deliveryDate || "");
  field("Comments", data.notes || "");
  y = Math.min(ly, ry) - 16;
  const colCode = leftX, colName = leftX + 140, colQty = _PW - _MG - 150, colPrice = _PW - _MG - 100, colTotal = _PW - _MG;
  const fitText = (t: string, maxWidth: number, size: number) => {
    let s = t || ""; while (s.length > 1 && regular.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
    return s === (t || "") ? s : s.slice(0, -1) + "…";
  };
  const drawTableHeader = () => {
    page.drawRectangle({ x: _MG, y: y - 4, width: _PW - _MG * 2, height: 18, color: _NAVY });
    text("CODE", colCode + 4, y, { font: bold, size: 8, color: rgb(1, 1, 1) });
    text("PRODUCT", colName, y, { font: bold, size: 8, color: rgb(1, 1, 1) });
    rightText("QTY", colQty + 30, y, { font: bold, size: 8, color: rgb(1, 1, 1) });
    rightText("PRICE", colPrice + 40, y, { font: bold, size: 8, color: rgb(1, 1, 1) });
    rightText("TOTAL", colTotal, y, { font: bold, size: 8, color: rgb(1, 1, 1) });
    y -= 20;
  };
  drawTableHeader();
  data.items.forEach((it, idx) => {
    if (y < 130) { newPage(); drawTableHeader(); }
    if (idx % 2 === 1) page.drawRectangle({ x: _MG, y: y - 4, width: _PW - _MG * 2, height: 16, color: _LIGHT });
    text(fitText(it.sku || "—", colName - colCode - 12, 9), colCode + 4, y, { size: 9, color: _NAVY });
    text(fitText(it.name || "", colQty - colName - 8, 9), colName, y, { size: 9 });
    rightText(String(it.qty), colQty + 30, y, { size: 9 });
    rightText(_fmtUSD(it.price), colPrice + 40, y, { size: 9 });
    rightText(_fmtUSD(it.total), colTotal, y, { size: 9, font: bold });
    y -= 16;
  });
  y -= 10;
  page.drawLine({ start: { x: _MG, y: y + 6 }, end: { x: _PW - _MG, y: y + 6 }, thickness: 0.5, color: _GRAY });
  if (y < 140) newPage();
  const totalsRow = (label: string, value: string, big = false) => {
    rightText(label, colTotal - 90, y, { size: big ? 11 : 9, color: big ? _NAVY : _GRAY, font: big ? bold : regular });
    rightText(value, colTotal, y, { size: big ? 12 : 9, font: bold, color: big ? _NAVY : rgb(0.13, 0.13, 0.13) });
    y -= big ? 18 : 15;
  };
  totalsRow("Subtotal", _fmtUSD(data.subtotal));
  if (data.discount > 0) totalsRow("Discount", `-${_fmtUSD(data.discount)}`);
  if (data.shipping > 0) totalsRow("Shipping", _fmtUSD(data.shipping));
  if (data.tax > 0) totalsRow("Sales Tax", _fmtUSD(data.tax));
  page.drawLine({ start: { x: colTotal - 160, y: y + 10 }, end: { x: colTotal, y: y + 10 }, thickness: 1.5, color: _NAVY });
  y -= 6;
  totalsRow("Gross Total", _fmtUSD(data.grossTotal), true);
  const footerY = 36;
  text(data.companyName || "", _MG, footerY, { font: bold, size: 9, color: _NAVY });
  if (data.companyEmail) text(data.companyEmail, _MG, footerY - 12, { size: 8, color: _GRAY });
  // CARIMBO DE VERSÃO (diagnóstico): se este marcador aparecer no PDF do email,
  // o deploy do send-email pegou o código novo. Se NÃO aparecer, o deploy está
  // stale (Lovable não redeployou). Remover depois de confirmado.
  rightText("layout 0721b", _PW - _MG, footerY - 12, { size: 7, color: _GRAY });
  return await pdfDoc.save();
}
// ─── fim do gerador embutido ─────────────────────────────────────────────────

// Deno edge runtime may require an npm install hint when resolving Node packages locally.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Escapa HTML em qualquer valor livre interpolado (nome da empresa, comentário do
// pedido, nome de produto, etc.) — evita injeção de HTML/script no inbox do admin
// e na confirmação do cliente (esses campos vêm do cliente/B2BWave).
function esc(v: any): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// ─── Email Templates ──────────────────────────────────────────────────────────
// Following the B2BWave email template style (Zap Supplies, LLC branding)

const COMPANY_NAME = "Zap Supplies, LLC";
// Portal REAL (não o b2bwave antigo). Configurável por env pra quando houver
// domínio próprio; fallback pro Vercel atual.
const COMPANY_SITE = (Deno.env.get("PORTAL_URL") || "https://b2bpermshield.vercel.app/").replace(/\/*$/, "/");
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
<p><strong>Username:</strong> ${esc(customerEmail)}</p>
`);
}

// Template 3: New order (sent to admin)
function templateNewOrderAdmin(order: any, customer: any, items: any[]) {
  const itemRows = items
    .map(
      (i) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">
        <span style="color:#1a7fbd;">${esc(i.sku || "–")}</span><br/>
        <small style="color:#888;">${esc(i.sku || "")}</small>
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(i.nome_produto || i.name || "")}<br/><small>${esc(i.notes || "")}</small></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.preco_unitario || 0).toFixed(2)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${i.quantidade}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.subtotal || 0).toFixed(2)}</td>
    </tr>
  `,
    )
    .join("");

  return wrapTemplate(`
<h2 style="color:#1a7fbd;">New Order</h2>
<p>
  <strong>Customer:</strong> ${esc(customer.empresa || customer.nome || "")}<br/>
  <strong>Email:</strong> ${esc(customer.email || "")}<br/>
  <strong>Order Id:</strong> ${esc(order.numero || order.id || "")}<br/>
  ${order.po_number ? `<strong>Purchase order:</strong> ${esc(order.po_number)}<br/>` : ""}
  ${order.observacoes ? `<strong>Comments:</strong> ${esc(order.observacoes)}<br/>` : ""}
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
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#1a7fbd;">${esc(i.sku || i.codigo || "–")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${esc(i.nome_produto || i.name || "")}</td>
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
        <strong>${esc(customer.empresa || customer.nome || "")}</strong><br/>
        ${customer.nome && customer.empresa ? `${esc(customer.nome)}<br/>` : ""}
        ${customer.email ? `${esc(customer.email)}<br/>` : ""}
        ${addr ? `${esc(addr)}<br/>` : ""}
        ${custCity || custState || custZip ? `${esc(custCity)}${custState ? `, ${esc(custState)}` : ""}${custZip ? ` ${esc(custZip)}` : ""}<br/>` : ""}
      </p>
    </td>
    <td width="50%" style="vertical-align:top;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:13px;">
        <tr><td style="color:#555;">Order Date:</td><td style="text-align:right;font-weight:bold;">${orderDate}</td></tr>
        ${order.po_number ? `<tr><td style="color:#555;">PO Number:</td><td style="text-align:right;font-weight:bold;">${esc(order.po_number)}</td></tr>` : ""}
        ${order.delivery_date ? `<tr><td style="color:#555;">Delivery Date:</td><td style="text-align:right;font-weight:bold;">${order.delivery_date}</td></tr>` : ""}
        ${order.pagamento || order.payment_method ? `<tr><td style="color:#555;">Payment:</td><td style="text-align:right;font-weight:bold;">${esc(order.pagamento || order.payment_method)}</td></tr>` : ""}
        ${order.frete || order.shipping_method ? `<tr><td style="color:#555;">Shipping:</td><td style="text-align:right;font-weight:bold;">${esc(order.frete || order.shipping_method)}</td></tr>` : ""}
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

${order.observacoes ? `<p style="margin:16px 0 0 0;padding:12px;background:#fffbea;border-left:3px solid #f5a623;font-size:13px;color:#333;"><strong>Notes:</strong> ${esc(order.observacoes)}</p>` : ""}

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
<p>Hello ${esc(customer.nome || customer.empresa || "")},</p>
<p>Your order <strong>#${esc(order.numero || order.id)}</strong> status has been updated to: <strong>${esc(statusLabel[newStatus] || newStatus)}</strong></p>
<p><a href="${COMPANY_SITE}" style="display:inline-block;background:#1a7fbd;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">View My Orders</a></p>
`);
}

// Template 5b: Account rejected (sent to customer)
function templateRejection(customerName: string) {
  return wrapTemplate(`
<h2 style="color:#1a7fbd;">Application Update</h2>
<p>Hello ${esc(customerName || "")},</p>
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
  <li><strong>Name:</strong> ${esc(customerName || "—")}</li>
  <li><strong>Company:</strong> ${esc(empresa || "—")}</li>
  <li><strong>Email:</strong> ${esc(customerEmail)}</li>
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
  // esc() em sku/name — vêm do body e antes eram interpolados crus (injeção de HTML).
  const productList = products
    .map((p) => `<a href="${COMPANY_SITE}" style="color:#1a7fbd;">${esc(p.sku)}</a> - ${esc(p.name)}`)
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

// Anexo em memória (bytes) — convertido pro formato de cada provedor na hora de enviar.
export interface EmailAttachment { filename: string; content: Uint8Array }

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
  attachments?: EmailAttachment[],
) {
  const toStr = Array.isArray(to) ? to.join(", ") : to;
  const bccStr = Array.isArray(bcc) ? bcc.join(", ") : bcc || "";
  const toArr = Array.isArray(to) ? to : parseEmails(to);
  const bccArr = Array.isArray(bcc) ? bcc : parseEmails(bcc);
  // base64 sem depender de Buffer (disponível no Deno runtime, mas evitamos a dependência)
  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

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
    if (attachments?.length) {
      mailOptions.attachments = attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) }));
    }

    await transporter.sendMail(mailOptions);
    return true;
  }

  let response: Response;
  if (provider === "resend") {
    const payload: any = { from: fromEmail, to: toArr, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    if (bccArr.length) payload.bcc = bccArr;
    if (attachments?.length) {
      payload.attachments = attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content) }));
    }
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
    if (attachments?.length) {
      sgPayload.attachments = attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content), type: "application/pdf", disposition: "attachment" }));
    }
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

// Envia EMAIL com RESEND como PRIMÁRIO e Office365/SMTP como FALLBACK silencioso
// (mesmo template e mesmo "from"). Só cai no fallback se o Resend falhar — então
// nunca há duplicidade. SendGrid fica como última tentativa se for o provider setado.
async function sendEmailResilient(
  config: any, fromEmail: string, to: string | string[], subject: string,
  html: string, replyTo?: string, bcc?: string | string[], attachments?: EmailAttachment[],
): Promise<{ ok: boolean; provider?: string; fallback?: boolean; error?: string; resendError?: string }> {
  const resendKey =
    (config?.email_provider === "resend" ? (config?.email_api_key || "") : "") ||
    Deno.env.get("RESEND_API_KEY") || "";
  const smtpAvailable = !!Deno.env.get("SMTP_PASSWORD");
  const errors: string[] = [];
  let resendError: string | undefined; // erro EXATO que o Resend retornou (p/ alertar o admin)

  // 1) PRIMÁRIO: Resend. (Se não tiver chave, NÃO é "falha" — é só que o Resend não
  // está configurado e o Office365 assume; nesse caso não alertamos o admin.)
  if (resendKey) {
    try {
      await sendViaProvider("resend", resendKey, fromEmail, to, subject, html, replyTo, bcc, attachments);
      return { ok: true, provider: "resend" };
    } catch (e: any) { resendError = e.message; errors.push(`resend: ${e.message}`); }
  }
  // 2) FALLBACK silencioso: Office365 / SMTP (mesmo template/from)
  if (smtpAvailable) {
    try {
      await sendViaProvider("smtp", "", fromEmail, to, subject, html, replyTo, bcc, attachments);
      return { ok: true, provider: "smtp", fallback: true, resendError };
    } catch (e: any) { errors.push(`smtp(office365): ${e.message}`); }
  }
  // 3) Último recurso: SendGrid (se for o provider configurado)
  if (config?.email_provider === "sendgrid" && config?.email_api_key) {
    try {
      await sendViaProvider("sendgrid", config.email_api_key, fromEmail, to, subject, html, replyTo, bcc, attachments);
      return { ok: true, provider: "sendgrid", resendError };
    } catch (e: any) { errors.push(`sendgrid: ${e.message}`); }
  }
  return { ok: false, error: errors.join(" | ") || "nenhum provedor de email disponível (configure RESEND_API_KEY ou SMTP_PASSWORD)", resendError };
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
        "email_provider, email_api_key, email_from, email_reply_to, email_on_approval, email_on_new_order, email_on_order_status, email_on_new_registration, email_on_rejection, email_contato, email_new_orders, email_new_customer, bcc_outgoing_emails, nome_empresa, endereco",
      )
      .limit(1)
      .maybeSingle();

    // Template e logo em queries SEPARADAS e tolerantes. Antes era um select
    // combinado das 3 colunas: se as colunas de LOGO (mais novas) não estivessem
    // no schema cache do PostgREST, a query inteira falhava e o email_order_template
    // (que EXISTE desde abril) era perdido junto → o email SEMPRE caía no template
    // fixo, ignorando o customizado. (Causa do "email não muda".)
    let customTemplateCfg: { email_order_template?: string | null; email_logo_url?: string | null; email_logo_position?: string | null } = {};
    try {
      const { data } = await adminClient.from("configuracoes")
        .select("email_order_template").limit(1).maybeSingle();
      if (data) customTemplateCfg.email_order_template = data.email_order_template;
    } catch (_e) { /* sem template custom → fallback fixo */ }
    try {
      const { data } = await adminClient.from("configuracoes")
        .select("email_logo_url, email_logo_position").limit(1).maybeSingle();
      if (data) { customTemplateCfg.email_logo_url = data.email_logo_url; customTemplateCfg.email_logo_position = data.email_logo_position; }
    } catch (_e) { /* sem logo */ }

    // Templates customizados POR TIPO (aba Notifications → Email → All email
    // templates; tabela email_templates). corpo vazio/inexistente → fallback
    // fixo em código. Query tolerante: sem tabela/erro, tudo cai no fallback.
    const customTemplates: Record<string, { assunto: string | null; corpo: string | null }> = {};
    try {
      const { data: tpls } = await adminClient.from("email_templates").select("tipo, assunto, corpo, ativo");
      for (const t of tpls ?? []) {
        if (t?.tipo && t.ativo !== false) customTemplates[t.tipo] = { assunto: t.assunto, corpo: t.corpo };
      }
    } catch (_e) { /* fallback fixo */ }

    const renderVars = (tpl: string, vars: Record<string, string>) =>
      Object.entries(vars).reduce((h, [k, v]) => h.split(`{{${k}}}`).join(v), tpl);

    const logoHeaderHtml = customTemplateCfg.email_logo_url
      ? `<div style="display:flex;justify-content:${customTemplateCfg.email_logo_position === "center" ? "center" : customTemplateCfg.email_logo_position === "right" ? "flex-end" : "flex-start"};margin-bottom:16px;"><img src="${customTemplateCfg.email_logo_url}" alt="Logo" style="max-height:64px;max-width:280px;" /></div>`
      : "";

    // Usa o template customizado do tipo quando houver corpo; senão o fallback.
    // (A logo é prependada CENTRALMENTE antes do envio — não aqui.)
    const customOr = (tipo: string, vars: Record<string, string>, fallbackSubject: string, fallbackHtml: string) => {
      const t = customTemplates[tipo];
      if (t?.corpo) {
        return {
          subject: t.assunto ? renderVars(t.assunto, vars) : fallbackSubject,
          html: renderVars(t.corpo, vars),
        };
      }
      return { subject: fallbackSubject, html: fallbackHtml };
    };

    const provider = config?.email_provider || "";
    const apiKey = config?.email_api_key || "";
    const fromEmail = config?.email_from || "noreply@permshield.com";
    const replyTo = config?.email_reply_to || "";

    // Resend é o primário; Office365/SMTP é o fallback. Basta UM estar disponível.
    const hasResend = !!(Deno.env.get("RESEND_API_KEY") || (provider === "resend" && apiKey));
    const hasSmtp = !!Deno.env.get("SMTP_PASSWORD");
    const hasSendgrid = provider === "sendgrid" && !!apiKey;
    if (!hasResend && !hasSmtp && !hasSendgrid) {
      return new Response(
        JSON.stringify({ error: "Email não configurado: defina RESEND_API_KEY (primário) ou SMTP_PASSWORD (fallback Office365)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { type } = body;

    // INTERRUPTOR MESTRE de email (canal Email em Notifications → Channels).
    // Se o canal está OFF, NENHUM email de NOTIFICAÇÃO sai — mesmo que os flags
    // email_on_* estejam ligados/nulos (era o bypass: flags dessincronizados do
    // canal). Emails de AUTH (reset de senha, magic link, set password) e alertas
    // internos NÃO são bloqueados — senão o cliente não consegue nem logar.
    // `force` (Resend manual do admin) também passa.
    let emailChannelOff = false;
    try {
      const { data: emailCh } = await adminClient.from("notification_channels")
        .select("enabled").eq("id", "email").maybeSingle();
      emailChannelOff = emailCh?.enabled === false;
    } catch (_e) { /* na dúvida, não bloqueia */ }
    const AUTH_TYPES = new Set(["password_reset", "magic_link", "set_password", "admin_alert", "raw"]);
    if (emailChannelOff && !AUTH_TYPES.has(type) && body.force !== true) {
      await adminClient.from("notification_log").insert({
        event: type, channel: "email", recipient: "-",
        status: "failed", error: "skip: email channel is OFF (master switch)", payload: {},
      });
      return new Response(JSON.stringify({ skipped: true, reason: "email channel disabled (master switch)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // force=true: admin escolheu enviar MESMO com a notificação desabilitada
    // (ex.: aprovar cliente com canal de email OFF — sem isso a conta ficava
    // impossível de ativar por email). Só afeta os checks email_on_*.
    const force = body.force === true;

    // ── SEGURANÇA: tipos privilegiados (email 100% arbitrário / links de auth)
    //    só admin ou cron. Sem isto, qualquer um com a anon key (que está no
    //    bundle do front) usava `raw` como relay de spam/phishing pelo seu domínio,
    //    ou disparava set_password/magic_link com link forjado.
    // `admin_alert` também é arbitrário (to/subject/html do body) -> privilegiado.
    // `toOverride` (usado pelo "Resend" da tela de pedido) manda o email de
    // pedido pra um destinatário ARBITRÁRIO — por isso exige admin, igual aos
    // tipos privilegiados. Sem isso viraria relay de spam com a anon key.
    // ── Contexto do chamador (computado UMA vez, reusado nas travas abaixo) ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET");
    const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    // chamada server-to-server (register-customer, b2bwave-sync, self-alert) usa a
    // service-role key como bearer.
    const viaService = !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      && authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    let isAdmin = viaCron || viaService;
    let callerEmail = "";            // email do usuário LOGADO (se houver sessão)
    let isLoggedIn = viaCron || viaService;
    if (!isAdmin) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        isLoggedIn = true;
        callerEmail = (user.email ?? "").trim().toLowerCase();
        const { data: adminRow } = await adminClient.from("user_roles")
          .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
        isAdmin = !!adminRow;
      }
    }
    const isPrivilegedCaller = viaCron || viaService || isAdmin;

    // ── SEGURANÇA 1: tipos privilegiados (email 100% arbitrário / links de auth)
    //    e `toOverride` (destino arbitrário do Resend) só admin/cron/service.
    const PRIVILEGED_TYPES = new Set(["raw", "set_password", "magic_link", "admin_alert"]);
    if ((PRIVILEGED_TYPES.has(type) || body.toOverride) && !isPrivilegedCaller) {
      return new Response(JSON.stringify({ error: "Not authorized for this email type" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SEGURANÇA 2 (anti-relay): tipos de NOTIFICAÇÃO com destinatário vindo do
    //    body. A anon key está no bundle do front, então sem trava qualquer um
    //    mandava email com a marca/domínio da empresa pra qualquer vítima.
    //    • customer-facing (destino = email do cliente/body): só admin/service/cron,
    //      OU o próprio usuário logado mandando pra ELE MESMO (checkout do cliente).
    //    • admin-facing (destino = emails do admin da config, não do body): exige
    //      ao menos um chamador logado/servidor (evita spam anônimo ao admin).
    const CUSTOMER_FACING = new Set([
      "new_order_customer", "order_status_change", "approval", "waiting_approval",
      "rejection", "product_available",
    ]);
    const ADMIN_FACING = new Set(["new_order_admin", "new_registration_admin"]);
    const bodyRecipient = String(body.customerEmail ?? body.customer?.email ?? body.order?.customer?.email ?? "").trim().toLowerCase();
    if (CUSTOMER_FACING.has(type) && !isPrivilegedCaller) {
      // Aceita se o destino for o email de LOGIN do chamador OU o email da FICHA
      // dele em `clientes` (cobre cliente cujo email de cadastro difere do login,
      // sub-usuário, migrado). Só bloqueia relay pra terceiro de verdade.
      const ownEmails = new Set<string>();
      if (callerEmail) ownEmails.add(callerEmail);
      if (isLoggedIn) {
        try {
          const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } } });
          const { data: { user: u2 } } = await uc.auth.getUser();
          if (u2) {
            const { data: cliRow } = await adminClient.from("clientes")
              .select("email").eq("user_id", u2.id).maybeSingle();
            if (cliRow?.email) ownEmails.add(String(cliRow.email).trim().toLowerCase());
          }
        } catch (_e) { /* mantém só o email de login */ }
      }
      if (!bodyRecipient || !ownEmails.has(bodyRecipient)) {
        return new Response(JSON.stringify({ error: "Not authorized: recipient must be your own account" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (ADMIN_FACING.has(type) && !isLoggedIn) {
      return new Response(JSON.stringify({ error: "Not authorized for this email type" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Route by email type ──────────────────────────────────────────────────
    let to = "";
    let subject = "";
    let html = "";
    let orderPdfAttachment: EmailAttachment | undefined;

    // Gera o PDF do pedido (anexado no email do CLIENTE e no do ADMIN).
    // Import dinâmico + try/catch: falha de PDF nunca derruba o email.
    const buildOrderPdf = async (order: any, customer: any, items: any[]) => {
      try {

        // HIDRATA do banco — o `order`/`customer` que chega do checkout costuma vir
        // PARCIAL (sem endereço do cliente, às vezes sem PO/comments). Buscar a linha
        // completa garante que o PDF tenha os MESMOS dados do email (PO, comments,
        // endereço de entrega), venha de onde vier a chamada.
        let ord = order;
        if (order?.id) {
          const { data: full } = await adminClient.from("pedidos").select("*").eq("id", order.id).maybeSingle();
          if (full) ord = { ...order, ...full };
        }
        // Cliente completo (endereço) — pelo cliente_id do pedido ou pelo id passado.
        let cust = customer ?? {};
        const cliId = ord?.cliente_id ?? customer?.id;
        if (cliId) {
          const { data: cli } = await adminClient.from("clientes")
            .select("nome, empresa, email, endereco, endereco2, cidade, estado, cep, telefone").eq("id", cliId).maybeSingle();
          if (cli) cust = { ...cli, ...customer, email: customer?.email ?? cli.email };
        }
        // Endereço de ENTREGA do pedido (tem prioridade sobre o do cadastro).
        let ship: any = null;
        if (ord?.endereco_entrega_id) {
          const { data: e } = await adminClient.from("enderecos").select("*").eq("id", ord.endereco_entrega_id).maybeSingle();
          ship = e;
        }
        // MESMA prioridade do email (templateNewOrderCustomer): endereço de entrega
        // do pedido > campos do próprio pedido > cadastro do cliente. Assim o PDF
        // nunca vem mais vazio que o email.
        const addressParts = ship
          ? [ship.logradouro ?? ship.endereco, ship.complemento, ship.cidade, ship.estado, ship.cep]
          : [
              ord.endereco ?? cust.endereco, ord.endereco2 ?? cust.endereco2,
              ord.cidade ?? cust.cidade, ord.estado ?? cust.estado, ord.zip ?? ord.cep ?? cust.cep,
            ];
        const customerAddress = addressParts.filter(Boolean).join(", ");

        // Itens: se não vierem no argumento (ex.: email de atualização de status,
        // que chama com []), BUSCA do banco pelo order.id — senão o PDF sairia com
        // a tabela de itens VAZIA. (Bug pego na auditoria.)
        let itemsSrc = items;
        if ((!itemsSrc || itemsSrc.length === 0) && ord?.id) {
          const { data: dbItems } = await adminClient.from("pedido_itens")
            .select("*").eq("pedido_id", ord.id).order("created_at");
          itemsSrc = dbItems ?? [];
        }
        const pdfItems: PdfOrderItem[] = (itemsSrc || []).map((i: any) => ({
          sku: i.sku ?? "", name: i.nome_produto ?? i.name ?? "",
          qty: Number(i.quantidade ?? 0), price: Number(i.preco_unitario ?? 0), total: Number(i.subtotal ?? 0),
        }));
        const pdfBytes = await generateOrderPdf({
          orderNumber: String(ord.numero ?? ord.id ?? ""),
          orderDate: ord.created_at ? new Date(ord.created_at).toLocaleDateString("en-US") : "",
          poNumber: ord.po_number ?? "", deliveryDate: ord.delivery_date ? new Date(ord.delivery_date).toLocaleDateString("en-US") : "",
          customerName: cust.empresa || cust.nome || "", customerContact: (cust.empresa && cust.nome && cust.nome !== cust.empresa) ? cust.nome : "",
          customerEmail: cust.email ?? "", customerPhone: cust.telefone ?? "",
          customerAddress,
          companyName: config?.nome_empresa || COMPANY_NAME,
          companyAddress: config?.endereco || "",
          companyEmail: config?.email_contato || COMPANY_EMAIL,
          logoUrl: customTemplateCfg.email_logo_url ?? undefined,
          logoPosition: (customTemplateCfg.email_logo_position as "left" | "center" | "right") ?? "left",
          items: pdfItems,
          subtotal: Number(ord.subtotal ?? 0), discount: Number(ord.desconto ?? 0),
          shipping: Number(ord.shipping_costs ?? 0), tax: Number(ord.sales_tax ?? 0),
          grossTotal: Number(ord.total ?? 0), notes: ord.observacoes ?? "",
        });
        return { filename: `order-${ord.numero ?? ord.id ?? "confirmation"}.pdf`, content: pdfBytes } as EmailAttachment;
      } catch (pdfErr: any) {
        console.error("[send-email] PDF generation failed:", pdfErr?.message ?? pdfErr);
        return undefined;
      }
    };

    if (type === "approval") {
      // Customer approved
      if (config?.email_on_approval === false && !force) {
        return new Response(JSON.stringify({ skipped: true, reason: "approval notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName, loginUrl } = body;
      to = customerEmail;
      ({ subject, html } = customOr("approval", {
        customerName: esc(customerName ?? ""), customerEmail: esc(customerEmail ?? ""),
        loginUrl: loginUrl || `${COMPANY_SITE}customers-login`,
        companyName: config?.nome_empresa || COMPANY_NAME, companyEmail: config?.email_contato || COMPANY_EMAIL,
      }, "Your account has been approved!", templateApproval(customerName, loginUrl || `${COMPANY_SITE}customers-login`)));
    } else if (type === "waiting_approval") {
      // New customer signup — notify customer
      const { customerEmail } = body;
      to = customerEmail;
      ({ subject, html } = customOr("waiting_approval", {
        customerEmail: esc(customerEmail ?? ""),
        companyName: config?.nome_empresa || COMPANY_NAME, companyEmail: config?.email_contato || COMPANY_EMAIL,
      }, "Thank you for your application!", templateWaitingApproval(customerEmail)));
    } else if (type === "new_order_admin") {
      // New order — notify admin(s)
      if (config?.email_on_new_order === false && !force) {
        return new Response(JSON.stringify({ skipped: true, reason: "new_order admin notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order, customer, items, adminEmail } = body;
      // email_new_orders = comma-separated admin notification emails; fallback to single adminEmail / email_contato
      const adminEmails = parseEmails(config?.email_new_orders) || [];
      to = body.toOverride || (adminEmails.length ? adminEmails : adminEmail || config?.email_contato || COMPANY_EMAIL);
      const adminItemsTable = `<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">SKU</th><th style="padding:6px 8px;text-align:left;">Product</th><th style="padding:6px 8px;text-align:right;">Price</th><th style="padding:6px 8px;text-align:right;">Qty</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead><tbody>${
        (items || []).map((i: any) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.sku ?? "")}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.nome_produto ?? i.name ?? "")}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.preco_unitario || 0).toFixed(2)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${i.quantidade}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.subtotal || 0).toFixed(2)}</td></tr>`).join("")
      }</tbody></table>`;
      const fmtDateAdm = (d: string) => d ? new Date(d).toLocaleDateString("en-US") : "-";
      const adminVars: Record<string, string> = {
        orderNumber: String(order.numero || order.id || ""), orderDate: fmtDateAdm(order.created_at),
        poNumber: order.po_number ?? "", deliveryDate: order.delivery_date ? fmtDateAdm(order.delivery_date) : "-",
        customerCompany: esc(customer.empresa ?? ""), customerName: esc(customer.nome ?? ""), customerEmail: esc(customer.email ?? ""),
        customerAddress: [customer.endereco, customer.cidade, customer.estado].filter(Boolean).join(", "),
        grossTotal: `$${Number(order.total ?? 0).toFixed(2)}`, subtotal: `$${Number(order.subtotal ?? 0).toFixed(2)}`,
        discount: order.desconto ? `-$${Number(order.desconto).toFixed(2)}` : "$0.00",
        shippingCosts: order.shipping_costs ? `$${Number(order.shipping_costs).toFixed(2)}` : "$0.00",
        salesTax: order.sales_tax ? `$${Number(order.sales_tax).toFixed(2)}` : "$0.00",
        itemsTable: adminItemsTable, notes: esc(order.observacoes ?? ""),
        companyName: config?.nome_empresa || COMPANY_NAME,
        companyAddress: config?.endereco || "", companyEmail: config?.email_contato || COMPANY_EMAIL,
      };
      // PEDIDO DO DONO (2026-07-16): admin recebe o MESMO email de confirmação do
      // cliente. Fallback em cascata: template específico do tipo (email_templates)
      // → template "Order Confirmation" (configuracoes.email_order_template) → fixo.
      const adminFallbackHtml = customTemplateCfg.email_order_template
        ? renderVars(customTemplateCfg.email_order_template, adminVars)
        : templateNewOrderAdmin(order, customer, items || []);
      ({ subject, html } = customOr("new_order_admin", adminVars,
        `New Order #${order.numero || order.id} from ${customer.empresa || customer.nome}`,
        adminFallbackHtml));
      // Admin também recebe o PDF do pedido anexado.
      orderPdfAttachment = await buildOrderPdf(order, customer, items || []);
    } else if (type === "new_order_customer") {
      // New order — confirm to customer (+ BCC to configured addresses)
      if (config?.email_on_new_order === false && !force) {
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
      const orderItems: any[] = items || [];
      const companyName = config?.nome_empresa || companyData?.company_name || COMPANY_NAME;
      const companyAddress = config?.endereco || companyData?.company_address || "";
      const companyEmailAddr = config?.email_contato || COMPANY_EMAIL;
      to = body.toOverride || customer.email;
      subject = `Order #${order.numero || order.id} received – ${companyName}`;

      if (customTemplateCfg.email_order_template) {
        // Template customizado (aba Notifications → Email) — mesma renderização do preview do admin.
        const itemsTable = `<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">SKU</th><th style="padding:6px 8px;text-align:left;">Product</th><th style="padding:6px 8px;text-align:right;">Price</th><th style="padding:6px 8px;text-align:right;">Qty</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead><tbody>${
          orderItems.map((i) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.sku ?? "")}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.nome_produto ?? i.name ?? "")}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.preco_unitario || 0).toFixed(2)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${i.quantidade}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(i.subtotal || 0).toFixed(2)}</td></tr>`).join("")
        }</tbody></table>`;
        const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("en-US") : "-";
        const vars: Record<string, string> = {
          companyName, companyAddress, companyEmail: companyEmailAddr,
          orderNumber: String(order.numero ?? order.id ?? ""), orderDate: fmtDate(order.created_at),
          poNumber: order.po_number ?? "", deliveryDate: order.delivery_date ? fmtDate(order.delivery_date) : "-",
          customerCompany: customer.empresa ?? "", customerName: customer.nome ?? "", customerEmail: customer.email ?? "",
          customerAddress: [customer.endereco, customer.cidade, customer.estado].filter(Boolean).join(", "),
          itemsTable, subtotal: `$${Number(order.subtotal ?? 0).toFixed(2)}`,
          discount: order.desconto ? `-$${Number(order.desconto).toFixed(2)}` : "$0.00",
          shippingCosts: order.shipping_costs ? `$${Number(order.shipping_costs).toFixed(2)}` : "$0.00",
          salesTax: order.sales_tax ? `$${Number(order.sales_tax).toFixed(2)}` : "$0.00",
          grossTotal: `$${Number(order.total ?? 0).toFixed(2)}`, notes: order.observacoes ?? "",
        };
        // (logo prependada centralmente antes do envio — igual aos outros tipos)
        html = renderVars(customTemplateCfg.email_order_template, vars);
      } else {
        html = templateNewOrderCustomer(order, customer, items || [], companyData);
      }

      // PDF de verdade anexado — mesmos dados do email acima.
      orderPdfAttachment = await buildOrderPdf(order, customer, orderItems);
    } else if (type === "order_status_change") {
      // Order status updated — notify customer
      if (config?.email_on_order_status === false && !force) {
        return new Response(JSON.stringify({ skipped: true, reason: "status_change notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order, customer, newStatus } = body;
      to = customer.email;
      const statusLabels: Record<string, string> = {
        recebido: "Submitted", processando: "Processing", enviado: "Shipped",
        concluido: "Complete", cancelado: "Cancelled",
      };
      ({ subject, html } = customOr("order_status_change", {
        orderNumber: String(order.numero || order.id || ""),
        newStatus: statusLabels[newStatus] || esc(newStatus ?? ""),
        customerName: esc(customer.nome ?? customer.empresa ?? ""),
        companyName: config?.nome_empresa || COMPANY_NAME,
      }, `Order #${order.numero || order.id} status update – ${config?.nome_empresa || COMPANY_NAME}`,
        templateOrderStatusChange(order, customer, newStatus)));
      // Anexa o PDF ATUALIZADO — ao editar/mudar status a ordem vai com o PDF novo.
      // buildOrderPdf hidrata pedido+itens do banco pelo order.id, então reflete
      // as últimas mudanças (itens, PO, tracking, totais) mesmo sem passar items.
      orderPdfAttachment = await buildOrderPdf(order, customer, []);
    } else if (type === "rejection") {
      // Customer rejected — notify customer
      if (config?.email_on_rejection === false && !force) {
        return new Response(JSON.stringify({ skipped: true, reason: "rejection notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName } = body;
      to = customerEmail;
      ({ subject, html } = customOr("rejection", {
        customerName: esc(customerName ?? ""),
        companyName: config?.nome_empresa || COMPANY_NAME, companyEmail: config?.email_contato || COMPANY_EMAIL,
      }, `Application Update — ${config?.nome_empresa || COMPANY_NAME}`, templateRejection(customerName)));
    } else if (type === "new_registration_admin") {
      // New customer registered — notify admin(s)
      if (config?.email_on_new_registration === false && !force) {
        return new Response(JSON.stringify({ skipped: true, reason: "new_registration notifications disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { customerEmail, customerName, empresa, adminEmail } = body;
      // email_new_customer = comma-separated emails for new customer alerts
      const customerAdminEmails = parseEmails(config?.email_new_customer) || [];
      to = customerAdminEmails.length ? customerAdminEmails : adminEmail || config?.email_contato || COMPANY_EMAIL;
      ({ subject, html } = customOr("new_registration_admin", {
        customerName: esc(customerName ?? ""), customerEmail: esc(customerEmail ?? ""),
        customerCompany: esc(empresa ?? ""),
        companyName: config?.nome_empresa || COMPANY_NAME,
      }, `New Customer Registration: ${empresa || customerName}`,
        templateNewRegistrationAdmin(customerName, customerEmail, empresa)));
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
    } else if (type === "admin_alert") {
      // Alerta INTERNO ao admin (ex.: falha de notificação). Subject/html já prontos.
      const adminEmails = parseEmails(config?.email_new_orders) || [];
      to = body.adminEmail || (adminEmails.length ? adminEmails : config?.email_contato || COMPANY_EMAIL);
      subject = body.subject || "Alerta do sistema";
      html = body.html || "";
    } else if (type === "password_reset") {
      // Password reset — generate link via admin API and send via our SMTP
      const { email: resetEmail, redirectTo } = body;
      if (!resetEmail) {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // SEGURANÇA: valida o redirectTo contra uma allow-list (env ALLOWED_REDIRECT_ORIGINS,
      // CSV de origins). Sem isso, um atacante chamando direto com redirectTo=evil.com
      // levaria o token de recuperação pro domínio dele (account takeover). Se não casar
      // (ou env vazio), dropa -> Supabase usa o Site URL configurado (seguro).
      const allowedOrigins = (Deno.env.get("ALLOWED_REDIRECT_ORIGINS") || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      let safeRedirect: string | undefined = undefined;
      if (redirectTo && allowedOrigins.length > 0) {
        try { if (allowedOrigins.includes(new URL(redirectTo).origin)) safeRedirect = redirectTo; } catch { /* url inválida: dropa */ }
      }
      // Generate the reset link using Supabase Admin API
      const resetEmailNorm = String(resetEmail).trim().toLowerCase();
      let { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: resetEmailNorm,
        options: { redirectTo: safeRedirect },
      });
      if (linkError) {
        // Cliente migrado do B2BWave: existe em `clientes` mas nunca teve login
        // no auth — provisiona agora (mesma regra do request_magic_link: só
        // cliente ATIVO) e tenta de novo. Senão, silêncio genérico (não revela).
        const { data: cliRow } = await adminClient.from("clientes")
          .select("id, status, is_active, user_id")
          .ilike("email", resetEmailNorm).limit(1).maybeSingle();
        if (cliRow && cliRow.status === "ativo" && cliRow.is_active !== false) {
          const { data: created, error: cErr } = await adminClient.auth.admin.createUser({ email: resetEmailNorm, email_confirm: true });
          if (!cErr && created?.user) {
            await adminClient.from("clientes").update({ user_id: created.user.id }).eq("id", cliRow.id).is("user_id", null);
            await adminClient.from("user_roles").upsert({ user_id: created.user.id, role: "cliente" }, { onConflict: "user_id" });
            ({ data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
              type: "recovery", email: resetEmailNorm, options: { redirectTo: safeRedirect },
            }));
          }
        }
      }
      if (linkError) {
        // Don't reveal if the user doesn't exist — just return success silently
        console.log(`[send-email] password_reset: user not found or error for ${resetEmailNorm}:`, linkError.message);
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
        .ilike("email", resetEmailNorm)
        .limit(1)
        .maybeSingle();
      const custName = customerData?.nome || "";
      to = resetEmailNorm;
      subject = `Password Reset — ${COMPANY_NAME}`;
      html = templatePasswordReset(custName, actionLink);
    } else if (type === "request_magic_link") {
      // Login sem senha pra QUALQUER cliente ATIVO — inclusive os migrados do
      // B2BWave que ainda não têm login no auth (o signInWithOtp do front
      // recusava com "Signups not allowed for otp"). Provisiona o auth user na
      // hora, gera o link no servidor e envia. Resposta SEMPRE genérica (não
      // revela se o email é cadastrado). NÃO privilegiado: só envia pro
      // PRÓPRIO email informado, e só se for cliente ativo.
      const emailReq = String(body.email ?? "").trim().toLowerCase();
      const generic = () => new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (!emailReq || !emailReq.includes("@")) return generic();

      const { data: cli } = await adminClient.from("clientes")
        .select("id, nome, status, is_active, user_id")
        .ilike("email", emailReq).limit(1).maybeSingle();
      if (!cli || cli.status !== "ativo" || cli.is_active === false) {
        console.log(`[send-email] request_magic_link: no active customer for ${emailReq}`);
        return generic();
      }

      // redirect seguro — mesma allow-list do password_reset
      const allowedOrigins = (Deno.env.get("ALLOWED_REDIRECT_ORIGINS") || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      let safeRedirect: string | undefined = undefined;
      if (body.redirectTo && allowedOrigins.length > 0) {
        try { if (allowedOrigins.includes(new URL(body.redirectTo).origin)) safeRedirect = body.redirectTo; } catch { /* dropa */ }
      }

      let linkRes = await adminClient.auth.admin.generateLink({
        type: "magiclink", email: emailReq, options: { redirectTo: safeRedirect },
      });
      if (linkRes.error) {
        // Sem auth user (cliente migrado do B2BWave) → cria agora e vincula.
        const { data: created, error: cErr } = await adminClient.auth.admin.createUser({ email: emailReq, email_confirm: true });
        if (cErr || !created?.user) {
          console.log(`[send-email] request_magic_link: provisioning failed for ${emailReq}: ${cErr?.message}`);
          return generic();
        }
        await adminClient.from("clientes").update({ user_id: created.user.id }).eq("id", cli.id).is("user_id", null);
        await adminClient.from("user_roles").upsert({ user_id: created.user.id, role: "cliente" }, { onConflict: "user_id" });
        linkRes = await adminClient.auth.admin.generateLink({
          type: "magiclink", email: emailReq, options: { redirectTo: safeRedirect },
        });
        if (linkRes.error) {
          console.log(`[send-email] request_magic_link: generateLink still failing for ${emailReq}: ${linkRes.error.message}`);
          return generic();
        }
      }
      to = emailReq;
      subject = `Your one-time login link – ${config?.nome_empresa || COMPANY_NAME}`;
      html = templateMagicLink(cli.nome || "", linkRes.data?.properties?.action_link || "");
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
      "request_magic_link",
      "product_available",
      "password_reset",
    ];
    const bcc = CUSTOMER_TYPES.includes(type) ? config?.bcc_outgoing_emails || "" : "";

    // Logo no topo de TODO email com cara de marca (cliente E avisos de admin) —
    // central, uma vez só. Fora: raw e admin_alert (internos/arbitrários).
    const LOGO_TYPES = new Set([
      ...CUSTOMER_TYPES, "new_order_admin", "new_registration_admin",
    ]);
    if (logoHeaderHtml && LOGO_TYPES.has(type)) {
      html = logoHeaderHtml + html;
    }

    const result = await sendEmailResilient(
      config, fromEmail, to, subject, html, replyTo || undefined, bcc || undefined,
      orderPdfAttachment ? [orderPdfAttachment] : undefined,
    );
    const toDisplay = Array.isArray(to) ? to.join(", ") : to;

    // Registra TODO envio (sucesso / fallback / falha) no notification_log — nada silencioso.
    await adminClient.from("notification_log").insert({
      event: type, channel: "email", recipient: toDisplay,
      status: result.ok ? "sent" : "failed",
      error: result.ok
        ? (result.fallback
            ? (result.resendError ? `via Office365 (fallback) — Resend falhou: ${result.resendError}` : "via Office365 (Resend não configurado)")
            : null)
        : (result.error ?? "send failed"),
      payload: { provider: result.provider ?? null, fallback: result.fallback ?? false, resendError: result.resendError ?? null },
    });

    // Se o RESEND falhou (mesmo que o Office365 tenha salvado), avisa o admin com o
    // ERRO EXATO do Resend — não genérico. (Não dispara p/ o próprio admin_alert: sem loop.)
    if (result.resendError && type !== "admin_alert") {
      const adminEmails = parseEmails(config?.email_new_orders) || [];
      const adminTo = adminEmails.length ? adminEmails : (config?.email_contato || COMPANY_EMAIL);
      const alertHtml =
        `<p>O <b>Resend falhou</b> ao enviar o email "<b>${type}</b>" para <b>${toDisplay}</b>.</p>` +
        `<p><b>O Resend retornou:</b><br/><code>${result.resendError}</code></p>` +
        (result.ok
          ? `<p>✅ O email foi entregue mesmo assim pelo <b>fallback Office365</b> — o destinatário recebeu.</p>`
          : `<p>❌ O <b>fallback Office365 também falhou</b> — o destinatário NÃO recebeu este email.</p>`) +
        `<p>Verifique a conta/limite/billing do Resend.</p>`;
      // Chama o envio resiliente direto (não o handler) p/ não re-disparar alerta. Não bloqueia.
      sendEmailResilient(config, fromEmail, adminTo, `⚠ Resend falhou ao enviar "${type}"`, alertHtml)
        .then((r) => adminClient.from("notification_log").insert({
          event: "resend_failure_alert", channel: "email",
          recipient: Array.isArray(adminTo) ? adminTo.join(", ") : String(adminTo),
          status: r.ok ? "sent" : "failed", error: r.error ?? null,
          payload: { about: type, resend_error: result.resendError },
        }))
        .catch(() => {});
    }

    // Se NENHUM provedor enviou e não houve erro específico do Resend (ex.: Resend nem
    // configurado e o fallback falhou), avisa o admin assim mesmo — antes só o caso do
    // Resend disparava alerta, então uma falha total sumia (só ficava no notification_log).
    if (!result.ok && !result.resendError && type !== "admin_alert" && type !== "resend_failure_alert") {
      const adminEmails = parseEmails(config?.email_new_orders) || [];
      const adminTo = adminEmails.length ? adminEmails : (config?.email_contato || COMPANY_EMAIL);
      const alertHtml =
        `<p>❌ Nenhum provedor conseguiu enviar o email "<b>${type}</b>" para <b>${toDisplay}</b> — o destinatário NÃO recebeu.</p>` +
        `<p><b>Erro:</b> <code>${result.error ?? "nenhum provedor de email disponível"}</code></p>` +
        `<p>Verifique a configuração de email (Resend / Office365 / SMTP).</p>`;
      sendEmailResilient(config, fromEmail, adminTo, `⚠ Email NÃO enviado: "${type}"`, alertHtml)
        .then((r) => adminClient.from("notification_log").insert({
          event: "email_failure_alert", channel: "email",
          recipient: Array.isArray(adminTo) ? adminTo.join(", ") : String(adminTo),
          status: r.ok ? "sent" : "failed", error: r.error ?? null,
          payload: { about: type },
        }))
        .catch(() => {});
    }

    if (!result.ok) {
      console.error(`[send-email] FALHOU "${type}" para ${toDisplay}: ${result.error}`);
      return new Response(JSON.stringify({ error: result.error, type, to }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[send-email] Enviado "${type}" para ${toDisplay} via ${result.provider}${result.fallback ? " (fallback)" : ""}`);
    return new Response(JSON.stringify({ success: true, type, to, provider: result.provider, fallback: result.fallback }), {
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
