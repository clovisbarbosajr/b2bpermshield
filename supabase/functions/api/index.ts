import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Auth: API token só via HEADER (query param vazava em log de proxy/Referer).
  const url = new URL(req.url);
  const apiToken = req.headers.get("x-api-token") || "";

  if (!apiToken) {
    return new Response(JSON.stringify({ error: "Missing API token. Pass via x-api-token header." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Validate token (constant-time, evita timing side-channel).
  const { data: cfg } = await supabase.from("configuracoes").select("api_token").limit(1).maybeSingle();
  const expected = cfg?.api_token || "";
  const ctEqual = (a: string, b: string) => {
    if (a.length === 0 || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  };
  if (!expected || !ctEqual(apiToken, expected)) {
    return new Response(JSON.stringify({ error: "Invalid API token" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ROTA: o que vem DEPOIS do segmento `api` (o nome da funcao).
  //
  // A URL real e /functions/v1/api/v1/{resource}/{id}: o PRIMEIRO "v1" e o do
  // gateway do Supabase, nao o da API. O `segments.indexOf("v1")` anterior casava
  // com ele e devolvia `resource = "api"` -> caia no `default` e respondia 404
  // "Unknown resource" para TODA chamada pela URL nativa. E o fallback de query
  // param (`?resource=products`, o formato que a propria mensagem de ajuda
  // ensina) vivia dentro do `else`, ramo que nunca era alcancado — entao tambem
  // nao funcionava. Ancorar no segmento `api` resolve os dois formatos e tambem
  // o /api/v1/{resource} de dominio proprio.
  const segments = url.pathname.split("/").filter(Boolean);
  const apiIdx = segments.lastIndexOf("api");
  const rest = apiIdx >= 0 ? segments.slice(apiIdx + 1) : segments.slice();
  if (rest[0] === "v1") rest.shift();
  const resource = rest[0] || url.searchParams.get("resource") || "";
  const resourceId = rest[1] || url.searchParams.get("id") || "";

  // `parseInt("abc")` = NaN: `?page=abc` levava `range(NaN, NaN)` ao PostgREST e
  // o erro voltava como 500 cru. `?per_page=0` virava `range(0, -1)`. Entrada de
  // fora da casa, entao sanitiza aqui.
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
  const perPage = Math.min(Math.max(1, parseInt(url.searchParams.get("per_page") || "50") || 50), 200);
  const offset = (page - 1) * perPage;

  const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // SEGURANÇA: o PUT só pode gravar colunas da allow-list. Nunca campos sensíveis
  // (tabela_preco_id/parent_customer_id/user_id/can_confirm_order, total/subtotal/
  // desconto/is_paid/coupon_id, estoque_reservado, b2bwave_*) — com o token, body
  // cru deixava sobrescrever qualquer coluna.
  const WRITABLE: Record<string, string[]> = {
    products: ["nome", "descricao", "preco", "preco_msrp", "custo", "estoque_total", "ativo",
      "quantidade_minima", "quantidade_maxima", "categoria_id", "brand_id", "status_produto",
      "imagem_url", "peso", "barcode", "codigo_upc", "unidade_venda", "permitir_backorder"],
    orders: ["status", "admin_notes", "observacoes", "tracking_number", "delivery_date",
      "delivery_mode", "po_number"],
    customers: ["nome", "empresa", "email", "telefone", "endereco", "endereco2", "cidade",
      "estado", "cep", "pais", "website", "company_number", "discount", "minimum_order_value",
      "customer_reference_code", "admin_comments", "status", "is_active", "disable_ordering"],
  };
  const pickWritable = (obj: any, res: string) => {
    const allowed = WRITABLE[res] || [];
    const out: Record<string, any> = {};
    for (const k of allowed) if (obj && k in obj) out[k] = obj[k];
    return out;
  };

  try {
    switch (resource) {
      // ============ PRODUCTS ============
      case "products": {
        if (req.method === "GET") {
          if (resourceId) {
            const { data, error } = await supabase.from("produtos").select("*, categorias(nome), brands(nome), produto_imagens(*), produto_variantes(*)").eq("id", resourceId).single();
            if (error) return json({ error: error.message }, 404);
            return json({ data });
          }
          const { data, error, count } = await supabase.from("produtos").select("*, categorias(nome), brands(nome)", { count: "exact" }).range(offset, offset + perPage - 1).order("nome");
          // Sem isto uma falha de banco virava 200 com data:null, e a integracao
          // do outro lado concluia "nao ha produtos" em vez de "a consulta falhou".
          if (error) return json({ error: error.message }, 500);
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const payload = pickWritable(await req.json(), "products");
          if (Object.keys(payload).length === 0) return json({ error: "No writable fields. Allowed: " + WRITABLE.products.join(", ") }, 400);
          const { data, error } = await supabase.from("produtos").update(payload).eq("id", resourceId).select().single();
          if (error) return json({ error: error.message }, 400);
          return json({ data });
        }
        break;
      }

      // ============ ORDERS ============
      case "orders": {
        if (req.method === "GET") {
          if (resourceId) {
            const { data, error } = await supabase.from("pedidos").select("*, pedido_itens(*, produtos(nome, sku, imagem_url)), clientes(nome, email, empresa), enderecos(*), payment_options(nome), shipping_options(nome)").eq("id", resourceId).single();
            if (error) return json({ error: error.message }, 404);
            return json({ data });
          }
          const status = url.searchParams.get("status");
          let query = supabase.from("pedidos").select("*, clientes(nome, email, empresa), pedido_itens(count)", { count: "exact" });
          if (status) query = query.eq("status", status);
          const { data, error, count } = await query.range(offset, offset + perPage - 1).order("created_at", { ascending: false });
          if (error) return json({ error: error.message }, 500);
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const payload = pickWritable(await req.json(), "orders");
          if (Object.keys(payload).length === 0) return json({ error: "No writable fields. Allowed: " + WRITABLE.orders.join(", ") }, 400);
          const { data, error } = await supabase.from("pedidos").update(payload).eq("id", resourceId).select().single();
          if (error) return json({ error: error.message }, 400);
          return json({ data });
        }
        break;
      }

      // ============ CUSTOMERS ============
      case "customers": {
        if (req.method === "GET") {
          if (resourceId) {
            const { data, error } = await supabase.from("clientes").select("*, enderecos(*), representantes(nome)").eq("id", resourceId).single();
            if (error) return json({ error: error.message }, 404);
            return json({ data });
          }
          const { data, error, count } = await supabase.from("clientes").select("*", { count: "exact" }).range(offset, offset + perPage - 1).order("nome");
          if (error) return json({ error: error.message }, 500);
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const payload = pickWritable(await req.json(), "customers");
          if (Object.keys(payload).length === 0) return json({ error: "No writable fields. Allowed: " + WRITABLE.customers.join(", ") }, 400);
          const { data, error } = await supabase.from("clientes").update(payload).eq("id", resourceId).select().single();
          if (error) return json({ error: error.message }, 400);
          return json({ data });
        }
        break;
      }

      // ============ CATEGORIES ============
      // Os quatro recursos abaixo devolviam 200 com `data: null` quando a leitura
      // falhava — a mesma armadilha ja consertada em `products` (l.106): do outro
      // lado a integracao le "nao ha categoria/tabela/representante" em vez de "a
      // consulta falhou", e um sync que apaga o que nao veio limpa a base.
      case "categories": {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("categorias").select("*").order("ordem");
          if (error) return json({ error: error.message }, 500);
          return json({ data });
        }
        break;
      }

      // ============ PRICE LISTS ============
      case "price-lists": {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("tabelas_preco").select("*").order("nome");
          if (error) return json({ error: error.message }, 500);
          return json({ data });
        }
        break;
      }

      // ============ SALES REPS ============
      case "sales-reps": {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("representantes").select("*").order("nome");
          if (error) return json({ error: error.message }, 500);
          return json({ data });
        }
        break;
      }

      // ============ INVENTORY ============
      case "inventory": {
        if (req.method === "GET") {
          const { data, error, count } = await supabase.from("produtos").select("id, sku, nome, estoque_total, estoque_reservado, rastrear_estoque", { count: "exact" }).eq("rastrear_estoque", true).range(offset, offset + perPage - 1).order("nome");
          if (error) return json({ error: error.message }, 500);
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const body = await req.json();
          if (body.estoque_total !== undefined) {
            // Le o `error` ANTES de mexer no estoque: sem isso, falha de leitura
            // caia no `old?.estoque_total || 0` e o `estoque_log` registrava
            // "quantidade_anterior = 0" para um produto que tinha 400 — auditoria
            // de estoque afirmando um ajuste que nao foi esse. Fecha antes de
            // escrever, em vez de escrever e mentir no log.
            const { data: old, error: oldErr } = await supabase.from("produtos").select("estoque_total").eq("id", resourceId).single();
            if (oldErr) return json({ error: oldErr.message }, 404);
            // O UPDATE vem ANTES do log: gravando o log primeiro, um update que
            // falha deixava a auditoria afirmando um ajuste de estoque que nunca
            // aconteceu.
            const { data, error } = await supabase.from("produtos").update({ estoque_total: body.estoque_total }).eq("id", resourceId).select().single();
            if (error) return json({ error: error.message }, 400);
            const logErr = (await supabase.from("estoque_log").insert({ produto_id: resourceId, quantidade_anterior: old?.estoque_total || 0, quantidade_nova: body.estoque_total, motivo: body.motivo || "API update" })).error;
            if (logErr) console.error("estoque_log falhou:", logErr.message);
            return json({ data });
          }
        }
        break;
      }

      // ============ CONFIG ============
      case "config": {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("configuracoes").select("nome_empresa, email_contato, telefone_contato, endereco, moeda, fuso_horario, logo_url, cor_primaria, cor_secundaria, pedido_minimo").limit(1).maybeSingle();
          if (error) return json({ error: error.message }, 500);
          return json({ data });
        }
        break;
      }

      default:
        return json({ 
          error: "Unknown resource", 
          available_resources: ["products", "orders", "customers", "categories", "price-lists", "sales-reps", "inventory", "config"],
          usage: "Pass resource via URL path (e.g. /api/v1/products) or query param (?resource=products)"
        }, 404);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
