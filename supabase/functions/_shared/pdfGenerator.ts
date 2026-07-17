// Gera o PDF de pedido de VERDADE (bytes, não HTML) — pra anexar no email.
// Sem headless browser disponível no Deno/Supabase Edge Functions, então o
// layout é desenhado à mão com pdf-lib (puro JS, sem dependência nativa) em
// vez de converter HTML. Mantém as MESMAS informações do email (mesmos dados
// recebidos por quem chama), só o desenho é manual.
import { PDFDocument, StandardFonts, rgb, PDFFont } from "npm:pdf-lib@1.17.1";

export interface PdfOrderItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
  total: number;
}

export interface PdfOrderData {
  orderNumber: string;
  orderDate: string;
  poNumber?: string;
  deliveryDate?: string;
  customerName: string;
  customerContact?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  companyName: string;
  companyAddress?: string;
  companyEmail?: string;
  logoUrl?: string;
  logoPosition?: "left" | "center" | "right";
  items: PdfOrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  grossTotal: number;
  notes?: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const NAVY = rgb(0.102, 0.176, 0.353); // #1a2d5a
const ORANGE = rgb(0.910, 0.541, 0.102); // #e88a1a
const GRAY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.92, 0.93, 0.96);

function fmtUSD(n: number): string {
  return "$" + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function embedLogo(pdfDoc: PDFDocument, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return await pdfDoc.embedPng(bytes);
    return await pdfDoc.embedJpg(bytes);
  } catch (_e) {
    return null; // logo indisponível não deve derrubar a geração do PDF
  }
}

