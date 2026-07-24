import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
// ─── GERADOR DE PDF EMBUTIDO (era ../_shared/pdfGenerator.ts) ────────────────
// Embutido de propósito (mesmo motivo do send-email): garante que o preview usa
// o código ATUAL, idêntico ao anexo. Sincronizar com _shared/pdfGenerator.ts.
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
// Endereço da empresa (texto livre "rua, cidade, ST ZIP") → 3 linhas: rua / cidade, estado / zip.
function _fmtStoreAddress(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const zipM = s.match(/\s+(\d{5}(?:-\d{4})?)\s*$/);
  const zip = zipM ? zipM[1] : "";
  const body = (zip ? s.slice(0, zipM!.index).replace(/,\s*$/, "") : s).trim();
  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  let street = body, cityState = "";
  if (parts.length >= 2) { cityState = parts.slice(-2).join(", "); street = parts.slice(0, -2).join(", "); }
  return [street, cityState, zip].filter(Boolean).join("\n");
}
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
  const cleanSeg = (t?: string) => (t || "").split(",").map((s) => s.trim()).filter((s) => s && !["-", "—", "n/a", "na"].includes(s.toLowerCase())).join(", ");
  const cleanAddr = (t?: string) => (t || "").split("\n").map(cleanSeg).filter(Boolean).join("\n");
  const addr = cleanAddr(data.customerAddress);
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
    const lines: string[] = [];
    for (const seg of (value || "").split("\n")) { const w = wrapAt(seg, valueMax); if (w.length) lines.push(...w); else lines.push(""); }
    if (lines.length === 0) lines.push("");
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
  if (data.companyAddress) for (const seg of cleanAddr(data.companyAddress).split("\n")) { if (seg) for (const l of wrapRight(seg, 230)) companyLine(l); }
  if (data.companyEmail) companyLine(data.companyEmail, { color: rgb(0.16, 0.5, 0.74) });
  field("Order", String(data.orderNumber || ""), { bold: true });
  field("PO", data.poNumber || "");
  field("Company", data.customerName || "");
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
  // Carimbo de versão (mesmo do send-email) — confirma que o deploy pegou.
  rightText("layout 0721c", _PW - _MG, footerY - 12, { size: 7, color: _GRAY });
  return await pdfDoc.save();
}
// ─── fim do gerador embutido ─────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return (dt.getUTCMonth() + 1).toString().padStart(2, "0") + "/" +
    dt.getUTCDate().toString().padStart(2, "0") + "/" +
    dt.getUTCFullYear();
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

    // AUTORIZAÇÃO: o PDF traz PII do pedido (nome/email/endereço/itens). Antes a função
    // era aberta -> qualquer um com um pedido_id baixava dados de outro cliente. Agora
    // exige usuário logado e papel de staff (admin/manager/warehouse).
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: staffRow } = await supabase.from("user_roles")
      .select("role").eq("user_id", user.id).in("role", ["admin", "manager", "warehouse"]).maybeSingle();
    if (!staffRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all needed data in parallel
    const [{ data: pedido, error: pedidoErr }, { data: cfg }] = await Promise.all([
      supabase
        .from("pedidos")
        .select("*, clientes(nome, empresa, email, telefone)")
        .eq("id", pedido_id)
        .single(),
      supabase
        .from("configuracoes")
        .select("nome_empresa, email_contato, endereco")
        .limit(1)
        .maybeSingle(),
    ]);

    // Logo do email/PDF — query separada e tolerante (colunas novas; se o
    // PostgREST ainda não as enxergar, o PDF sai sem logo em vez de quebrar).
    let logoCfg: { email_logo_url?: string | null; email_logo_position?: string | null } = {};
    try {
      const { data: lc } = await supabase.from("configuracoes")
        .select("email_logo_url, email_logo_position").limit(1).maybeSingle();
      if (lc) logoCfg = lc;
    } catch (_e) { /* sem logo */ }

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
    // Endereço da empresa (texto livre) → rua / cidade, estado / zip.
    const companyAddress = _fmtStoreAddress((cfg?.endereco as string | undefined) || "1800 N Powerline Rd Ste A6, POMPANO BEACH FL 33069");

    // Customer address organizado em 3 linhas: rua / cidade, estado / zip.
    const customerAddress = endereco
      ? [
          [endereco.logradouro, endereco.complemento].filter(Boolean).join(" "),
          endereco.cidade && endereco.estado ? `${endereco.cidade}, ${endereco.estado}` : (endereco.cidade || endereco.estado),
          endereco.cep,
        ].filter(Boolean).join("\n")
      : "";

    const orderNumber = String(pedido.numero || pedido.id);

    // ── PREVIEW = ANEXO: usa o MESMO gerador pdf-lib do email (generateOrderPdf).
    // Antes o preview era HTML próprio e divergia do PDF anexado. Agora é
    // idêntico byte a byte porque é a MESMA função. Devolve o PDF em base64. ──
    const pdfItems = (itens ?? []).map((i: any) => ({
      sku: i.sku ?? "", name: i.nome_produto ?? "",
      qty: Number(i.quantidade ?? 0), price: Number(i.preco_unitario ?? 0), total: Number(i.subtotal ?? 0),
    }));
    const pdfBytes = await generateOrderPdf({
      orderNumber, orderDate: fmtDate(pedido.created_at),
      poNumber: pedido.po_number || "", deliveryDate: pedido.delivery_date ? fmtDate(pedido.delivery_date) : "",
      customerName: cliente?.empresa || cliente?.nome || "",
      customerContact: (cliente?.empresa && cliente?.nome && cliente.nome !== cliente.empresa) ? cliente.nome : "",
      customerEmail: cliente?.email ?? "", customerPhone: cliente?.telefone ?? "",
      customerAddress,
      companyName, companyAddress, companyEmail,
      logoUrl: logoCfg.email_logo_url ?? undefined,
      logoPosition: (logoCfg.email_logo_position as "left" | "center" | "right") ?? "left",
      items: pdfItems,
      subtotal: Number(pedido.subtotal ?? 0), discount: Number(pedido.desconto ?? 0),
      shipping: Number(pedido.shipping_costs ?? 0), tax: Number(pedido.sales_tax ?? 0),
      grossTotal: Number(pedido.total ?? 0), notes: pedido.observacoes ?? "",
    });
    // base64 sem Buffer
    let binary = ""; for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    const pdfBase64 = btoa(binary);

    return new Response(JSON.stringify({ pdf_base64: pdfBase64, filename: `order-${orderNumber}.pdf` }), {
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
