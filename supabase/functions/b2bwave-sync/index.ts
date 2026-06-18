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

const statusMap: Record<string, string> = {
  "complete": "concluido", "completed": "concluido", "submitted": "recebido",
  "received": "recebido", "processing": "em_processamento", "in progress": "em_processamento",
  "shipped": "enviado", "cancelled": "cancelado", "canceled": "cancelado",
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
    numero, cliente_id: clienteId, status, subtotal, total,
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
      await fireNewOrderNotification(db, numero, total, clienteId).catch(() => {});
    }
  }
  return "created";
}

async function fireNewOrderNotification(db: any, numero: number, total: number, clienteId: string) {
  const { data: cli } = await db.from("clientes").select("nome, empresa, email, telefone").eq("id", clienteId).maybeSingle();
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
  const orderNums = slice.map((it: any) => parseInt((it.order || it).id) || 0).filter((n: number) => n > 0);
  const { data: existingOrders } = await db.from("pedidos").select("id, numero, status, total, subtotal, quantidade_total").in("numero", orderNums);
  const existing = new Map<number, ExistingOrder>();
  for (const e of existingOrders || []) {
    existing.set(e.numero, { id: e.id, status: e.status, total: Number(e.total), subtotal: Number(e.subtotal), quantidade_total: e.quantidade_total ?? 0 });
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
    productSkuToId.set((p.sku || "").toLowerCase(), p.id);
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
        const existing = existingMap.get(b2bId);
        if (existing) {
          // Compare key fields to see if update needed
          const changed = existing.nome !== row.nome || existing.descricao !== row.descricao ||
            existing.ativo !== row.ativo || existing.imagem_url !== row.imagem_url ||
            Number(existing.desconto) !== row.desconto || existing.ordem !== row.ordem;
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

      // Load existing products for comparison
      const { data: existingProds } = await adminClient.from("produtos").select("id, sku, nome, preco, ativo, imagem_url, estoque_total");
      const existingMap = new Map<string, any>();
      for (const p of existingProds || []) existingMap.set(p.sku.toLowerCase(), p);

      const seenSkus = new Set<string>();
      const toUpsert: any[] = [];
      let skipped = 0;

      for (const p of allProducts) {
        let sku = p.code || p.sku || `b2b-${p.id}`;
        if (seenSkus.has(sku)) sku = `${sku}-${p.id}`;
        let finalSku = sku;
        let counter = 2;
        while (seenSkus.has(finalSku)) finalSku = `${sku}-${counter++}`;
        seenSkus.add(finalSku);

        // B2BWave: 'price' = wholesale price, 'price_msrp' = retail/MSRP
        const wholesalePrice = parseFloat(p.price || p.wholesale_price || p.base_price || "0") || 0;
        const msrpPrice = parseFloat(p.price_msrp || p.retail_price || p.price_retail || "0") || 0;
        const row: Record<string, any> = {
          sku: finalSku, nome: p.name || "Unnamed", descricao: p.description || null,
          preco: wholesalePrice || msrpPrice, // use wholesale, fallback to MSRP
          preco_msrp: msrpPrice || null,
          custo: parseFloat(p.cost_price || p.cost || "0") || null,
          ativo: p.is_active !== false,
          imagem_url: p.image_url || (p.gallery_image_urls?.[0]) || null,
          estoque_total: parseInt(p.quantity || p.stock || "0") || 0,
          estoque_reservado: parseInt(p.quantity_reserved || "0") || 0,
          quantidade_minima: Math.max(parseInt(p.minimum_quantity || p.min_quantity || "0") || 0, 1),
          unidade_venda: p.unit || p.unit_of_measure || 'un',
          peso: parseFloat(p.weight || "0") || null,
          b2bwave_id: p.id || null,
        };
        if (p.category_id) {
          const localIdByApi = catB2bIdToId.get(p.category_id);
          const fallbackName = categoryNameByB2bId.get(p.category_id);
          const localIdByName = fallbackName ? activeCatNameToId.get(fallbackName.toLowerCase()) : null;
          const resolvedCategoryId = localIdByApi || localIdByName;
          if (resolvedCategoryId) row.categoria_id = resolvedCategoryId;
        }

        // Check if changed
        const existing = existingMap.get(finalSku.toLowerCase());
        if (existing) {
          const changed = existing.nome !== row.nome || Number(existing.preco) !== row.preco ||
            existing.ativo !== row.ativo || existing.imagem_url !== row.imagem_url ||
            existing.estoque_total !== row.estoque_total || existing.categoria_id !== row.categoria_id ||
            Number(existing.preco_msrp) !== (row.preco_msrp ?? 0);
          if (!changed) { skipped++; continue; }
        }
        toUpsert.push(row);
      }

      let synced = 0, errors = 0;
      const chunkSize = 50;
      for (let i = 0; i < toUpsert.length; i += chunkSize) {
        const chunk = toUpsert.slice(i, i + chunkSize);
        const { error } = await adminClient.from("produtos").upsert(chunk, { onConflict: "sku" });
        if (error) {
          for (const row of chunk) {
            const r = await adminClient.from("produtos").upsert(row, { onConflict: "sku" });
            if (r.error) errors++; else synced++;
          }
        } else {
          synced += chunk.length;
        }
      }

      // Delete stale products
      const { data: allProds } = await adminClient.from("produtos").select("id, sku");
      let deleted = 0;
      for (const p of allProds || []) {
        if (!seenSkus.has(p.sku)) {
          const { data: refs } = await adminClient.from("pedido_itens").select("id").eq("produto_id", p.id).limit(1);
          if (!refs || refs.length === 0) {
            await adminClient.from("produtos").delete().eq("id", p.id);
            deleted++;
          }
        }
      }
      return new Response(JSON.stringify({ success: true, message: `${synced} updated/created, ${skipped} unchanged, ${errors} errors, ${deleted} stale deleted` }), { headers: jsonHeaders });
    }

    // ========== SYNC PRICE LISTS (incremental) ==========
    if (action === "sync_price_lists") {
      const data = await fetchAllPages("price_lists.json", username, apiKey);
      const { data: existingPLs } = await adminClient.from("tabelas_preco").select("id, nome, descricao, ativo");
      const existingMap = new Map<string, any>();
      for (const pl of existingPLs || []) existingMap.set(pl.nome.toLowerCase(), pl);

      let synced = 0, skipped = 0;
      for (const pl of data) {
        const row = { nome: pl.name || "Unnamed", descricao: pl.description || null, ativo: pl.is_active !== false };
        const existing = existingMap.get(row.nome.toLowerCase());
        if (existing) {
          const changed = existing.descricao !== row.descricao || existing.ativo !== row.ativo;
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
      const { data: existingCustomers } = await adminClient.from("clientes").select("id, email, nome, empresa, telefone, status, tabela_preco_id, representante_id");
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
        const row = {
          nome: c.name || c.company_name || "Unnamed",
          empresa: c.company_name || "",
          email,
          telefone: c.phone || c.phone2 || null,
          status,
          tabela_preco_id: tabelaPrecoId,
          representante_id: repId,
        };

        const existing = existingMap.get(email.toLowerCase());
        if (existing) {
          const changed = existing.nome !== row.nome || existing.empresa !== row.empresa ||
            existing.telefone !== row.telefone || existing.status !== row.status ||
            existing.tabela_preco_id !== row.tabela_preco_id || existing.representante_id !== row.representante_id;
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

      // Soft-delete: inativa clientes que não vieram mais na lista do B2BWave (nunca apaga).
      for (const c of existingCustomers || []) {
        if (!seenEmails.has((c.email || "").toLowerCase()) && c.status !== "inativo") {
          const r = await adminClient.from("clientes").update({ status: "inativo" }).eq("id", c.id);
          if (!r.error) deactivated++;
        }
      }

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