export async function generateOrderPdf(data: PdfOrderData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const logoImg = data.logoUrl ? await embedLogo(pdfDoc, data.logoUrl) : null;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const text = (t: string, x: number, yy: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(t || "", { x, y: yy, size: opts.size ?? 10, font: opts.font ?? regular, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
  };
  const rightText = (t: string, xRight: number, yy: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const w = font.widthOfTextAtSize(t || "", size);
    text(t, xRight - w, yy, opts);
  };

  // ── Header: logo (posição configurável) + título do documento ──
  const headerY = y - 28;
  if (logoImg) {
    const maxH = 40, maxW = 160;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    const pos = data.logoPosition ?? "left";
    const x = pos === "center" ? (PAGE_W - w) / 2 : pos === "right" ? PAGE_W - MARGIN - w - 140 : MARGIN;
    page.drawImage(logoImg, { x, y: headerY - h + 10, width: w, height: h });
  } else {
    text(data.companyName || "PermShield", MARGIN, headerY, { font: bold, size: 18, color: NAVY });
  }
  rightText("ORDER", PAGE_W - MARGIN, y, { font: bold, size: 16, color: NAVY });
  rightText(`#${data.orderNumber}`, PAGE_W - MARGIN, y - 18, { font: bold, size: 12, color: ORANGE });
  rightText(data.orderDate, PAGE_W - MARGIN, y - 32, { size: 9, color: GRAY });
  y -= 60;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: NAVY });
  y -= 22;

  // ── Bill To / From (duas colunas) ──
  const colW = (PAGE_W - MARGIN * 2 - 20) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 20;
  let ly = y, ry = y;
  const leftMax = colW; // largura da coluna esquerda p/ quebrar textos longos
  const wrapLine = (t: string, size = 9) => {
    // Quebra por palavras pra endereço/comentário longo não estourar a coluna.
    const words = (t || "").split(/\s+/);
    const lines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(test, size) > leftMax && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const leftLine = (t: string, opts: any = {}) => { text(t, leftX, ly, opts); ly -= 13; };

  // Descarta pedaços "vazios" que vinham como "-"/"—"/"n/a" (causavam "FL, -").
  const clean = (t?: string) => (t || "").split(",").map((s) => s.trim())
    .filter((s) => s && !["-", "—", "n/a", "na"].includes(s.toLowerCase())).join(", ");
  const addr = clean(data.customerAddress);

  text("BILL TO", leftX, ly, { font: bold, size: 8, color: GRAY }); ly -= 13;
  text(data.customerName || "—", leftX, ly, { font: bold, size: 11, color: NAVY }); ly -= 13;
  if (data.customerContact) leftLine(`Attn: ${data.customerContact}`, { size: 9 });
  if (data.customerEmail) leftLine(data.customerEmail, { size: 9 });
  if (data.customerPhone) leftLine(data.customerPhone, { size: 9 });
  if (addr) for (const l of wrapLine(addr)) leftLine(l, { size: 9 });
  // PO Number e Delivery SEMPRE aparecem (label), como no template do email —
  // mesmo vazios, pra consistência (o dono pediu explicitamente).
  leftLine(`PO Number: ${data.poNumber || "—"}`, { size: 9, font: bold, color: NAVY });
  if (data.deliveryDate) leftLine(`Requested delivery: ${data.deliveryDate}`, { size: 9 });

  text("FROM", rightX, ry, { font: bold, size: 8, color: GRAY }); ry -= 13;
  text(data.companyName || "—", rightX, ry, { font: bold, size: 11, color: NAVY }); ry -= 13;
  if (data.companyAddress) { text(data.companyAddress, rightX, ry, { size: 9 }); ry -= 13; }
  if (data.companyEmail) { text(data.companyEmail, rightX, ry, { size: 9 }); ry -= 13; }

  y = Math.min(ly, ry) - 16;

  // ── Tabela de itens ──
  // CODE precisa de largura real: os códigos do B2BWave são longos
  // ("72 Black Rolls - Crate") e 70pt fazia o código invadir o nome.
  const colCode = leftX, colName = leftX + 140, colQty = PAGE_W - MARGIN - 150, colPrice = PAGE_W - MARGIN - 100, colTotal = PAGE_W - MARGIN;
  const fitText = (t: string, maxWidth: number, size: number) => {
    let s = t || "";
    while (s.length > 1 && regular.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
    return s === (t || "") ? s : s.slice(0, -1) + "…";
  };
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - MARGIN * 2, height: 18, color: NAVY });
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
    if (idx % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - MARGIN * 2, height: 16, color: LIGHT });
    text(fitText(it.sku || "—", colName - colCode - 12, 9), colCode + 4, y, { size: 9, color: NAVY });
    text(fitText(it.name || "", colQty - colName - 8, 9), colName, y, { size: 9 });
    rightText(String(it.qty), colQty + 30, y, { size: 9 });
    rightText(fmtUSD(it.price), colPrice + 40, y, { size: 9 });
    rightText(fmtUSD(it.total), colTotal, y, { size: 9, font: bold });
    y -= 16;
  });
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 }, thickness: 0.5, color: GRAY });

  // ── Totais ──
  if (y < 140) newPage();
  const totalsRow = (label: string, value: string, big = false) => {
    rightText(label, colTotal - 90, y, { size: big ? 11 : 9, color: big ? NAVY : GRAY, font: big ? bold : regular });
    rightText(value, colTotal, y, { size: big ? 12 : 9, font: bold, color: big ? NAVY : rgb(0.13, 0.13, 0.13) });
    y -= big ? 18 : 15;
  };
  totalsRow("Subtotal", fmtUSD(data.subtotal));
  if (data.discount > 0) totalsRow("Discount", `-${fmtUSD(data.discount)}`);
  if (data.shipping > 0) totalsRow("Shipping", fmtUSD(data.shipping));
  if (data.tax > 0) totalsRow("Sales Tax", fmtUSD(data.tax));
  page.drawLine({ start: { x: colTotal - 160, y: y + 10 }, end: { x: colTotal, y: y + 10 }, thickness: 1.5, color: NAVY });
  y -= 6;
  totalsRow("Gross Total", fmtUSD(data.grossTotal), true);

  // ── Comments (SEMPRE aparece, mesmo vazio — pedido do dono). Quebra em várias
  // linhas e a caixa cresce com o texto. ──
  {
    y -= 14;
    const bodyMax = PAGE_W - MARGIN * 2 - 16;
    const words = String(data.notes || "").split(/\s+/).filter(Boolean);
    const noteLines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(test, 9) > bodyMax && cur) { noteLines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) noteLines.push(cur);
    const boxH = 20 + Math.max(noteLines.length, 1) * 12;
    if (y - boxH < 60) newPage();
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - MARGIN * 2, height: boxH, color: rgb(0.98, 0.98, 0.92) });
    text("Comments:", MARGIN + 8, y - 14, { font: bold, size: 9, color: NAVY });
    let ny = y - 14;
    for (const l of noteLines) { text(l, MARGIN + 8, ny - 12, { size: 9, color: rgb(0.3, 0.3, 0.3) }); ny -= 12; }
    y = y - boxH - 12;
  }

  // ── Rodapé ── (sem branding hardcoded — só os dados reais da empresa)
  const footerY = 36;
  text(data.companyName || "", MARGIN, footerY, { font: bold, size: 9, color: NAVY });
  if (data.companyEmail) text(data.companyEmail, MARGIN, footerY - 12, { size: 8, color: GRAY });

  return await pdfDoc.save();
}
