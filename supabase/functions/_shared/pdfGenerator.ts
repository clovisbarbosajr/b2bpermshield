// ⚠️ ARQUIVO OBSOLETO — NÃO USAR, NÃO COPIAR DAQUI.
// Nenhum código importa este arquivo: send-email/index.ts e generate-pdf/index.ts
// têm o gerador EMBUTIDO (foi embutido pra não depender do _shared ser
// reempacotado no deploy). Esta cópia ficou para trás e está DESATUALIZADA —
// rótulo "Customer" (hoje é "Company"), sem _fmtStoreAddress (quebra de linha do
// endereço) e sem o carimbo de versão. Copiar daqui REGRIDE o layout do PDF.
// Mantido só como histórico; pode ser removido com segurança.
//
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

  const leftX = MARGIN;
  // Descarta pedaços "vazios" ("-"/"—"/"n/a") que causavam "FL, -".
  const clean = (t?: string) => (t || "").split(",").map((s) => s.trim())
    .filter((s) => s && !["-", "—", "n/a", "na"].includes(s.toLowerCase())).join(", ");
  const addr = clean(data.customerAddress);

  // ── Header no layout do B2BWave (imagem de referência): logo CENTRALIZADA,
  // título "Order" centralizado, linha, e coluna de campos rotulados à esquerda
  // + dados da empresa à direita. (Itens/totais/rodapé abaixo ficam inalterados.)
  const headerTop = y;
  if (logoImg) {
    const maxH = 46, maxW = 200;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    page.drawImage(logoImg, { x: (PAGE_W - w) / 2, y: headerTop - h, width: w, height: h });
    y = headerTop - h - 6;
  } else {
    const name = data.companyName || "PermShield";
    const nameW = bold.widthOfTextAtSize(name, 18);
    text(name, (PAGE_W - nameW) / 2, headerTop - 18, { font: bold, size: 18, color: NAVY });
    y = headerTop - 30;
  }
  // Título "Order" centralizado
  const title = "Order";
  const titleW = regular.widthOfTextAtSize(title, 20);
  text(title, (PAGE_W - titleW) / 2, y - 18, { size: 20, color: GRAY });
  y -= 30;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: NAVY });
  y -= 20;

  // Coluna esquerda: pares label→valor (label cinza, right-aligned; valor escuro).
  const labelRight = MARGIN + 68;   // labels terminam aqui (right-aligned)
  const valueLeft = MARGIN + 76;    // valores começam aqui
  const valueMax = MARGIN + 68 + 190; // largura p/ quebrar endereço longo
  let ly = y;
  const wrapAt = (t: string, maxRight: number, size = 9) => {
    const words = (t || "").split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(test, size) > (maxRight - valueLeft) && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const field = (label: string, value: string, opts: { bold?: boolean } = {}) => {
    rightText(label, labelRight, ly, { size: 8, color: rgb(0.42, 0.52, 0.66) });
    const lines = wrapAt(value || "", valueMax);
    if (lines.length === 0) lines.push("");
    lines.forEach((l, i) => {
      text(l, valueLeft, ly - i * 12, { size: 9, font: opts.bold ? bold : regular, color: rgb(0.13, 0.13, 0.13) });
    });
    ly -= 13 + (lines.length - 1) * 12;
  };

  // Dados da empresa à direita (right-aligned na margem direita) — topo alinhado.
  let ry = y;
  const companyMaxW = 230; // largura da coluna direita p/ quebrar o endereço
  const companyLine = (t: string, opts: { bold?: boolean; color?: any } = {}) => {
    if (!t) return;
    rightText(t, PAGE_W - MARGIN, ry, { size: opts.bold ? 11 : 9, font: opts.bold ? bold : regular, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
    ry -= 13;
  };
  // Quebra por LARGURA (right-aligned) — endereço da empresa em várias linhas.
  const wrapRight = (t: string, maxW: number, size = 9) => {
    const words = (t || "").split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  companyLine(data.companyName || "", { bold: true, color: NAVY });
  if (data.companyAddress) for (const l of wrapRight(clean(data.companyAddress), companyMaxW)) companyLine(l);
  if (data.companyEmail) companyLine(data.companyEmail, { color: rgb(0.16, 0.5, 0.74) });

  // Campos da esquerda, na ordem da imagem. Customer = EMPRESA; Contact = pessoa
  // (só aparece quando há nome de contato distinto da empresa) — "respeita a tag".
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
  // (Comments ficam no cabeçalho agora — igual à imagem de referência.)

  // ── Rodapé ── (sem branding hardcoded — só os dados reais da empresa)
  const footerY = 36;
  text(data.companyName || "", MARGIN, footerY, { font: bold, size: 9, color: NAVY });
  if (data.companyEmail) text(data.companyEmail, MARGIN, footerY - 12, { size: 8, color: GRAY });

  return await pdfDoc.save();
}
