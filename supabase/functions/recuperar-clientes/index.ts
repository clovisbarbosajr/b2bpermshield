// ============================================================================
// RECUPERAR CLIENTES — função de UMA finalidade, temporária.
//
// POR QUE ELA EXISTE
// Em 02/set/2026 um `TRUNCATE public.tabela_preco_itens, public.tabelas_preco
// CASCADE` apagou também `public.clientes` (70 registros) e as tabelas que
// dependem dela. O `CASCADE` do TRUNCATE não respeita `ON DELETE SET NULL`: ele
// trunca toda tabela que referencia a truncada, e `clientes.tabela_preco_id`
// aponta para `tabelas_preco`.
//
// A `b2bwave-sync`, que era o caminho normal de trazer clientes, foi apagada
// horas antes no mesmo dia (commit 55ef241). Esta função é o pedaço dela que
// resolve o incidente — e SÓ ele.
//
// O QUE ELA FAZ, E O QUE ELA NÃO FAZ
//   FAZ ....... GET /api/customers.json no B2BWave e INSERT em `public.clientes`
//   NÃO faz ... pedido, produto, categoria, tabela de preço, variante
//   NÃO faz ... e-mail, SMS, nenhuma notificação de espécie alguma
//   NÃO faz ... criação de login (`auth.users` não é tocado)
//   NÃO faz ... UPDATE nem DELETE — só INSERT do que está faltando
//   NÃO tem ... cron. Roda quando alguém chama, e mais nada.
//
// A restrição de escopo é o ponto: reimportar pedidos dispararia um gatilho de
// notificação por pedido, e este projeto já teve um incidente de 1.508 SMS
// enviados a clientes reais exatamente assim.
//
// SEGREDOS: usa `B2BWAVE_USERNAME` e `B2BWAVE_API_KEY`, que já existem no
// ambiente. Nenhuma credencial trafega fora do servidor.
//
// APAGUE ESTA FUNÇÃO depois de usar. Ela reabre a porta do B2BWave, que foi
// fechada de propósito.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function b2bwaveFetch(endpoint: string, username: string, apiKey: string, maxRetries = 3) {
  const url = `https://${username}.b2bwave.com/api/${endpoint.replace(/\.json/g, "")}`;
  const auth = btoa(`${username}:${apiKey}`);
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`B2B Wave API ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      if (tentativa === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * tentativa));
    }
  }
}

// Mesma paginação da `b2bwave-sync`: página cheia (500) significa que há mais.
async function todosOsClientes(username: string, apiKey: string) {
  const todos: any[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await b2bwaveFetch(`customers?page=${page}`, username, apiKey);
    if (!Array.isArray(data) || data.length === 0) break;
    todos.push(...data);
    if (data.length < 500) break;
  }
  return todos;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const username = Deno.env.get("B2BWAVE_USERNAME");
  const apiKey = Deno.env.get("B2BWAVE_API_KEY");

  if (!username || !apiKey) {
    return json({ error: "B2BWAVE_USERNAME / B2BWAVE_API_KEY nao configurados" }, 500);
  }

  const db = createClient(SB_URL, SERVICE_KEY);

  // `dryRun` é o padrão DE PROPÓSITO: a primeira chamada só conta e mostra uma
  // amostra. Gravar exige `{"confirmar": true}` explícito — depois do TRUNCATE
  // de hoje, nenhuma escrita neste banco acontece por acidente de novo.
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo = dry run */ }
  const gravar = corpo?.confirmar === true;

  let brutos: any[];
  try {
    brutos = await todosOsClientes(username, apiKey);
  } catch (e) {
    return json({ error: "Falha ao ler o B2BWave: " + (e as Error).message }, 502);
  }

  // Quem JÁ está no banco, para não duplicar. Sem `ON CONFLICT`: `clientes.email`
  // pode não ter UNIQUE, e um upsert cego criaria a segunda linha em silêncio.
  const { data: existentes, error: exErr } = await db.from("clientes").select("email");
  if (exErr) return json({ error: "Falha ao ler os clientes atuais: " + exErr.message }, 500);
  const jaTem = new Set((existentes ?? []).map((c: any) => String(c.email ?? "").toLowerCase()));

  const linhas: Record<string, any>[] = [];
  const semEmail: number[] = [];
  const vistos = new Set<string>();

  for (const item of brutos) {
    const c = item.customer || item;
    const email = c.email || "";
    // Sem e-mail não há como identificar nem religar o login depois.
    if (!email) { semEmail.push(c.id); continue; }
    const chave = email.toLowerCase();
    if (jaTem.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);

    // Mapeamento IDÊNTICO ao da `b2bwave-sync` (bloco `sync_customers`), para o
    // cliente voltar com os mesmos valores que tinha. `tabela_preco_id` e
    // `representante_id` ficam de fora: as réguas foram apagadas de propósito e
    // serão recriadas do zero.
    linhas.push({
      nome: c.name || c.company_name || "Unnamed",
      empresa: c.company_name || "",
      email,
      telefone: c.phone || c.phone2 || null,
      status: c.approved === false ? "pendente" : (c.is_active === false ? "inativo" : "ativo"),
      endereco: c.address || null,
      endereco2: c.address2 || null,
      cidade: c.city || null,
      estado: c.province || null,
      cep: c.postal_code || null,
      pais: c.country || null,
      website: c.website || null,
      company_number: c.company_number || null,
      discount: parseFloat(c.discount_percentage ?? "0") || null,
      minimum_order_value: parseFloat(c.minimum_order_value ?? "0") || null,
      customer_reference_code: c.reference_code || null,
      admin_comments: c.comments_admin || null,
      disable_ordering: c.disable_ordering === true,
      billing_same_as_contact: c.invoice_same !== false,
      is_active: c.is_active !== false,
      ...(c.created_at ? { created_at: c.created_at } : {}),
    });
  }

  if (!gravar) {
    return json({
      modo: "dry-run — NADA foi gravado",
      lidos_no_b2bwave: brutos.length,
      ja_no_banco: jaTem.size,
      sem_email_ignorados: semEmail.length,
      seriam_inseridos: linhas.length,
      amostra: linhas.slice(0, 3).map((l) => ({ nome: l.nome, email: l.email, empresa: l.empresa })),
      para_gravar: 'chame de novo com o corpo {"confirmar": true}',
    });
  }

  // Em lotes: o PostgREST tem limite de payload, e um lote que falha no meio
  // deixa rastro do que entrou — por isso o relatório é por lote, não um total.
  const TAM = 100;
  const inseridos: string[] = [];
  const falhas: { lote: number; erro: string }[] = [];
  for (let i = 0; i < linhas.length; i += TAM) {
    const lote = linhas.slice(i, i + TAM);
    const { data, error } = await db.from("clientes").insert(lote).select("email");
    if (error) { falhas.push({ lote: i / TAM + 1, erro: error.message }); continue; }
    inseridos.push(...(data ?? []).map((r: any) => r.email));
  }

  const { count: totalAgora } = await db.from("clientes").select("id", { count: "exact", head: true });

  return json({
    modo: "gravado",
    lidos_no_b2bwave: brutos.length,
    inseridos: inseridos.length,
    falhas,
    total_de_clientes_agora: totalAgora ?? null,
    aviso: "Clientes voltam SEM login e SEM tabela de preco. Apague esta funcao depois de usar.",
  });
});
