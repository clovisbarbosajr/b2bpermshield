// Deployed b2bwave-sync (SYNC_VERSION:related-v4) — redeploy from main @ 7e3e753
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function b2bwaveFetch(endpoint: string, username: string, apiKey: string, maxRetries = 3) {
  let cleanEndpoint = endpoint.replace(/\.json/g, '');
  cleanEndpoint = cleanEndpoint.replace(/price_lists/g, 'pricelists');
  const url = `https://${username}.b2bwave.com/api/${cleanEndpoint}`;
  const auth = btoa(`${username}:${apiKey}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[B2B Wave] Fetching: ${url} (attempt ${attempt}/${maxRetries})`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.text();
        console.error(`[B2B Wave] Error ${res.status}: ${body}`);
        throw new Error(`B2B Wave API error [${res.status}]: ${body}`);
      }
      const data = await res.json();
      console.log(`[B2B Wave] Fetched ${cleanEndpoint}: ${Array.isArray(data) ? data.length + ' items' : typeof data}`);
      return data;
    } catch (err: any) {
      const isRetryable = err.name === 'AbortError' || /connection closed|reset|timeout|ECONNRESET/i.test(err.message);
      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 2000;
        console.warn(`[B2B Wave] Attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

async function fetchPage(endpoint: string, username: string, apiKey: string, page: number) {
  const separator = endpoint.includes("?") ? "&" : "?";
  return await b2bwaveFetch(`${endpoint}${separator}page=${page}`, username, apiKey);
}

async function fetchAllPages(endpoint: string, username: string, apiKey: string) {
  const allData: any[] = [];
  let page = 1;
  while (true) {
    const data = await fetchPage(endpoint, username, apiKey, page);
    if (!Array.isArray(data) || data.length === 0) break;
    allData.push(...data);
    console.log(`[B2B Wave] Page ${page}: ${data.length} items (total: ${allData.length})`);
    if (data.length < 500) break;
    page++;
  }
  return allData;
}

// Para endpoints que EXIGEM paginação explícita (ex.: product_prices). Usa
// paginated=1&per_page=500 e itera page=N até vir página incompleta. Guard contra
// loop infinito (máx. 200 páginas = 100k registros). Aceita resposta como array
// puro OU como { data: [...] }.
async function fetchAllPaginated(endpoint: string, username: string, apiKey: string, perPage = 500) {
  const all: any[] = [];
  const sep = endpoint.includes("?") ? "&" : "?";
  const base = `${endpoint}${sep}paginated=1&per_page=${perPage}`;
  for (let page = 1; page <= 200; page++) {
    const data = await fetchPage(base, username, apiKey, page);
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < perPage) break;
  }
  return all;
}

// Mapeia para os status CANÔNICOS do app (src/lib/orderStatuses.ts).
// Antes convertia para os legados em PT (concluido/recebido/enviado/...): como o
// admin grava o canônico e o diff compara string crua, a cada ciclo do cron (15
// min) o sync via "sent" != "enviado" e REVERTIA o status alterado pelo admin —
// e a reversão disparava trg_order_status_notify, mandando ao cliente uma segunda
// notificação com o valor interno cru ("Order #123: recebido").
const statusMap: Record<string, string> = {
  "complete": "complete", "completed": "complete", "submitted": "submitted",
  "received": "submitted", "processing": "on_hold", "in progress": "on_hold",
  "shipped": "sent", "cancelled": "cancelled", "canceled": "cancelled",
};

// Escolhe o primeiro campo numérico > 0 dentre várias chaves possíveis da API B2BWave.
function pickNum(obj: any, keys: string[]): number {
  for (const k of keys) {
    const n = parseFloat(obj?.[k]);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

// Monta os itens do pedido + soma (qtd e valor) — robusto a variações de campo.
function buildOrderItems(orderProducts: any[], productSkuToId: Map<string, string>, productNameToId: Map<string, string>) {
  const rows: any[] = [];
  let qty = 0, sum = 0;
  for (const opItem of orderProducts || []) {
    const op = opItem.order_product || opItem;
    const q = Math.max(parseInt(op.quantity || op.qty || "1") || 1, 1);
    const unitPrice = pickNum(op, ["price", "unit_price", "price_per_unit", "wholesale_price", "product_price", "final_unit_price"]);
    let lineTotal = pickNum(op, ["final_price", "total_price", "total_before_vat", "line_total", "subtotal", "total"]);
    if (lineTotal <= 0) lineTotal = unitPrice * q;
    // Soma SEMPRE (mesmo se o produto não casar localmente) → total do pedido correto.
    qty += q;
    sum += lineTotal;

    const productCode = (op.product_code || op.sku || "").toLowerCase();
    const productName = (op.product_name || op.name || "").toLowerCase();
    let produtoId = productSkuToId.get(productCode) || productNameToId.get(productName);
    if (!produtoId && productCode) {
      for (const [sku, id] of productSkuToId) {
        if (sku.startsWith(productCode) || productCode.startsWith(sku)) { produtoId = id; break; }
      }
    }
    if (!produtoId) continue; // sem produto local → não cria a linha, mas já somou
    rows.push({
      produto_id: produtoId,
      nome_produto: op.product_name || op.name || "Unknown",
      sku: op.product_code || op.sku || "N/A",
      quantidade: q,
      preco_unitario: unitPrice || (q > 0 ? lineTotal / q : 0),
      subtotal: lineTotal,
    });
  }
  return { rows, qty, sum };
}

type ExistingOrder = { id: string; status: string; total: number; subtotal: number; quantidade_total: number };

// Insere OU atualiza um pedido (espelha status/cancelamento/edição/total). Nunca apaga.
// Retorna "created" | "updated" | "skipped" | "error".
async function upsertOrder(
  db: any, o: any,
  clienteEmailToId: Map<string, string>,
  productSkuToId: Map<string, string>, productNameToId: Map<string, string>,
  existing: Map<number, ExistingOrder>,
  opts: { skipPre2025: boolean; notify: boolean },
): Promise<"created" | "updated" | "skipped" | "error"> {
  const numero = parseInt(o.id) || 0;
  if (!numero) return "error";

  const submittedRaw = o.submitted_at || o.created_at || "";
  if (opts.skipPre2025 && submittedRaw && new Date(submittedRaw).getFullYear() < 2025) return "skipped";

  const clienteId = clienteEmailToId.get((o.customer_email || "").toLowerCase());
  if (!clienteId) return "error";

  const b2bStatus = (o.status_order_name || o.status || "submitted").toLowerCase();
  const status = statusMap[b2bStatus] || "recebido";
  const submittedAt = submittedRaw ? new Date(submittedRaw).toISOString() : new Date().toISOString();
  const deliveryDate = o.request_delivery_at ? new Date(o.request_delivery_at).toISOString() : null;

  const { rows: itemRows, qty: itemsQty, sum: itemsSum } = buildOrderItems(o.order_products || [], productSkuToId, productNameToId);

  let subtotal = pickNum(o, ["total_before_vat", "subtotal", "net_total", "total"]);
  let total = pickNum(o, ["gross_total", "total_after_vat", "total", "total_before_vat", "grand_total", "order_total", "amount"]);
  if (subtotal <= 0) subtotal = itemsSum;
  if (total <= 0) total = itemsSum || subtotal;
  let quantidade = parseInt(o.total_quantity || "0") || 0;
  if (quantidade <= 0) quantidade = itemsQty;

  const ex = existing.get(numero);
  if (ex) {
    // Só escreve se algo mudou (evita writes inúteis a cada ciclo do cron).
    const changed = ex.status !== status || Number(ex.total) !== total ||
      Number(ex.subtotal) !== subtotal || (ex.quantidade_total ?? 0) !== quantidade;
    if (!changed) return "skipped";
    const upd = await db.from("pedidos").update({
      status, subtotal, total, quantidade_total: quantidade,
      observacoes: o.comments_customer || o.customer_comments || null,
      admin_notes: o.admin_notes || o.internal_notes || null,
      po_number: o.customer_order_reference || o.purchase_order || o.po_number || null,
      delivery_date: deliveryDate,
    }).eq("id", ex.id);
    if (upd.error) return "error";
    if (itemRows.length > 0) {
      await db.from("pedido_itens").delete().eq("pedido_id", ex.id);
      await db.from("pedido_itens").insert(itemRows.map((r) => ({ ...r, pedido_id: ex.id })));
    }
    return "updated";
  }

  const ins = await db.from("pedidos").insert({
    numero, b2bwave_order_id: numero, cliente_id: clienteId, status, subtotal, total,
    observacoes: o.comments_customer || o.customer_comments || null,
    admin_notes: o.admin_notes || o.internal_notes || null,
    po_number: o.customer_order_reference || o.purchase_order || o.po_number || null,
    delivery_date: deliveryDate,
    quantidade_total: quantidade,
    shipping_option_id: null, payment_option_id: null,
    created_at: submittedAt,
  }).select("id").single();
  if (ins.error || !ins.data) return "error";
  const orderId = ins.data.id;
  existing.set(numero, { id: orderId, status, total, subtotal, quantidade_total: quantidade });
  if (itemRows.length > 0) {
    await db.from("pedido_itens").insert(itemRows.map((r) => ({ ...r, pedido_id: orderId })));
  }
  // Notifica só pedidos NOVOS e RECENTES (evita spam de milhares na recuperação).
  if (opts.notify && CRON_SECRET) {
    const ageMs = Date.now() - new Date(submittedAt).getTime();
    if (ageMs < 2 * 24 * 60 * 60 * 1000) {
      await fireNewOrderNotification(db, numero, total, clienteId, orderId).catch(() => {});
    }
  }
  return "created";
}

async function fireNewOrderNotification(db: any, numero: number, total: number, clienteId: string, orderId?: string) {
  const { data: cli } = await db.from("clientes").select("nome, empresa, email, telefone, endereco, cidade, estado").eq("id", clienteId).maybeSingle();
  await fetch(`${SB_URL}/functions/v1/notify-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET, "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}` },
    body: JSON.stringify({
      event: "new_order",
      vars: {
        order_id: numero, total, date: new Date().toISOString(),
        customer_name: cli?.nome ?? "", customer_company: cli?.empresa ?? "",
        customer_email: cli?.email ?? "", customer_phone: cli?.telefone ?? "",
      },
      customer: { email: cli?.email, phone: cli?.telefone, whatsapp: cli?.telefone },
    }),
  });

  // Email RICO pro admin (template customizado + logo + PDF anexado), o mesmo
  // que um pedido do portal dispara — pra pedido importado do B2BWave chegar
  // igual. (O cliente já recebe a confirmação do próprio B2BWave; após o corte
  // o checkout do portal cuida do email do cliente.)
  if (orderId) {
    try {
      const { data: pedido } = await db.from("pedidos").select("*").eq("id", orderId).maybeSingle();
      const { data: itens } = await db.from("pedido_itens").select("sku, nome_produto, preco_unitario, quantidade, subtotal").eq("pedido_id", orderId);
      if (pedido) {
        await fetch(`${SB_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ type: "new_order_admin", order: pedido, customer: cli ?? {}, items: itens ?? [] }),
        });
      }
    } catch (e) {
      console.error("[sync] rich admin email failed (non-fatal):", e instanceof Error ? e.message : e);
    }
  }
}

async function getOrdersCursor(db: any): Promise<number> {
  const { data } = await db.from("sync_state").select("value").eq("key", "orders_cursor").maybeSingle();
  return Number(data?.value?.page) || 1;
}
async function setOrdersCursor(db: any, page: number) {
  await db.from("sync_state").upsert({ key: "orders_cursor", value: { page } }, { onConflict: "key" });
}

// Processa um conjunto de pedidos (carrega lookups + existentes, faz upsert de cada um).
async function processOrderSlice(db: any, slice: any[], skipPre2025: boolean, notify: boolean) {
  // Casa por b2bwave_order_id (NÃO por numero — que colide com o serial dos pedidos
  // do app). Pedido nativo do app (b2bwave_order_id NULL) nunca entra aqui.
  const b2bIds = slice.map((it: any) => parseInt((it.order || it).id) || 0).filter((n: number) => n > 0);
  const { data: existingOrders } = await db.from("pedidos").select("id, b2bwave_order_id, status, total, subtotal, quantidade_total").in("b2bwave_order_id", b2bIds);
  const existing = new Map<number, ExistingOrder>();
  for (const e of existingOrders || []) {
    existing.set(e.b2bwave_order_id, { id: e.id, status: e.status, total: Number(e.total), subtotal: Number(e.subtotal), quantidade_total: e.quantidade_total ?? 0 });
  }
  const [clientesRes, productsRes] = await Promise.all([
    db.from("clientes").select("id, email"),
    db.from("produtos").select("id, sku, nome"),
  ]);
  const clienteEmailToId = new Map<string, string>();
  for (const c of clientesRes.data || []) clienteEmailToId.set((c.email || "").toLowerCase(), c.id);
  const productSkuToId = new Map<string, string>();
  const productNameToId = new Map<string, string>();
  for (const p of productsRes.data || []) {
    // Só indexa sku PREENCHIDO — sku vazio no índice casaria o produto errado
    // (qualquer código "startsWith" de string vazia é true).
    if (p.sku) productSkuToId.set(p.sku.toLowerCase(), p.id);
    productNameToId.set((p.nome || "").toLowerCase(), p.id);
  }
  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const item of slice) {
    const o = item.order || item;
    const r = await upsertOrder(db, o, clienteEmailToId, productSkuToId, productNameToId, existing, { skipPre2025, notify });
    if (r === "created") created++;
    else if (r === "updated") updated++;
    else if (r === "skipped") skipped++;
    else errors++;
  }
  return { created, updated, skipped, errors };
}

// Grava o status de uma execução em sync_log (persiste; a tela lê daqui).
async function logRun(db: any, action: string, s: { created?: number; updated?: number; skipped?: number; errors?: number; samples?: string[] }) {
  try {
    await db.from("sync_log").insert({
      action,
      created_count: s.created ?? 0,
      updated_count: s.updated ?? 0,
      skipped_count: s.skipped ?? 0,
      errors_count: s.errors ?? 0,
      samples: s.samples ?? [],
    });
  } catch (_) { /* o log nunca pode quebrar o sync */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Autorização: X-Cron-Secret (pg_cron, sem login) OU admin logado ──────────
  const viaCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!viaCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: jsonHeaders });
    }
    const authDb = createClient(SB_URL, SERVICE_KEY);
    const { data: adminRow } = await authDb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Only admins can run the sync" }), { status: 403, headers: jsonHeaders });
    }
  }

  try {
    const username = Deno.env.get("B2BWAVE_USERNAME");
    const apiKey = Deno.env.get("B2BWAVE_API_KEY");
    if (!username || !apiKey) {
      return new Response(
        JSON.stringify({ error: "B2B Wave credentials not configured" }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const body = await req.json();
    const { action } = body;

    if (action === "test") {
      const data = await b2bwaveFetch("products.json?per_page=1", username, apiKey);
      // Return first product with all fields for debugging price mapping
      const sample = Array.isArray(data) && data.length > 0 ? Object.keys(data[0]).reduce((acc: any, key: string) => {
        const val = data[0][key];
        if (val !== null && val !== undefined && val !== "" && val !== 0) acc[key] = val;
        return acc;
      }, {}) : null;
      return new Response(
        JSON.stringify({ success: true, message: "Connection OK", count: Array.isArray(data) ? data.length : 0, sample }),
        { headers: jsonHeaders }
      );
    }

    if (action === "debug_product") {
      const data = await b2bwaveFetch("products.json", username, apiKey);
      const sample = Array.isArray(data) && data.length > 0 ? data[0] : null;
      return new Response(JSON.stringify({ success: true, sample }), { headers: jsonHeaders });
    }

    if (action === "debug_orders") {
      const page = body.page || 1;
      const data = await fetchPage("orders.json", username, apiKey, page);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, count: 0, message: "No data" }), { headers: jsonHeaders });
      }
      const ids = data.map((item: any) => parseInt((item.order || item).id) || 0);
      const emails = data.slice(0, 3).map((item: any) => (item.order || item).customer_email || "");
      const dates = data.slice(0, 3).map((item: any) => (item.order || item).submitted_at || (item.order || item).created_at || "");
      return new Response(JSON.stringify({
        success: true, count: data.length,
        firstId: ids[0], lastId: ids[ids.length - 1],
        minId: Math.min(...ids), maxId: Math.max(...ids),
        uniqueIds: new Set(ids).size,
        sampleEmails: emails, sampleDates: dates,
      }), { headers: jsonHeaders });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ========== SYNC CATEGORIES (incremental by b2bwave_id) ==========
    if (action === "sync_categories") {
      const data = await fetchAllPages("categories.json", username, apiKey);
      const { data: existingCats } = await adminClient.from("categorias").select("id, b2bwave_id, nome, descricao, ativo, imagem_url, desconto, ordem");
      const existingMap = new Map<number, any>();
      for (const c of existingCats || []) if (c.b2bwave_id) existingMap.set(c.b2bwave_id, c);

      const b2bIdToLocalId = new Map<number, string>();
      let synced = 0, skipped = 0;
      for (const item of data) {
        const c = item.category || item;
        const b2bId = c.id;
        const row: Record<string, any> = {
          nome: c.name || "Unnamed",
          descricao: c.description || null,
          ativo: c.is_active !== false,
          imagem_url: c.image_url || null,
          b2bwave_id: b2bId,
          desconto: parseFloat(c.discount || "0") || 0,
          ordem: parseInt(c.position || c.sort_order || "0") || 0,
        };
        // is_private: só sincroniza quando a API REALMENTE traz o campo. Campo ausente
        // (undefined) != "false" — senão um payload sem o campo zeraria a privacidade
        // raspada (os grupos/clientes vêm do scrape, não da API).
        if (c.is_private !== undefined || c.private !== undefined) {
          row.is_private = c.is_private === true || c.private === true;
        }
        const existing = existingMap.get(b2bId);
        if (existing) {
          // Compare key fields to see if update needed
          const changed = existing.nome !== row.nome || existing.descricao !== row.descricao ||
            existing.ativo !== row.ativo || existing.imagem_url !== row.imagem_url ||
            Number(existing.desconto) !== row.desconto || existing.ordem !== row.ordem ||
            (row.is_private !== undefined && existing.is_private !== row.is_private);
          if (changed) {
            await adminClient.from("categorias").update(row).eq("id", existing.id);
            synced++;
          } else {
            skipped++;
          }
          b2bIdToLocalId.set(b2bId, existing.id);
        } else {
          const { data: inserted } = await adminClient.from("categorias").insert(row).select("id").single();
          if (inserted) b2bIdToLocalId.set(b2bId, inserted.id);
          synced++;
        }
      }
      // Second pass: set parent_id
      for (const item of data) {
        const c = item.category || item;
        const parentB2bId = c.parent_id || c.parent_category_id;
        const localId = b2bIdToLocalId.get(c.id);
        if (localId && parentB2bId && b2bIdToLocalId.has(parentB2bId)) {
          await adminClient.from("categorias").update({ parent_id: b2bIdToLocalId.get(parentB2bId) }).eq("id", localId);
        } else if (localId && !parentB2bId) {
          await adminClient.from("categorias").update({ parent_id: null }).eq("id", localId);
        }
      }
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged` }), { headers: jsonHeaders });
    }

    // ========== SYNC BRANDS (incremental) ==========
    if (action === "sync_brands") {
      const data = await fetchAllPages("brands.json", username, apiKey);
      const { data: existingBrands } = await adminClient.from("brands").select("id, nome, descricao, logo_url, ativo");
      const existingMap = new Map<string, any>();
      for (const b of existingBrands || []) existingMap.set(b.nome.toLowerCase(), b);

      let synced = 0, skipped = 0;
      for (const b of data) {
        const row = { nome: b.name || "Unnamed", descricao: b.description || null, logo_url: b.logo_url || b.image_url || null, ativo: b.is_active !== false };
        const existing = existingMap.get(row.nome.toLowerCase());
        if (existing) {
          const changed = existing.descricao !== row.descricao || existing.logo_url !== row.logo_url || existing.ativo !== row.ativo;
          if (changed) { await adminClient.from("brands").update(row).eq("id", existing.id); synced++; }
          else skipped++;
        } else {
          await adminClient.from("brands").insert(row); synced++;
        }
      }
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged` }), { headers: jsonHeaders });
    }

    // ========== SYNC PRODUCTS (incremental - compare by SKU) ==========
    if (action === "sync_products") {
      const allProducts = await fetchAllPages("products.json", username, apiKey);
      const b2bCategories = await fetchAllPages("categories.json", username, apiKey);
      const categoryNameByB2bId = new Map<number, string>();
      for (const c of b2bCategories) categoryNameByB2bId.set(c.id, c.name);
      const { data: localCategories } = await adminClient
        .from("categorias")
        .select("id, nome, ativo, b2bwave_id");
      const catB2bIdToId = new Map<number, string>();
      const activeCatNameToId = new Map<string, string>();
      for (const c of localCategories || []) {
        if (c.b2bwave_id) catB2bIdToId.set(c.b2bwave_id, c.id);
        if (c.ativo) activeCatNameToId.set(c.nome.toLowerCase(), c.id);
      }

      // ----- Preços por tabela (product_prices) -----
      // B2BWave devolve UM registro por (produto, pricelist). É a fonte REAL dos
      // preços; products.json muitas vezes NÃO traz 'price' (= produtos $0,00 no
      // clone). Montamos: pricelist b2b id -> {nome, is_default} e
      // produto b2b id -> Map(pricelist b2b id -> preço).
      const b2bPriceLists = await fetchAllPages("price_lists.json", username, apiKey).catch(() => []);
      const plB2bById = new Map<number, { name: string; isDefault: boolean }>();
      let defaultPlId: number | null = null;
      for (const pl of b2bPriceLists) {
        plB2bById.set(pl.id, { name: pl.name, isDefault: pl.is_default === true });
        if (pl.is_default === true) defaultPlId = pl.id;
      }
      const { data: localPLs } = await adminClient.from("tabelas_preco").select("id, nome");
      const plNameToLocalId = new Map<string, string>();
      for (const pl of localPLs || []) plNameToLocalId.set((pl.nome || "").toLowerCase(), pl.id);

      const productPrices = await fetchAllPaginated("product_prices.json", username, apiKey).catch(() => []);
      const pricesByProduct = new Map<number, Map<number, number>>();
      for (const pp of productPrices) {
        const pid = Number(pp.product_id), plid = Number(pp.pricelist_id);
        const val = parseFloat(pp.price ?? "0") || 0;
        if (!pid || !plid) continue;
        if (!pricesByProduct.has(pid)) pricesByProduct.set(pid, new Map());
        pricesByProduct.get(pid)!.set(plid, val);
      }

      // Load existing products for comparison. O casamento agora é por B2BWAVE_ID
      // (a identidade real) — o sku deixou de ser chave: é OPCIONAL (igual ao
      // B2BWave) e NÃO é mais auto-gerado ("b2b-123"/sufixos) quando não existe.
      const { data: existingProds } = await adminClient.from("produtos").select("id, sku, nome, preco, ativo, imagem_url, estoque_total, estoque_reservado, created_at, b2bwave_id");
      const existingMap = new Map<string, any>();          // por b2bwave_id
      const existingBySku = new Map<string, any>();        // fallback p/ linhas legadas sem b2bwave_id
      for (const p of existingProds || []) {
        if (p.b2bwave_id) existingMap.set(String(p.b2bwave_id), p);
        if (p.sku) existingBySku.set(p.sku.toLowerCase(), p);
      }

      const toUpsert: any[] = [];
      const legacyFixes: { id: string; row: any }[] = [];  // linhas antigas sem b2bwave_id: update por id
      let skipped = 0;

      for (const p of allProducts) {
        // Código REAL do B2BWave, ou NULO — SEM sufixos "-87": no original vários
        // produtos compartilham o mesmo código, e a UNIQUE local foi removida
        // (migração 20260708140000). O casamento é por b2bwave_id, não por sku.
        const finalSku: string | null = p.code || p.sku || null;

        // Preço base: usa o preço da tabela DEFAULT do B2BWave (fonte real).
        // Fallbacks: qualquer tabela com preço > 0 -> p.price -> MSRP. Resolve $0,00.
        const prodPriceMap = pricesByProduct.get(Number(p.id));
        let basePrice = 0;
        if (prodPriceMap) {
          if (defaultPlId != null && prodPriceMap.has(defaultPlId)) basePrice = prodPriceMap.get(defaultPlId)!;
          else { const first = [...prodPriceMap.values()].find(v => v > 0); if (first) basePrice = first; }
        }
        const wholesalePrice = basePrice || parseFloat(p.price || p.wholesale_price || p.base_price || "0") || 0;
        const msrpPrice = parseFloat(p.price_msrp || p.retail_price || p.price_retail || "0") || 0;
        const row: Record<string, any> = {
          sku: finalSku, nome: p.name || "Unnamed", descricao: p.description || null,
          preco: wholesalePrice || msrpPrice, // use wholesale, fallback to MSRP
          preco_msrp: msrpPrice || null,
          custo: parseFloat(p.cost_price || p.cost || "0") || null,
          ativo: p.is_active !== false,
          imagem_url: p.image_url || (p.gallery_image_urls?.[0]) || null,
          estoque_total: parseInt(p.quantity || p.stock || "0") || 0,
          // NÃO sincronizar `estoque_reservado`: é um contador LOCAL, mantido pelos
          // triggers de reserva do portal. O B2BWave não devolve esse campo, então
          // ele virava 0 a cada sync — o disponível (total - reservado) inflava e o
          // portal vendia estoque já comprometido por pedidos abertos.
          quantidade_minima: Math.max(parseInt(p.minimum_quantity || p.min_quantity || "0") || 0, 1),
          unidade_venda: p.unit || p.unit_of_measure || 'un',
          peso: parseFloat(p.weight || "0") || null,
          b2bwave_id: String(p.id),
          // Campos extras do clone (todas as colunas já existem no schema):
          barcode: p.barcode || null,
          codigo_upc: p.code_upc || null,
          codigo_referencia: p.reference_code || null,
          descricao_pdf: p.pdf_description || null,
          meta_descricao: p.meta_description || null,
          altura: parseFloat(p.height || "0") || null,
          largura: parseFloat(p.width || "0") || null,
          comprimento: parseFloat(p.length || "0") || null,
          quantidade_pacote: parseInt(p.package_quantity || "0") || null,
          permitir_backorder: p.can_backorder === true,
          promover_categoria: p.promote_category === true,
          promover_destaque: p.promote_front === true,
        };
        // is_private: só quando a API traz o campo (ausente != false), pra não clobbar a
        // privacidade raspada (grupos/clientes vêm do scrape).
        if (p.is_private !== undefined || p.private !== undefined) {
          row.is_private = p.is_private === true || p.private === true;
        }
        // created_at / disponibilidade REAIS do B2BWave (clone): só grava se vier.
        if (p.created_at) row.created_at = p.created_at;
        if (p.scheduled_at) row.data_disponibilidade = p.scheduled_at;
        if (p.category_id) {
          const localIdByApi = catB2bIdToId.get(p.category_id);
          const fallbackName = categoryNameByB2bId.get(p.category_id);
          const localIdByName = fallbackName ? activeCatNameToId.get(fallbackName.toLowerCase()) : null;
          const resolvedCategoryId = localIdByApi || localIdByName;
          if (resolvedCategoryId) row.categoria_id = resolvedCategoryId;
        }

        // Check if changed — casa por b2bwave_id; legado (sem b2bwave_id) casa por sku.
        const existing = existingMap.get(String(p.id))
          ?? (finalSku ? existingBySku.get(finalSku.toLowerCase()) : undefined);
        if (existing) {
          // Backfill one-shot: se a data local difere da real do B2BWave, atualiza.
          const dateFixNeeded = !!row.created_at && existing.created_at &&
            Math.abs(Date.parse(existing.created_at) - Date.parse(row.created_at)) > 1000;
          const changed = existing.nome !== row.nome || Number(existing.preco) !== row.preco ||
            existing.ativo !== row.ativo || existing.imagem_url !== row.imagem_url ||
            existing.estoque_total !== row.estoque_total || existing.categoria_id !== row.categoria_id ||
            // sku no diff: repõe o código real do B2BWave quando o local diverge
            // (é o caminho de RESTAURAÇÃO dos códigos zerados por engano).
            (existing.sku ?? null) !== (row.sku ?? null) ||
            Number(existing.preco_msrp) !== (row.preco_msrp ?? 0) || dateFixNeeded;
          if (!changed) { skipped++; continue; }
          // Linha legada sem b2bwave_id: upsert por b2bwave_id INSERIRIA duplicata.
          // Atualiza por id (e de quebra grava o b2bwave_id que faltava).
          if (!existing.b2bwave_id) { legacyFixes.push({ id: existing.id, row }); continue; }
        }
        toUpsert.push(row);
      }

      let synced = 0, errors = 0;
      const errorSamples: string[] = [];
      const chunkSize = 50;
      for (let i = 0; i < toUpsert.length; i += chunkSize) {
        const chunk = toUpsert.slice(i, i + chunkSize);
        const { error } = await adminClient.from("produtos").upsert(chunk, { onConflict: "b2bwave_id" });
        if (error) {
          for (const row of chunk) {
            const r = await adminClient.from("produtos").upsert(row, { onConflict: "b2bwave_id" });
            if (r.error) {
              errors++;
              if (errorSamples.length < 5) errorSamples.push(`${row.sku ?? row.nome}: ${r.error.message}`);
            } else synced++;
          }
        } else {
          synced += chunk.length;
        }
      }
      for (const f of legacyFixes) {
        const r = await adminClient.from("produtos").update(f.row).eq("id", f.id);
        if (r.error) { errors++; if (errorSamples.length < 5) errorSamples.push(`${f.row.nome}: ${r.error.message}`); }
        else synced++;
      }

      // Mapa produto b2b id -> local id (reaproveitado p/ preços, variantes e stale).
      const { data: allProds } = await adminClient.from("produtos").select("id, sku, b2bwave_id");
      const b2bIdToProdId = new Map<string, string>();
      for (const p of allProds || []) {
        if (p.b2bwave_id) b2bIdToProdId.set(String(p.b2bwave_id), p.id);
      }

      // ----- Grava preços por tabela em tabela_preco_itens (upsert idempotente) -----
      let priceRows = 0;
      const tpItens: any[] = [];
      for (const [prodB2bId, plMap2] of pricesByProduct) {
        const localProdId = b2bIdToProdId.get(String(prodB2bId));
        if (!localProdId) continue;
        for (const [plB2bId, preco] of plMap2) {
          const plInfo = plB2bById.get(plB2bId);
          if (!plInfo) continue;
          const localTabelaId = plNameToLocalId.get((plInfo.name || "").toLowerCase());
          if (!localTabelaId) continue;
          tpItens.push({ produto_id: localProdId, tabela_preco_id: localTabelaId, preco });
        }
      }
      for (let i = 0; i < tpItens.length; i += 100) {
        const chunk = tpItens.slice(i, i + 100);
        const { error } = await adminClient.from("tabela_preco_itens").upsert(chunk, { onConflict: "tabela_preco_id,produto_id" });
        if (!error) priceRows += chunk.length;
      }

      // ----- Variantes / opções de produto (Size/Color etc.) -----
      // B2BWave: product.product_variants[] = { code, option_values }. A sync é dona
      // total das variantes -> apaga e reinsere por produto que as possui (idempotente).
      let variantRows = 0;
      for (const p of allProducts) {
        const variants = Array.isArray(p.product_variants) ? p.product_variants : [];
        if (variants.length === 0) continue;
        const localProdId = b2bIdToProdId.get(String(p.id));
        if (!localProdId) continue;
        await adminClient.from("produto_variantes").delete().eq("produto_id", localProdId);
        const vrows = variants.map((v: any) => ({
          produto_id: localProdId,
          codigo: v.code || v.sku || `${p.id}-var`,
          valores_opcao: v.option_values ?? [],
          ativo: v.is_active !== false,
          quantidade: parseInt(v.quantity || "0") || 0,
          imagem_url: v.image_url || null,
        }));
        const { error } = await adminClient.from("produto_variantes").insert(vrows);
        if (!error) variantRows += vrows.length;
      }

      // RELATED / BUNDLED PRODUCTS: o sync NÃO gerencia mais isto.
      // Confirmado empiricamente (diag related-v3) que a API do B2BWave NÃO traz
      // related products no payload (arrays = gallery/variants/categories/...; único
      // campo "relish" = is_bundle, que é flag, não lista). Os relacionados vêm
      // EXCLUSIVAMENTE da tela Tools → Import Related Products (arquivo de export).
      // ATENÇÃO: a versão anterior deste passo APAGAVA os relacionados de todos os
      // produtos b2b e não reinseria nada (API vazia) — o que WIPAVA os links
      // importados manualmente. Por isso foi removido: o sync não toca em
      // produtos_relacionados. (Ver docs/MUDANCAS-JUL-08-09.md.)
      const relatedRows = 0;

      // Stale products. SEGURANÇA: nunca DELETA (irreversível); apenas DESATIVA, e só
      // produtos que vieram do B2BWave (b2bwave_id) — produto nativo do app é preservado.
      // Sanity: só roda se o feed veio "completo" (>=50% dos b2b locais vistos), pra um
      // fetch truncado (página curta) não desativar a base inteira.
      let deleted = 0;
      // Casa por b2bwave_id (o sku deixou de ser chave). seenB2bIds = ids vistos no feed.
      const seenB2bIds = new Set<string>((allProducts || []).map((p: any) => String(p.id)));
      const b2bLocal = (allProds || []).filter((p: any) => p.b2bwave_id);
      if (b2bLocal.length === 0 || seenB2bIds.size >= b2bLocal.length * 0.5) {
        for (const p of b2bLocal) {
          if (!seenB2bIds.has(String(p.b2bwave_id))) {
            await adminClient.from("produtos").update({ ativo: false }).eq("id", p.id);
            deleted++;
          }
        }
      }
      // DIAGNÓSTICO (persistido em sync_log.samples p/ consulta via SQL): se não veio
      // nenhum relacionado, registra os campos que a API realmente manda no produto
      // (arrays + qualquer chave "relat/bundle/together") — revela se o dado existe
      // no payload e com qual nome. O marcador "SYNC_VERSION:related-v4" confirma que
      // esta versão (sync NÃO toca em produtos_relacionados — não wipa os importados)
      // está de fato deployada.
      const diagSamples: string[] = ["SYNC_VERSION:related-v4"];
      if (relatedRows === 0 && allProducts.length) {
        const s = allProducts[0] as Record<string, any>;
        const arrays = Object.keys(s).filter((k) => Array.isArray(s[k]));
        const relish = Object.keys(s).filter((k) => /relat|bundle|together/i.test(k));
        diagSamples.push(`arrays=[${arrays.join(",")}]`, `relish=[${relish.join(",") || "none"}]`);
      }
      const relDiag = relatedRows === 0 ? ` | ${diagSamples.join(" ")}` : "";
      await logRun(adminClient, "products", { created: synced, errors, samples: [...diagSamples, ...errorSamples] });
      return new Response(JSON.stringify({
        success: true,
        samples: errorSamples,
        message: `${synced} updated/created, ${skipped} unchanged, ${priceRows} prices, ${variantRows} variants, ${relatedRows} related, ${errors} errors, ${deleted} stale deleted${relDiag}${errors && errorSamples.length ? ` | ex: ${errorSamples.join(' ; ')}` : ''}`,
      }), { headers: jsonHeaders });
    }

    // ========== SYNC PRICE LISTS (incremental) ==========
    if (action === "sync_price_lists") {
      const data = await fetchAllPages("price_lists.json", username, apiKey);
      const { data: existingPLs } = await adminClient.from("tabelas_preco").select("id, nome, descricao, ativo, is_default");
      const existingMap = new Map<string, any>();
      for (const pl of existingPLs || []) existingMap.set(pl.nome.toLowerCase(), pl);

      let synced = 0, skipped = 0;
      for (const pl of data) {
        const row = { nome: pl.name || "Unnamed", descricao: pl.description || null, ativo: pl.is_active !== false, is_default: pl.is_default === true };
        const existing = existingMap.get(row.nome.toLowerCase());
        if (existing) {
          const changed = existing.descricao !== row.descricao || existing.ativo !== row.ativo || existing.is_default !== row.is_default;
          if (changed) { await adminClient.from("tabelas_preco").update(row).eq("id", existing.id); synced++; }
          else skipped++;
        } else { await adminClient.from("tabelas_preco").insert(row); synced++; }
      }
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged` }), { headers: jsonHeaders });
    }

    // ========== SYNC SALES REPS (incremental) ==========
    if (action === "sync_sales_reps") {
      const data = await fetchAllPages("sales_reps.json", username, apiKey);
      const { data: existingReps } = await adminClient.from("representantes").select("id, email, nome, telefone, comissao_percentual, ativo");
      const existingMap = new Map<string, any>();
      for (const r of existingReps || []) existingMap.set(r.email.toLowerCase(), r);

      let synced = 0, skipped = 0;
      for (const r of data) {
        const nome = r.name || (r.first_name && r.last_name ? `${r.first_name} ${r.last_name}`.trim() : "Unnamed");
        const row = { nome, email: r.email || `rep-${r.id}@placeholder.com`, telefone: r.phone || r.phone_number || null, comissao_percentual: parseFloat(r.commission_rate || r.commission || "0") || 0, ativo: r.is_active !== false };
        const existing = existingMap.get(row.email.toLowerCase());
        if (existing) {
          const changed = existing.nome !== row.nome || existing.telefone !== row.telefone ||
            Number(existing.comissao_percentual) !== row.comissao_percentual || existing.ativo !== row.ativo;
          if (changed) { await adminClient.from("representantes").update(row).eq("id", existing.id); synced++; }
          else skipped++;
        } else {
          await adminClient.from("representantes").insert(row); synced++;
        }
      }
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged` }), { headers: jsonHeaders });
    }

    // ========== SYNC CUSTOMERS (incremental) ==========
    if (action === "sync_customers") {
      const data = await fetchAllPages("customers.json", username, apiKey);
      console.log(`[Sync] Processing ${data.length} customers`);

      const plMap = new Map<number, string>();
      const plNameToId = new Map<string, string>();
      try {
        const b2bPriceLists = await fetchAllPages("price_lists.json", username, apiKey);
        for (const pl of b2bPriceLists) plMap.set(pl.id, pl.name);
      } catch (e) { console.error("[Sync] Could not fetch price lists"); }
      const { data: localPLs } = await adminClient.from("tabelas_preco").select("id, nome");
      for (const pl of localPLs || []) plNameToId.set(pl.nome.toLowerCase(), pl.id);

      const { data: localReps } = await adminClient.from("representantes").select("id, email");
      const repEmailToId = new Map<string, string>();
      for (const r of localReps || []) repEmailToId.set(r.email.toLowerCase(), r.id);

      // Load existing customers for comparison
      const { data: existingCustomers } = await adminClient.from("clientes").select("id, email, nome, empresa, telefone, status, tabela_preco_id, representante_id, endereco, cidade, cep, created_at, discount, parent_customer_id");
      const existingMap = new Map<string, any>();
      for (const c of existingCustomers || []) existingMap.set(c.email.toLowerCase(), c);

      let synced = 0, skipped = 0, errors = 0, deactivated = 0;
      const seenEmails = new Set<string>();
      for (const item of data) {
        const c = item.customer || item;
        const email = c.email || "";
        if (!email) { errors++; continue; }
        seenEmails.add(email.toLowerCase());

        let tabelaPrecoId: string | null = null;
        if (c.pricelist_id && plMap.has(c.pricelist_id)) {
          const plName = plMap.get(c.pricelist_id)!;
          tabelaPrecoId = plNameToId.get(plName.toLowerCase()) || null;
        }

        let repId: string | null = null;
        if (c.sales_reps && c.sales_reps.length > 0) {
          const repEmail = c.sales_reps[0]?.sales_rep?.email || c.sales_reps[0]?.email || "";
          if (repEmail) repId = repEmailToId.get(repEmail.toLowerCase()) || null;
        }

        const status = c.approved === false ? "pendente" : (c.is_active === false ? "inativo" : "ativo");
        const row: Record<string, any> = {
          nome: c.name || c.company_name || "Unnamed",
          empresa: c.company_name || "",
          email,
          telefone: c.phone || c.phone2 || null,
          status,
          // tabela_preco_id / representante_id: NÃO incluir quando não resolvido (preserva
          // a atribuição existente — antes virava null e zerava o price list do cliente).
          // Endereço de entrega (clone):
          endereco: c.address || null,
          endereco2: c.address2 || null,
          cidade: c.city || null,
          estado: c.province || null,
          cep: c.postal_code || null,
          pais: c.country || null,
          // Campos extras (clone) — colunas já existem em `clientes`:
          website: c.website || null,
          company_number: c.company_number || null,
          discount: parseFloat(c.discount_percentage ?? "0") || null,
          minimum_order_value: parseFloat(c.minimum_order_value ?? "0") || null,
          customer_reference_code: c.reference_code || null,
          admin_comments: c.comments_admin || null,
          disable_ordering: c.disable_ordering === true,
          billing_same_as_contact: c.invoice_same !== false,
          is_active: c.is_active !== false,
        };
        // created_at REAL do B2BWave (clone): só grava se a API trouxe a data.
        if (c.created_at) row.created_at = c.created_at;
        // Só sobrescreve price list / rep se resolveu (senão preserva o existente).
        if (tabelaPrecoId) row.tabela_preco_id = tabelaPrecoId;
        if (repId) row.representante_id = repId;

        const existing = existingMap.get(email.toLowerCase());
        if (existing) {
          // SUB-USER (parent_customer_id) é nativo do app e pode compartilhar o email
          // do dono -> o sync NUNCA toca nele (senão sobrescreve status/is_active/flags).
          if (existing.parent_customer_id) { skipped++; continue; }
          // Backfill one-shot da data real + dados de endereço.
          const dateFixNeeded = !!row.created_at && existing.created_at &&
            Math.abs(Date.parse(existing.created_at) - Date.parse(row.created_at)) > 1000;
          const changed = existing.nome !== row.nome || existing.empresa !== row.empresa ||
            existing.telefone !== row.telefone || existing.status !== row.status ||
            (row.tabela_preco_id !== undefined && existing.tabela_preco_id !== row.tabela_preco_id) ||
            (row.representante_id !== undefined && existing.representante_id !== row.representante_id) ||
            existing.endereco !== row.endereco || existing.cidade !== row.cidade || existing.cep !== row.cep ||
            Number(existing.discount ?? 0) !== Number(row.discount ?? 0) || dateFixNeeded;
          if (changed) {
            const r = await adminClient.from("clientes").update(row).eq("id", existing.id);
            if (r.error) errors++; else synced++;
          } else {
            skipped++;
          }
        } else {
          const userId = crypto.randomUUID();
          const r = await adminClient.from("clientes").insert({ ...row, user_id: userId });
          if (r.error) errors++; else synced++;
        }
      }

      // Soft-delete DESABILITADO de propósito: este sync casa clientes por EMAIL e não
      // distingue clientes nativos do app (auto-cadastro, sub-usuários com parent_customer_id,
      // contas criadas no admin) dos vindos do B2BWave. Inativar "os que sumiram da lista"
      // mataria sub-usuários e cadastros do app a cada ciclo (15 min), e um fetch truncado
      // (página curta) inativaria em massa. Cliente removido no B2BWave ficar ativo aqui é
      // inofensivo; matar cliente real não é. Reativar só com um marcador de origem confiável.
      void deactivated;

      await logRun(adminClient, "customers", { created: synced, skipped, errors });
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged, ${deactivated} deactivated, ${errors} errors` }), { headers: jsonHeaders });
    }

    // ========== SYNC ORDERS - INCREMENTAL (only new orders, skip pre-2025) ==========
    if (action === "sync_orders_page") {
      const pageNum = body.page || 1;
      const offset = body.offset || 0;
      const limit = 50;
      
      const data = await fetchPage("orders.json", username, apiKey, pageNum);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, hasMore: false, message: `Page ${pageNum}: no data`, synced: 0, errors: 0 }), { headers: jsonHeaders });
      }
      
      const slice = data.slice(offset, offset + limit);
      if (slice.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, hasMore: data.length >= 500, 
          nextPage: pageNum + 1, nextOffset: 0,
          synced: 0, message: `Page ${pageNum} offset ${offset}: done, move to next page`
        }), { headers: jsonHeaders });
      }

      // Fast-skip: check if ALL orders in this slice are pre-2025
      const allPre2025 = slice.every((item: any) => {
        const o = item.order || item;
        const submitted = o.submitted_at || o.created_at || "";
        return submitted && new Date(submitted).getFullYear() < 2025;
      });
      if (allPre2025) {
        const moreInThisPage = offset + limit < data.length;
        const morePages = data.length >= 500;
        return new Response(JSON.stringify({
          success: true,
          hasMore: moreInThisPage || morePages,
          nextPage: moreInThisPage ? pageNum : pageNum + 1,
          nextOffset: moreInThisPage ? offset + limit : 0,
          pageSize: data.length,
          synced: 0, skipped: slice.length, items: 0, errors: 0,
          message: `Page ${pageNum} offset ${offset}: all ${slice.length} orders are pre-2025, skipped`
        }), { headers: jsonHeaders });
      }

      // Upsert (cria novos, ATUALIZA status/total/qtd dos existentes). skipPre2025=true.
      const { created, updated, skipped, errors } = await processOrderSlice(adminClient, slice, true, false);

      const moreInThisPage = offset + limit < data.length;
      const morePages = data.length >= 500;

      return new Response(JSON.stringify({
        success: true,
        hasMore: moreInThisPage || morePages,
        nextPage: moreInThisPage ? pageNum : pageNum + 1,
        nextOffset: moreInThisPage ? offset + limit : 0,
        pageSize: data.length,
        synced: created,
        updated,
        skipped,
        items: 0,
        errors,
        message: `Page ${pageNum} offset ${offset}: ${created} new, ${updated} updated, ${skipped} skipped, ${errors} errors`
      }), { headers: jsonHeaders });
    }

    // ========== SYNC ALL ORDERS (no date filter - full history) ==========
    if (action === "sync_orders_all") {
      const pageNum = body.page || 1;
      const offset = body.offset || 0;
      const limit = 50;
      
      const data = await fetchPage("orders.json", username, apiKey, pageNum);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, hasMore: false, message: `Page ${pageNum}: no data`, synced: 0, errors: 0 }), { headers: jsonHeaders });
      }
      
      const slice = data.slice(offset, offset + limit);
      if (slice.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, hasMore: data.length >= 500, 
          nextPage: pageNum + 1, nextOffset: 0,
          synced: 0, message: `Page ${pageNum} offset ${offset}: done, move to next page`
        }), { headers: jsonHeaders });
      }

      // Upsert (cria novos, ATUALIZA existentes). Histórico completo (sem filtro de data).
      const { created, updated, skipped, errors } = await processOrderSlice(adminClient, slice, false, false);

      const moreInThisPage = offset + limit < data.length;
      const morePages = data.length >= 500;

      return new Response(JSON.stringify({
        success: true,
        hasMore: moreInThisPage || morePages,
        nextPage: moreInThisPage ? pageNum : pageNum + 1,
        nextOffset: moreInThisPage ? offset + limit : 0,
        pageSize: data.length,
        synced: created,
        updated,
        skipped,
        items: 0,
        errors,
        message: `Page ${pageNum} offset ${offset}: ${created} new, ${updated} updated, ${skipped} skipped, ${errors} errors`
      }), { headers: jsonHeaders });
    }

    // ========== CRON TICK: incremental automático (sem aba aberta) ==========
    // Chamado pelo pg_cron com header X-Cron-Secret. Caminha pelas páginas de
    // orders.json usando um cursor persistido em sync_state, fazendo upsert.
    if (action === "cron_orders") {
      const PAGES_PER_TICK = body.pages || 6;
      let page = await getOrdersCursor(adminClient);
      let created = 0, updated = 0, skipped = 0, errors = 0, reachedEnd = false;

      for (let i = 0; i < PAGES_PER_TICK; i++) {
        let data: any;
        try {
          data = await fetchPage("orders.json", username, apiKey, page);
        } catch (e) {
          errors++;
          break; // erro de rede não aborta o cron; retoma do mesmo cursor no próximo tick
        }
        if (!Array.isArray(data) || data.length === 0) { reachedEnd = true; break; }

        // Fast-skip: página inteira pré-2025 → não toca o banco (histórico antigo).
        const allPre2025 = data.every((it: any) => {
          const o = it.order || it;
          const s = o.submitted_at || o.created_at || "";
          return s && new Date(s).getFullYear() < 2025;
        });
        if (!allPre2025) {
          const r = await processOrderSlice(adminClient, data, true, true);
          created += r.created; updated += r.updated; skipped += r.skipped; errors += r.errors;
        } else {
          skipped += data.length;
        }

        if (data.length < 500) { reachedEnd = true; break; } // última página → reinicia ciclo
        page++;
      }

      // `page` já aponta para a próxima página não processada (foi incrementado após
      // cada página concluída); se chegou ao fim, reinicia o ciclo no 1.
      const nextCursor = reachedEnd ? 1 : page;
      await setOrdersCursor(adminClient, nextCursor);
      await logRun(adminClient, "orders", { created, updated, skipped, errors });

      return new Response(JSON.stringify({
        success: true, created, updated, skipped, errors,
        nextCursor, wrapped: reachedEnd,
        message: `cron_orders: ${created} new, ${updated} updated, ${skipped} unchanged, ${errors} errors (next cursor ${nextCursor})`
      }), { headers: jsonHeaders });
    }

    // ========== FIX PRICES: update existing orders with $0 totals from B2BWave ==========
    if (action === "fix_order_prices") {
      // Find orders with zero total
      const { data: zeroPedidos } = await adminClient
        .from("pedidos")
        .select("id, numero")
        .or("total.eq.0,subtotal.eq.0")
        .limit(100);

      if (!zeroPedidos || zeroPedidos.length === 0) {
        return new Response(JSON.stringify({ success: true, message: "No zero-price orders found" }), { headers: jsonHeaders });
      }

      let fixed = 0, errors = 0;
      for (const pedido of zeroPedidos) {
        try {
          const b2bData = await b2bwaveFetch(`orders/${pedido.numero}.json`, username, apiKey);
          const o = b2bData.order || b2bData;
          // Mapeamento robusto + fallback pela soma dos itens (mesmo do upsertOrder).
          const { qty: itemsQty, sum: itemsSum } = buildOrderItems(o.order_products || [], new Map(), new Map());
          let subtotal = pickNum(o, ["total_before_vat", "subtotal", "net_total", "total"]);
          let total = pickNum(o, ["gross_total", "total_after_vat", "total", "total_before_vat", "grand_total", "order_total", "amount"]);
          if (subtotal <= 0) subtotal = itemsSum;
          if (total <= 0) total = itemsSum || subtotal;
          let quantidade = parseInt(o.total_quantity || "0") || 0;
          if (quantidade <= 0) quantidade = itemsQty;

          if (total > 0 || subtotal > 0) {
            await adminClient.from("pedidos").update({ subtotal, total, quantidade_total: quantidade }).eq("id", pedido.id);

            // Also fix items prices
            const orderProducts = o.order_products || [];
            for (const opItem of orderProducts) {
              const op = opItem.order_product || opItem;
              const qty = Math.max(parseInt(op.quantity || op.qty || "1") || 1, 1);
              const unitPrice = pickNum(op, ["price", "unit_price", "price_per_unit", "wholesale_price", "product_price", "final_unit_price"]);
              let itemSubtotal = pickNum(op, ["final_price", "total_price", "total_before_vat", "line_total", "subtotal", "total"]);
              if (itemSubtotal <= 0) itemSubtotal = unitPrice * qty;
              if (unitPrice > 0 || itemSubtotal > 0) {
                await adminClient.from("pedido_itens")
                  .update({ preco_unitario: unitPrice || (qty > 0 ? itemSubtotal / qty : 0), subtotal: itemSubtotal })
                  .eq("pedido_id", pedido.id)
                  .eq("sku", op.product_code || "");
              }
            }
            fixed++;
          }
        } catch (e) { errors++; }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Fixed ${fixed} of ${zeroPedidos.length} zero-price orders (${errors} errors)`
      }), { headers: jsonHeaders });
    }

    // ========== SYNC PRIVACY GROUPS ==========
    if (action === "sync_privacy_groups") {
      try {
        const data = await fetchAllPages("privacy_groups.json", username, apiKey);
        const { data: existingPGs } = await adminClient.from("privacy_groups").select("id, nome");
        const existingMap = new Map<string, any>();
        for (const pg of existingPGs || []) existingMap.set(pg.nome.toLowerCase(), pg);

        let synced = 0, skipped = 0;
        for (const pg of data) {
          const g = pg.privacy_group || pg;
          const row = {
            nome: g.name || "Unnamed",
            descricao: g.description || null,
            ativo: true,
            default_for_new_customers: g.default_for_new_customers ?? false,
          };
          const existing = existingMap.get(row.nome.toLowerCase());
          if (existing) { skipped++; }
          else { await adminClient.from("privacy_groups").insert(row); synced++; }
        }
        return new Response(JSON.stringify({ success: true, message: `${synced} created, ${skipped} already exist` }), { headers: jsonHeaders });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // ========== SYNC COMPANY ACTIVITIES ==========
    if (action === "sync_company_activities") {
      try {
        const data = await fetchAllPages("company_activities.json", username, apiKey);
        const { data: existingActs } = await adminClient.from("company_activities").select("id, tipo");
        const existingMap = new Map<string, any>();
        for (const a of existingActs || []) existingMap.set(a.tipo.toLowerCase(), a);

        let synced = 0, skipped = 0;
        for (const item of data) {
          const a = item.company_activity || item;
          const row = {
            tipo: a.name || a.tipo || "Unknown",
            descricao: a.description || null,
            customer_name: a.customer_name || null,
          };
          if (existingMap.has(row.tipo.toLowerCase())) { skipped++; }
          else { await adminClient.from("company_activities").insert(row); synced++; }
        }
        return new Response(JSON.stringify({ success: true, message: `${synced} created, ${skipped} already exist` }), { headers: jsonHeaders });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: jsonHeaders });
      }
    }

    // ========== SYNC EXTRA FIELDS ==========
    if (action === "sync_extra_fields") {
      // B2B Wave API does not expose an extra_fields endpoint (returns 404)
      // Extra fields are managed locally only
      return new Response(JSON.stringify({ success: true, message: "Extra fields are managed locally (not available in B2B Wave API)" }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: jsonHeaders });
  } catch (err: any) {
    console.error("B2B Wave sync error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: jsonHeaders });
  }
});
