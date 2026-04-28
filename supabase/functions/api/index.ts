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

  // Auth: check API token from header or query param
  const url = new URL(req.url);
  const apiToken = req.headers.get("x-api-token") || url.searchParams.get("token");
  
  if (!apiToken) {
    return new Response(JSON.stringify({ error: "Missing API token. Pass via x-api-token header or ?token= query param" }), 
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Validate token against configuracoes
  const { data: cfg } = await supabase.from("configuracoes").select("api_token").limit(1).maybeSingle();
  if (!cfg?.api_token || cfg.api_token !== apiToken) {
    return new Response(JSON.stringify({ error: "Invalid API token" }), 
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Parse path: /api/v1/{resource}/{id?}
  const pathParts = url.pathname.replace(/^\/api\//, "").replace(/^v1\//, "").split("/").filter(Boolean);
  // Edge function URL is like /api/v1/resource/id, but the function name is "api" so pathname might be just /resource/id
  const segments = url.pathname.split("/").filter(Boolean);
  // Find resource after "api" segment or use first meaningful segment
  let resource = "";
  let resourceId = "";
  
  // Try to find v1/resource pattern
  const v1Idx = segments.indexOf("v1");
  if (v1Idx >= 0 && segments[v1Idx + 1]) {
    resource = segments[v1Idx + 1];
    resourceId = segments[v1Idx + 2] || "";
  } else {
    // Fallback: last segments
    resource = segments[segments.length - 2] || segments[segments.length - 1] || "";
    resourceId = segments.length >= 2 ? segments[segments.length - 1] : "";
    // If resource equals function name, check query
    if (resource === "api") {
      resource = url.searchParams.get("resource") || "";
      resourceId = url.searchParams.get("id") || "";
    }
  }

  // Also support ?resource=xxx&id=xxx
  if (!resource) resource = url.searchParams.get("resource") || "";
  if (!resourceId) resourceId = url.searchParams.get("id") || "";

  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = Math.min(parseInt(url.searchParams.get("per_page") || "50"), 200);
  const offset = (page - 1) * perPage;

  const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const body = await req.json();
          const { data, error } = await supabase.from("produtos").update(body).eq("id", resourceId).select().single();
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
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const body = await req.json();
          const { data, error } = await supabase.from("pedidos").update(body).eq("id", resourceId).select().single();
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
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const body = await req.json();
          const { data, error } = await supabase.from("clientes").update(body).eq("id", resourceId).select().single();
          if (error) return json({ error: error.message }, 400);
          return json({ data });
        }
        break;
      }

      // ============ CATEGORIES ============
      case "categories": {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("categorias").select("*").order("ordem");
          return json({ data });
        }
        break;
      }

      // ============ PRICE LISTS ============
      case "price-lists": {
        if (req.method === "GET") {
          const { data } = await supabase.from("tabelas_preco").select("*").order("nome");
          return json({ data });
        }
        break;
      }

      // ============ SALES REPS ============
      case "sales-reps": {
        if (req.method === "GET") {
          const { data } = await supabase.from("representantes").select("*").order("nome");
          return json({ data });
        }
        break;
      }

      // ============ INVENTORY ============
      case "inventory": {
        if (req.method === "GET") {
          const { data, count } = await supabase.from("produtos").select("id, sku, nome, estoque_total, estoque_reservado, rastrear_estoque", { count: "exact" }).eq("rastrear_estoque", true).range(offset, offset + perPage - 1).order("nome");
          return json({ data, total: count, page, per_page: perPage });
        }
        if (req.method === "PUT" && resourceId) {
          const body = await req.json();
          if (body.estoque_total !== undefined) {
            const { data: old } = await supabase.from("produtos").select("estoque_total").eq("id", resourceId).single();
            await supabase.from("estoque_log").insert({ produto_id: resourceId, quantidade_anterior: old?.estoque_total || 0, quantidade_nova: body.estoque_total, motivo: body.motivo || "API update" });
            const { data, error } = await supabase.from("produtos").update({ estoque_total: body.estoque_total }).eq("id", resourceId).select().single();
            if (error) return json({ error: error.message }, 400);
            return json({ data });
          }
        }
        break;
      }

      // ============ CONFIG ============
      case "config": {
        if (req.method === "GET") {
          const { data } = await supabase.from("configuracoes").select("nome_empresa, email_contato, telefone_contato, endereco, moeda, fuso_horario, logo_url, cor_primaria, cor_secundaria, pedido_minimo").limit(1).maybeSingle();
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
