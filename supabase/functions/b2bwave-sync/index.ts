// ============================================================================
// REGRA NUMERO UM DESTE ARQUIVO
//
// TODA operacao que toca MAIS DE UM PEDIDO precisa DESLIGAR a notificacao antes
// de comecar:
//
//     await suprimirNotificacao(adminClient, true, 30);
//     try { ...o lote... } finally { await suprimirNotificacao(adminClient, false); }
//
// POR QUE: existe um gatilho no banco (`trg_order_status_notify`) que manda
// SMS/e-mail A CADA mudanca de status de pedido — e ele NAO distingue "o admin
// mudou" de "o sync reconciliou". Reconciliar N pedidos = N mensagens.
//
// O QUE ACONTECEU EM 25/ago/2026: a paginacao da API de pedidos estava quebrada
// (`orders.json?page=N` ignora o `page`; o certo e `paginated=1&per_page=500`),
// entao o sync so via 9 pedidos. Ao corrigir isso, ele passou a reconciliar
// 1.147 de uma vez e saiu 1 SMS POR PEDIDO: 1281 mensagens aceitas pela Twilio
// em uma hora, 227 falhas, e cada falha gerou ainda um e-mail de alerta ao
// admin. Custo real para o dono, e o servidor de e-mail engasgou.
//
// Existe teto no banco como segunda linha de defesa, mas ele e um ALARME, nao
// uma licenca: se voce depender do teto, alguem ja recebeu mensagem errada.
// ============================================================================

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

// Le uma tabela INTEIRA do Supabase. O PostgREST corta a resposta em
// `db-max-rows` (1000 neste projeto) SEM erro e SEM aviso — `error` vem null e a
// lista volta curta. Aqui isso nao e detalhe de performance, e corrupcao:
//
//   - `clientes` truncado => o cliente #1001 nao entra no mapa de existentes e o
//     sync o INSERE de novo A CADA CICLO do cron (nao ha UNIQUE em
//     clientes.email pra segurar), enchendo a base de fichas duplicadas;
//   - `produtos` truncado => preco por tabela e variantes nao sao gravados, em
//     silencio, e item de pedido fica sem produto_id.
//
// `.order("id")`: paginacao por OFFSET sem ORDER BY nao tem ordem definida no
// Postgres — com escrita concorrente a mesma linha pode vir duas vezes ou
// nenhuma. Avanca pelo que VEIO e so para na pagina vazia: se o `db-max-rows`
// for menor que o pedaco pedido, parar no "veio menos que pedi" deixaria o resto
// pra tras achando que acabou.
async function lerTudo(
  tabela: string,
  colunas: string,
  db: any,
  pedaco = 1000,
): Promise<any[]> {
  const out: any[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await db.from(tabela).select(colunas)
      .order("id", { ascending: true }).range(de, de + pedaco - 1);
    if (error) throw new Error(`falha ao ler ${tabela}: ${error.message}`);
    const pagina = data ?? [];
    out.push(...pagina);
    if (pagina.length === 0) break;
    de += pagina.length;
  }
  return out;
}

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

// Tamanho de pagina dos PEDIDOS. Precisa bater com os testes de "acabou?"
// espalhados pelo arquivo (`length < ORDERS_PER_PAGE`), por isso e constante.
const ORDERS_PER_PAGE = 500;

// Busca uma pagina de pedidos SEMPRE na forma paginada.
//
// `orders.json?page=N` sozinho IGNORA o `page`: medido na API real (acao
// `debug_orders_paging`) — pagina 1 e pagina 2 devolviam os MESMOS 9 pedidos.
// Como todo o codigo testa `length < 500` para decidir que acabou, uma resposta
// de 9 encerrava o laco na primeira pagina. Efeito: o cron diario so enxergava
// os 9 pedidos mais recentes, e qualquer alteracao feita no B2BWave num pedido
// mais antigo nunca chegava aqui.
//
// Com `paginated=1&per_page=500` a API pagina de verdade: pagina 1 = ids
// 2821..2300, pagina 2 = 2299..1787.
async function fetchOrdersPage(username: string, apiKey: string, page: number) {
  return await fetchPage(`orders.json?paginated=1&per_page=${ORDERS_PER_PAGE}`, username, apiKey, page);
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
// `status_order_name` do B2BWave -> enum local (src/lib/orderStatuses.ts).
// Chave sempre em minusculas.
//
// O mapa estava INCOMPLETO: "Ready for Pickup", "Partial" e "On Hold" existem no
// B2BWave e no enum local, mas nao estavam aqui — caiam no fallback e o pedido
// aparecia com status ERRADO na tela. O pedido 2820, por exemplo, estava
// "Ready for Pickup" la e "Submitted" aqui. Nao e clone.
const statusMap: Record<string, string> = {
  "submitted": "submitted",
  "received": "submitted",
  "ready for pickup": "ready_for_pickup",
  "ready_for_pickup": "ready_for_pickup",
  "partial": "partial",
  "partially shipped": "partial",
  "on hold": "on_hold",
  "on_hold": "on_hold",
  "processing": "on_hold",
  "in progress": "on_hold",
  "shipped": "sent",
  "sent": "sent",
  "complete": "complete",
  "completed": "complete",
  "cancelled": "cancelled",
  "canceled": "cancelled",
};

// Pagamento vindo do B2BWave — campo `is_paid`, confirmado na API real da conta
// (a acao `debug_order_fields` listou: payment_token, is_paid, paid_amount,
// payment_option_name). Um SO campo, o mesmo nome dos dois lados: e dinheiro,
// entao isto tem que ser copia, nao deducao.
//
// Aceita booleano, numero ou texto so porque o JSON pode serializar de
// qualquer um desses jeitos — o CAMPO continua sendo um so.
//
// Devolve `undefined` quando o B2BWave nao manda o campo. `undefined` nao entra
// no patch, entao um pedido sem a informacao NAO tem o valor local sobrescrito.
function pickPago(o: any): boolean | undefined {
  const v = o?.is_paid;
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const t = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "paid", "t"].includes(t)) return true;
  if (["false", "0", "no", "unpaid", "f"].includes(t)) return false;
  // Valor inesperado: nao adivinha. Melhor nao escrever nada do que escrever errado.
  console.warn(`[b2bwave-sync] is_paid com valor inesperado: ${JSON.stringify(v)}`);
  return undefined;
}

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

type ExistingOrder = { id: string; status: string; total: number; subtotal: number; quantidade_total: number; data_origem: string | null };

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

  const b2bStatus = (o.status_order_name || o.status || "submitted").trim().toLowerCase();
  // Fallback = "submitted" (canonico). Antes era "recebido", valor LEGADO em
  // portugues que a migration 20260622170000 ja tinha convertido no banco — o
  // sync continuava reintroduzindo.
  //
  // O console registra todo status nao mapeado: se o B2BWave criar um status
  // novo, isso aparece em vez de sumir dentro do fallback.
  const statusMapeado = statusMap[b2bStatus];
  if (!statusMapeado) console.warn(`[b2bwave-sync] status nao mapeado: "${b2bStatus}" (pedido ${numero}) — usando submitted`);
  const status = statusMapeado || "submitted";
  // SEM DATA DO B2BWAVE = NAO INVENTA E NAO NOTIFICA.
  //
  // Antes caia em `new Date()`, e esse valor ia para DUAS coisas: o `created_at`
  // gravado no pedido E o calculo de idade que decide se notifica. Efeito: um
  // pedido de 2025 sem data era gravado como criado HOJE — entao a trava de
  // "nada retroativo" passava a considera-lo recente PARA SEMPRE, e o aviso de
  // pedido novo ia para o celular do cliente falando de uma compra velha.
  //
  // `new Date("lixo").toISOString()` tambem LANCA RangeError, e nao ha try/catch
  // por item: uma data malformada derrubava o lote inteiro.
  let submittedAt: string | null = null;
  if (submittedRaw) {
    const d = new Date(submittedRaw);
    if (!isNaN(d.getTime())) submittedAt = d.toISOString();
    else console.warn(`[b2bwave-sync] data invalida no pedido ${numero}: ${JSON.stringify(submittedRaw)}`);
  }
  // `podeNotificar`: so com data REAL da origem. Sem data, o pedido entra no
  // sistema (nao perder o pedido e mais importante), mas fica calado.
  const podeNotificar = submittedAt !== null;
  // TETO DE IMPORTACAO — fixo no codigo, DE PROPOSITO.
  //
  // Pedido importado do B2BWave so nasce (ou volta a ser) notificavel se a data
  // da origem estiver dentro desta janela. E independente de
  // `order_notify_max_age_days`, que fica no banco e vale para os TRES portoes.
  //
  // Por que nao ler a config aqui: se lesse, aumentar o numero no banco
  // reabilitaria a frota importada inteira de uma vez — as duas defesas viravam
  // uma, que e a forma exata do incidente de 25/ago. Fixo no codigo significa
  // que ampliar o alcance para pedido IMPORTADO exige deploy e revisao.
  //
  // Consequencia a saber: com `order_notify_max_age_days = 30`, um pedido
  // importado de 10 dias fica mudo mesmo dentro da janela configurada. Falha
  // fechada (silencio, nao spam), mas silenciosa — por isso este comentario e a
  // nota na tela de Notificacoes.
  //
  // NAO CONFUNDIR com a janela do aviso de PEDIDO NOVO, que e de 2 dias e fica
  // mais abaixo neste mesmo arquivo, na CHAMADA de `fireNewOrderNotification`
  // (nao dentro dela). Sao duas janelas diferentes, para coisas diferentes.
  //
  // E saiba do limite desta aqui: `notificavel` e PEGAJOSO — uma vez `true`,
  // nunca volta a `false` por idade. Este teto protege o MOMENTO da importacao,
  // nao a vida inteira do pedido. Depois disso quem segura e o limite de idade
  // nos tres portoes.
  const TETO_IMPORTADO_DIAS = 7;
  const recenteDeVerdade = submittedAt !== null
    && (Date.now() - new Date(submittedAt).getTime()) < TETO_IMPORTADO_DIAS * 24 * 60 * 60 * 1000;
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
    // `precisaReparar`: o backfill calou TODO pedido importado que existia antes
    // da coluna. Sem esta condicao, pedido estavel nunca mais seria revisitado
    // (o comparador so olha status/total/subtotal/quantidade) e ficaria calado
    // PARA SEMPRE — inclusive um pedido legitimo de hoje.
    //
    // Com ela, o primeiro ciclo do sync grava a data real da origem e devolve a
    // voz a quem merece. Custa um UPDATE por pedido, uma unica vez.
    const precisaReparar = submittedAt !== null && !ex.data_origem;
    const changed = ex.status !== status || Number(ex.total) !== total ||
      Number(ex.subtotal) !== subtotal || (ex.quantidade_total ?? 0) !== quantidade;
    if (!changed && !precisaReparar) return "skipped";
    const pago = pickPago(o);
    const upd = await db.from("pedidos").update({
      status, subtotal, total, quantidade_total: quantidade,
      // `data_origem` SEMPRE que a origem informar — e o dado verdadeiro.
      //
      // `notificavel`, porem, so sobe de false para true quando o pedido e
      // GENUINAMENTE recente. Duas razoes:
      //   - subir incondicionalmente reduzia duas defesas a uma: os 1150 pedidos
      //     passariam a depender so de `order_notify_max_age_days`, uma linha
      //     editavel em `sync_state`. Alguem poe 3650 ali e a frota inteira
      //     volta a falar — a mesma forma do incidente;
      //   - e apagava o kill-switch manual: admin calava um pedido, o proximo
      //     tick do sync ressuscitava. O COMMENT da coluna promete o contrario.
      // Descer para false continua incondicional: sem data, nao fala.
      ...(submittedAt
        ? { data_origem: submittedAt, ...(recenteDeVerdade ? { notificavel: true } : {}) }
        : { notificavel: false }),
      // So entra no patch quando o B2BWave realmente informou — ver pickPago.
      ...(pago === undefined ? {} : { is_paid: pago }),
      observacoes: o.comments_customer || o.customer_comments || null,
      admin_notes: o.admin_notes || o.internal_notes || null,
      po_number: o.customer_order_reference || o.purchase_order || o.po_number || null,
      delivery_date: deliveryDate,
    }).eq("id", ex.id);
    if (upd.error) return "error";
    // `changed &&`: o reparo (gravar `data_origem`) NAO precisa reescrever itens.
    // Sem esta condicao, os ~1150 pedidos importados fariam DELETE+INSERT de
    // itens de uma vez — 3 chamadas HTTP cada, num tick sem orcamento de tempo —
    // e cada pedido ficaria momentaneamente SEM ITENS, multiplicando por 1150 a
    // exposicao ao buraco que o comentario abaixo descreve. De graca.
    if (changed && itemRows.length > 0) {
      // delete + insert sao DUAS chamadas HTTP, ou seja, duas transacoes: nao ha
      // rollback. Se o insert falhar e o erro for descartado, o pedido fica com
      // ZERO itens e a funcao ainda retorna "updated".
      //
      // E nao se auto-cura: o comparador `changed` acima so olha
      // status/total/subtotal/quantidade_total, que nao mudaram — o proximo
      // ciclo devolve "skipped" e os itens nunca voltam. Ficaria um pedido com
      // total certo e nenhuma linha, para sempre.
      const del = await db.from("pedido_itens").delete().eq("pedido_id", ex.id);
      if (del.error) return "error";
      const insItens = await db.from("pedido_itens").insert(itemRows.map((r) => ({ ...r, pedido_id: ex.id })));
      if (insItens.error) {
        // Aqui os itens JA foram apagados e o update do pedido JA commitou. Sem
        // rollback, o unico jeito de nao deixar o pedido vazio pra sempre e
        // garantir que o proximo ciclo tente de novo.
        //
        // `changed` compara status/total/subtotal/quantidade_total. Zerando o
        // `quantidade_total` no banco, a proxima execucao ve diferenca contra o
        // valor real vindo do B2BWave e refaz o delete+insert — em vez de
        // devolver "skipped" para sempre. Se ate isso falhar, nao ha o que
        // fazer daqui; fica o "error" no contador do sync_log.
        await db.from("pedidos").update({ quantidade_total: 0 }).eq("id", ex.id);
        return "error";
      }
    }
    return "updated";
  }

  const pagoNovo = pickPago(o);
  const ins = await db.from("pedidos").insert({
    numero, b2bwave_order_id: numero, cliente_id: clienteId, status, subtotal, total,
    ...(pagoNovo === undefined ? {} : { is_paid: pagoNovo }),
    observacoes: o.comments_customer || o.customer_comments || null,
    admin_notes: o.admin_notes || o.internal_notes || null,
    po_number: o.customer_order_reference || o.purchase_order || o.po_number || null,
    delivery_date: deliveryDate,
    quantidade_total: quantidade,
    shipping_option_id: null, payment_option_id: null,
    // OMITIR `created_at` NAO resolvia: a coluna tem DEFAULT now(), entao o
    // pedido de 2025 continuava nascendo com a data de hoje e a trava de idade
    // o considerava recente. Por isso a marca e EXPLICITA:
    //   data_origem = a data real da origem (NULL se o B2BWave nao informou)
    //   notificavel = false quando nao ha data confiavel
    // Assim nao dependemos de deduzir idade de um campo que nos mesmos
    // preenchemos errado.
    ...(submittedAt ? { created_at: submittedAt } : {}),
    data_origem: submittedAt,
    // `recenteDeVerdade`, NAO `podeNotificar`: ter data nao basta, a data
    // precisa ser recente. Com `podeNotificar`, pedido de jan/2025 importado
    // hoje nascia liberado e as duas defesas viravam UMA (so o numero editavel
    // em `sync_state`). Morde de verdade: `skipPre2025` so barra ano < 2025, e
    // reimportar a base traria os 1.147 por este caminho — o backfill da
    // migration ja rodou e nao alcanca pedido novo.
    notificavel: recenteDeVerdade,
  }).select("id").single();
  if (ins.error || !ins.data) return "error";
  const orderId = ins.data.id;
  existing.set(numero, { id: orderId, status, total, subtotal, quantidade_total: quantidade, data_origem: submittedAt });
  if (itemRows.length > 0) {
    // Mesmo buraco do caminho de UPDATE, e pelo mesmo motivo: sem checar o erro,
    // um pedido NOVO ficava com zero itens e retornava "created" — e como o
    // comparador `changed` so olha status/total/subtotal/quantidade_total, todo
    // ciclo seguinte devolvia "skipped". Ficava vazio para sempre, sem nem
    // aparecer no contador de erros.
    //
    // Zerar `quantidade_total` faz o proximo ciclo ver diferenca e refazer.
    // Seguro: os triggers de recalculo pulam pedido com b2bwave_order_id.
    const insItens = await db.from("pedido_itens").insert(itemRows.map((r) => ({ ...r, pedido_id: orderId })));
    if (insItens.error) {
      await db.from("pedidos").update({ quantidade_total: 0 }).eq("id", orderId);
      existing.set(numero, { id: orderId, status, total, subtotal, quantidade_total: 0, data_origem: submittedAt });
      return "error";
    }
  }
  // Notifica só pedidos NOVOS e RECENTES (evita spam de milhares na recuperação).
  if (opts.notify && CRON_SECRET && podeNotificar) {
    const ageMs = Date.now() - new Date(submittedAt as string).getTime();
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
        // `order_id` = UUID, nao o `numero`. `pedidos.numero` NAO e unico (app e
        // B2BWave escrevem no mesmo espaco de inteiros), e a barreira de idade
        // busca por este campo: com o numero, ela podia ler o pedido ERRADO e
        // liberar justamente o que devia calar.
        order_id: orderId ?? numero,
        order_numero: numero,
        total, date: new Date().toISOString(),
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
  // Checa o erro: descartado, uma falha transitoria deste select deixava
  // `existing` VAZIO e mandava o slice inteiro para o ramo de INSERT — 500
  // tentativas de criar pedido que ja existe.
  const { data: existingOrders, error: exErr } = await db.from("pedidos")
    .select("id, b2bwave_order_id, status, total, subtotal, quantidade_total, data_origem")
    .in("b2bwave_order_id", b2bIds);
  if (exErr) throw new Error("falha ao ler pedidos existentes: " + exErr.message);
  const existing = new Map<number, ExistingOrder>();
  for (const e of existingOrders || []) {
    existing.set(e.b2bwave_order_id, { id: e.id, status: e.status, total: Number(e.total), subtotal: Number(e.subtotal), quantidade_total: e.quantidade_total ?? 0, data_origem: (e as any).data_origem ?? null });
  }
  const [clientesTodos, produtosTodos] = await Promise.all([
    lerTudo("clientes", "id, email", db),
    lerTudo("produtos", "id, sku, nome", db),
  ]);
  const clientesRes = { data: clientesTodos };
  const productsRes = { data: produtosTodos };
  const clienteEmailToId = new Map<string, string>();
  for (const c of clientesRes.data || []) clienteEmailToId.set((c.email || "").toLowerCase(), c.id);
  const productSkuToId = new Map<string, string>();
  const productNameToId = new Map<string, string>();
  for (const p of productsRes.data || []) {
    // Só indexa sku PREENCHIDO — sku vazio no índice casaria o produto errado
    // (qualquer código "startsWith" de string vazia é true).
    if (p.sku) productSkuToId.set(p.sku.toLowerCase(), p.id);
    // Mesma guarda do sku: `(p.nome || "")` indexava a chave "" e um item sem
    // nome casava com qualquer produto de nome vazio.
    if (p.nome) productNameToId.set(p.nome.toLowerCase(), p.id);
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
// Liga/desliga a supressao de notificacao de status durante operacao em massa.
//
// SEM ISTO A TRAVA NAO EXISTE: a funcao no banco existia mas ninguem chamava.
// Foi o pior achado da revisao — a protecao estava desligada por omissao.
//
// O `_minutos` e validade: se esta funcao morrer no meio (timeout da edge,
// deploy, erro nao tratado), a supressao expira sozinha em vez de deixar o
// cliente sem aviso para sempre.
async function suprimirNotificacao(db: any, ligar: boolean, minutos = 30) {
  // `.rpc()` do supabase-js NAO LANCA em erro — resolve com `{ error }`. Um
  // try/catch aqui nunca dispararia, e o sync seguiria achando que esta
  // suprimido quando nao esta: o mesmo tipo de "protecao desligada por omissao"
  // que causou o incidente. Por isso o erro e lido explicitamente.
  let msg: string | null = null;
  try {
    const { error } = await db.rpc("set_suppress_order_notify", { _on: ligar, _minutos: minutos });
    if (error) msg = error.message ?? String(error);
  } catch (e) {
    msg = String((e as any)?.message ?? e);
  }
  if (!msg) return;

  console.error("[b2bwave-sync] set_suppress_order_notify falhou:", msg);
  // LIGAR que falha ABORTA a operacao: rodar um lote sem supressao e o cenario
  // exato do incidente. Melhor o lote nao rodar do que rodar disparando SMS.
  // DESLIGAR que falha nao aborta — nao ha nada a proteger, e a supressao expira
  // sozinha pela validade.
  if (ligar) throw new Error("supressao de notificacao indisponivel — lote abortado: " + msg);
}

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
      const data = await fetchOrdersPage(username, apiKey, page);
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

    // Mostra os CAMPOS CRUS de um pedido do B2BWave. Existe porque o mapeamento
    // de pagamento nao pode ser adivinhado: e dinheiro, e tem que ser o campo
    // real da API, com o nome real. Devolve so as chaves (e um exemplo pequeno
    // de cada) — nao despeja o pedido inteiro no log.
    if (action === "debug_order_fields") {
      const page = body.page || 1;
      const data = await fetchOrdersPage(username, apiKey, page);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, message: "No data" }), { headers: jsonHeaders });
      }
      const o = (data[0] as any).order || data[0];
      const resumo: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        if (v === null || v === undefined) { resumo[k] = "null"; continue; }
        if (Array.isArray(v)) { resumo[k] = `array(${v.length})`; continue; }
        if (typeof v === "object") { resumo[k] = "object"; continue; }
        resumo[k] = `${typeof v}: ${String(v).slice(0, 40)}`;
      }
      const suspeitos = Object.keys(o).filter((k) => /pay|paid|financ|balance|due|invoice/i.test(k));
      return new Response(JSON.stringify({
        success: true, order_id: o.id, campos: resumo, campos_de_pagamento: suspeitos,
      }, null, 2), { headers: jsonHeaders });
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
    // NOTA sobre notificacao: este handler grava estoque em LOTE, o que aciona
    // `trg_low_stock_notify`. Nao ha supressao aqui de proposito — `low_stock`
    // tem dedup natural (so dispara na TRANSICAO acima->abaixo do limite), entao
    // o caso normal nao repete. O risco real e o catalogo inteiro ir a zero de
    // uma vez por resposta parcial da API, e contra isso vale o teto de 10/h no
    // proprio gatilho, mais o teto de canal.
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
      const existingProds = await lerTudo("produtos", "id, sku, nome, preco, ativo, imagem_url, estoque_total, estoque_reservado, created_at, b2bwave_id", adminClient);
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
      const allProds = await lerTudo("produtos", "id, sku, b2bwave_id", adminClient);
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
      // B2BWave: product.product_variants[] = { code, option_values }.
      //
      // ANTES ERA delete + insert por produto. Parecia idempotente e NÃO era: o
      // insert gera `id` NOVO (DEFAULT gen_random_uuid()), e
      // `pedido_itens.variante_id` referencia esta tabela com ON DELETE SET NULL
      // (20260802130000:29). Como este laço percorre o feed INTEIRO (não só o que
      // mudou) e o cron `b2bwave-cron-products` roda de hora em hora
      // (20260618200824:3), TODO `variante_id` de pedido virava NULL no minuto :10
      // da hora seguinte — o re-order voltava a perder tamanho/cor, e o carrinho
      // abandonado passava a bloquear o item como "sem estoque" com estoque cheio
      // (o Checkout relê a variante por id e não acha).
      //
      // Agora casa por (produto_id, codigo): ATUALIZA quem continua no feed (o `id`
      // fica estável, o vínculo do pedido sobrevive), INSERE quem é novo e apaga só
      // quem sumiu. Não precisa de índice único novo — o casamento é feito aqui.
      let variantRows = 0;
      for (const p of allProducts) {
        const variants = Array.isArray(p.product_variants) ? p.product_variants : [];
        if (variants.length === 0) continue;
        const localProdId = b2bIdToProdId.get(String(p.id));
        if (!localProdId) continue;

        const { data: existentes, error: exErr } = await adminClient
          .from("produto_variantes").select("id, codigo").eq("produto_id", localProdId);
        // Falha na leitura: NÃO mexe nas variantes deste produto. Apagar sem saber o
        // que existe é justamente o que causava a perda de vínculo.
        if (exErr) continue;

        const porCodigo = new Map<string, string>();
        for (const e of (existentes ?? [])) porCodigo.set(String(e.codigo), e.id as string);

        const vistos = new Set<string>();
        for (const v of variants) {
          // `.trim()`: o admin grava `codigo` com trim (ProductEdit). Sem o trim aqui, um
          // codigo com espaco nas pontas nao casaria com a linha ja salva pelo admin e
          // o par viraria insert + delete — de volta ao id novo.
          const codigo = String(v.code || v.sku || `${p.id}-var`).trim();
          // Código repetido no mesmo produto (o fallback `${p.id}-var` colide quando
          // falta `code` em mais de uma): trata a primeira e ignora as demais, em vez
          // de duplicar linha a cada sync.
          if (vistos.has(codigo)) continue;
          vistos.add(codigo);

          const campos = {
            valores_opcao: v.option_values ?? [],
            ativo: v.is_active !== false,
            quantidade: parseInt(v.quantity || "0") || 0,
            imagem_url: v.image_url || null,
          };
          const jaExiste = porCodigo.get(codigo);
          const { error } = jaExiste
            ? await adminClient.from("produto_variantes").update(campos).eq("id", jaExiste)
            : await adminClient.from("produto_variantes").insert({ produto_id: localProdId, codigo, ...campos });
          if (!error) variantRows++;
        }

        // Some do feed -> some daqui. Só estas perdem o vínculo, o que é correto:
        // a variante deixou de existir no B2BWave.
        const obsoletas = (existentes ?? [])
          .filter((e: any) => !vistos.has(String(e.codigo)))
          .map((e: any) => e.id);
        if (obsoletas.length > 0) {
          await adminClient.from("produto_variantes").delete().in("id", obsoletas);
        }
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
      // PAGINADO: truncar aqui fazia o sync reinserir cliente a cada ciclo.
      const existingCustomers = await lerTudo("clientes", "id, email, nome, empresa, telefone, status, tabela_preco_id, representante_id, endereco, cidade, cep, created_at, discount, parent_customer_id", adminClient);
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
      
      const data = await fetchOrdersPage(username, apiKey, pageNum);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, hasMore: false, message: `Page ${pageNum}: no data`, synced: 0, errors: 0 }), { headers: jsonHeaders });
      }
      
      const slice = data.slice(offset, offset + limit);
      if (slice.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, hasMore: data.length >= ORDERS_PER_PAGE, 
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
        const morePages = data.length >= ORDERS_PER_PAGE;
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
      // Suprime como os outros caminhos de lote. Eu tinha dado este como
      // protegido numa revisao anterior e NAO estava — a substituicao no codigo
      // nao pegou e eu nao conferi. Por isso o grep agora esta no cabecalho.
      await suprimirNotificacao(adminClient, true, 10);
      let created = 0, updated = 0, skipped = 0, errors = 0;
      try {
        const r = await processOrderSlice(adminClient, slice, true, false);
        created = r.created; updated = r.updated; skipped = r.skipped; errors = r.errors;
      } finally {
        await suprimirNotificacao(adminClient, false);
      }

      const moreInThisPage = offset + limit < data.length;
      const morePages = data.length >= ORDERS_PER_PAGE;

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
    // COMPARACAO SO DE LEITURA entre o B2BWave e o nosso banco.
    //
    // NAO ESCREVE NADA. Nao chama processOrderSlice, nao toca em pedidos, nao
    // dispara notificacao. Existe para responder uma pergunta antes de religar
    // qualquer coisa: "a sincronizacao esta identica?"
    //
    // Devolve, por diferenca, ate 20 exemplos — o suficiente para julgar sem
    // despejar 1.147 linhas na tela.
    if (action === "diff_orders") {
      const inicio = Date.now();
      const ORCAMENTO = body.budget_ms || 100_000;

      // 1) Tudo que existe no B2BWave.
      const naOrigem = new Map<number, any>();
      let pagina = 1;
      let paginasLidas = 0;
      let truncado = false;
      for (;;) {
        if (Date.now() - inicio > ORCAMENTO) { truncado = true; break; }
        const d = await fetchOrdersPage(username, apiKey, pagina);
        // Resposta NAO-ARRAY nao e "acabou a lista", e uma leitura que falhou.
        // Tratar como fim fazia o relatorio se declarar completo e transformar
        // todo pedido nao lido em "sobrando_aqui" — sem o aviso. Mesmo erro que
        // o truncamento, pela outra porta.
        if (!Array.isArray(d)) { truncado = true; break; }
        if (d.length === 0) break;
        for (const it of d) {
          const o = (it as any).order || it;
          const n = parseInt(o.id) || 0;
          if (n > 0) naOrigem.set(n, o);
        }
        paginasLidas++;
        if (d.length < ORDERS_PER_PAGE) break;
        pagina++;
      }

      // 2) Tudo que existe aqui (paginado — o PostgREST corta em 1000).
      const aqui = new Map<number, any>();
      let de = 0;
      for (;;) {
        const { data, error } = await adminClient.from("pedidos")
          .select("b2bwave_order_id, status, total, subtotal, quantidade_total, is_paid, data_origem, notificavel")
          .not("b2bwave_order_id", "is", null)
          .order("b2bwave_order_id", { ascending: true })
          .range(de, de + 999);
        if (error) throw new Error("falha ao ler pedidos: " + error.message);
        const p = data ?? [];
        for (const r of p) aqui.set(Number((r as any).b2bwave_order_id), r);
        if (p.length === 0) break;
        de += p.length;
      }

      // 3) Diferencas.
      const faltando: number[] = [];        // esta la, nao esta aqui
      const sobrando: number[] = [];        // esta aqui, nao esta la
      const statusDiferente: any[] = [];
      const valorDiferente: any[] = [];
      const pagamentoDiferente: any[] = [];
      const reparoPendente: any[] = [];
      const reparoReabre: any[] = [];
      const vaiEscreverEx: any[] = [];
      const escreveRecenteEx: any[] = [];
      // Mesma janela do `recenteDeVerdade` do upsertOrder.
      const TETO_DIAS_IMPORTADO_MS = 7 * 24 * 60 * 60 * 1000;
      // Contadores: 20 exemplos nao distinguem 3 de 1147, que e o numero que
      // decide se da para religar.
      let nFaltando = 0, nSobrando = 0, nStatus = 0, nValor = 0, nPagamento = 0, nReparo = 0;
      let nReabre = 0, nVaiEscrever = 0, nEscreveRecente = 0;

      // Mesma extracao de data do upsertOrder, para saber se o pedido vai cair
      // no `precisaReparar`.
      const submittedDe = (o: any): string | null => {
        const raw = o.submitted_at || o.created_at || "";
        if (!raw) return null;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString();
      };

      for (const [n, o] of naOrigem) {
        const local = aqui.get(n);
        if (!local) { nFaltando++; if (faltando.length < 20) faltando.push(n); continue; }

        const statusOrigem = statusMap[(o.status_order_name || o.status || "submitted").trim().toLowerCase()] || "submitted";
        if (statusOrigem !== local.status) { nStatus++; }
        if (statusOrigem !== local.status && statusDiferente.length < 20) {
          statusDiferente.push({ pedido: n, la: o.status_order_name ?? null, aqui: local.status, esperado: statusOrigem });
        }

        // MESMO CRITERIO DO `changed` do upsertOrder — senao o relatorio diria
        // "identico" enquanto o proximo ciclo do sync reescreveria tudo por
        // divergencia de subtotal ou quantidade. Comparar menos que o sync
        // decide e mentir por omissao, justo na pergunta que motiva esta acao.
        const { qty: itemsQty, sum: itemsSum } = buildOrderItems(o.order_products || [], new Map(), new Map());
        let subtotalOrigem = pickNum(o, ["total_before_vat", "subtotal", "net_total", "total"]);
        let totalOrigem = pickNum(o, ["gross_total", "total_after_vat", "total", "total_before_vat", "grand_total", "order_total", "amount"]);
        // Replica os fallbacks do upsertOrder. Sem eles, pedido cujo total vem da
        // soma dos itens ficava FORA da comparacao — escondia diferenca.
        if (subtotalOrigem <= 0) subtotalOrigem = itemsSum;
        if (totalOrigem <= 0) totalOrigem = itemsSum || subtotalOrigem;
        let qtdOrigem = parseInt(o.total_quantity || "0") || 0;
        if (qtdOrigem <= 0) qtdOrigem = itemsQty;

        // Arredonda para 2 casas nos DOIS lados, que e como a coluna
        // NUMERIC(12,2) guarda. Os fallbacks somam float (30.599999999999998) e
        // o banco gravou 30.60 — comparar cru acusaria diferenca em cima de
        // dinheiro identico, em massa, justo na populacao que o fallback
        // alcanca. (O `changed` do upsertOrder tem o mesmo defeito e por isso
        // reescreve esses pedidos a cada tick — anotado na fila.)
        const cent = (v: number) => Math.round(v * 100) / 100;
        const difTotal = cent(Number(local.total)) !== cent(totalOrigem);
        const difSub = cent(Number(local.subtotal)) !== cent(subtotalOrigem);
        const difQtd = (local.quantidade_total ?? 0) !== qtdOrigem;
        if (difTotal || difSub || difQtd) { nValor++; }
        if ((difTotal || difSub || difQtd) && valorDiferente.length < 20) {
          valorDiferente.push({
            pedido: n,
            total: difTotal ? { la: totalOrigem, aqui: Number(local.total) } : undefined,
            subtotal: difSub ? { la: subtotalOrigem, aqui: Number(local.subtotal) } : undefined,
            quantidade: difQtd ? { la: qtdOrigem, aqui: local.quantidade_total ?? 0 } : undefined,
          });
        }

        // `precisaReparar` do upsertOrder tambem faz UPDATE — e esse UPDATE pode
        // religar `notificavel`. Sem olhar isto, o relatorio diria "identico"
        // enquanto o proximo ciclo reescreve e reabre a marca que disparou os
        // 1508 SMS. Eu tinha selecionado as colunas e nao olhado.
        const temDataOrigem = local.data_origem !== null && local.data_origem !== undefined;
        const dataOrigem = submittedDe(o);
        const vaiSerReparado = dataOrigem !== null && !temDataOrigem;
        if (vaiSerReparado) { nReparo++; }

        // SO o reparo que REABRE `notificavel` trava o `identico`.
        //
        // Pedido pre-2025 nunca sera reparado pelo sync de rotina (`skipPre2025`
        // retorna antes), entao ele ficaria em `reparo_pendente` PARA SEMPRE — e
        // um portao que nunca fica verde e um portao que todo mundo aprende a
        // ignorar. Alem disso pre-2025 nunca e `recenteDeVerdade`, entao nao liga
        // `notificavel`: e ruido em cima do unico numero que importa.
        const reabre = vaiSerReparado
          && (Date.now() - new Date(dataOrigem as string).getTime()) < TETO_DIAS_IMPORTADO_MS;
        if (reabre) {
          nReabre++;
          if (reparoReabre.length < 20) {
            // NOTA: este contador cobre so o reparo. `notificavel: true` tambem
            // e gravado em QUALQUER update de pedido recente, mesmo com
            // `data_origem` ja presente — esse caso cai em
            // `proximo_tick_escreve_em_pedido_recente`, que e o numero a olhar.
            reparoReabre.push({ pedido: n, data_origem: dataOrigem, notificavel_hoje: local.notificavel });
          }
        }
        if (vaiSerReparado && reparoPendente.length < 20) {
          reparoPendente.push({ pedido: n, data: dataOrigem, notificavel_hoje: local.notificavel });
        }

        // ESPELHA o `changed` do upsertOrder, com igualdade CRUA (sem arredondar).
        // O `cent()` abaixo e para dinheiro de verdade; este e para responder "o
        // proximo tick escreve?". Com ruido de float, o sync reescreve e — em
        // pedido de menos de 7 dias — RELIGA `notificavel`, apagando o
        // kill-switch do admin. Arredondar aqui esconderia exatamente isso.
        const vaiEscrever = statusOrigem !== local.status
          || Number(local.total) !== totalOrigem
          || Number(local.subtotal) !== subtotalOrigem
          || (local.quantidade_total ?? 0) !== qtdOrigem;
        if (vaiEscrever) {
          nVaiEscrever++;
          if (vaiEscreverEx.length < 20) {
            vaiEscreverEx.push({ pedido: n, total: { la: totalOrigem, aqui: Number(local.total) }, subtotal: { la: subtotalOrigem, aqui: Number(local.subtotal) } });
          }
        }

        // O QUE REALMENTE IMPORTA: escrever num pedido velho e inofensivo (nao
        // mexe em `notificavel` e ainda esbarra na trava de idade). O risco e
        // escrever num pedido RECENTE, porque ai o `upsertOrder` grava
        // `notificavel: true` e apaga o kill-switch do admin.
        //
        // `nVaiEscrever` sozinho travaria o portao para sempre: o proprio
        // `changed` compara float cru, entao os 1.147 aparecem eternamente. Um
        // portao que nunca fica verde e um portao que todo mundo ignora — foi o
        // argumento que me fez tirar `nReparo`, e eu tinha reconstruido o mesmo
        // problema aqui.
        const recente = dataOrigem !== null
          && (Date.now() - new Date(dataOrigem).getTime()) < TETO_DIAS_IMPORTADO_MS;
        if (vaiEscrever && recente) {
          nEscreveRecente++;
          if (escreveRecenteEx.length < 20) {
            escreveRecenteEx.push({ pedido: n, data_origem: dataOrigem, notificavel_hoje: local.notificavel, status: { la: statusOrigem, aqui: local.status } });
          }
        }

        const pagoOrigem = pickPago(o);
        if (pagoOrigem !== undefined && pagoOrigem !== local.is_paid) { nPagamento++; }
        if (pagoOrigem !== undefined && pagoOrigem !== local.is_paid && pagamentoDiferente.length < 20) {
          // NOTA: `is_paid` NAO entra no `changed` do sync, entao uma diferenca
          // aqui nao se corrige sozinha no proximo ciclo.
          pagamentoDiferente.push({ pedido: n, la: pagoOrigem, aqui: local.is_paid, obs: "o sync nao corrige isto sozinho" });
        }
      }
      for (const n of aqui.keys()) {
        if (!naOrigem.has(n)) { nSobrando++; if (sobrando.length < 20) sobrando.push(n); }
      }

      return new Response(JSON.stringify({
        success: true,
        SO_LEITURA: "nenhum dado foi alterado",
        truncado,
        paginas_lidas: paginasLidas,
        no_b2bwave: naOrigem.size,
        aqui: aqui.size,
        // `identico` EXIGE leitura completa: com `truncado`, "sobrando_aqui" e
        // formado por pedidos legitimos que a origem so nao terminou de listar.
        // Chamar isso de identico (ou de lixo) seria conclusao errada.
        // Nao exige `nVaiEscrever === 0` nem `nReparo === 0`: os dois ficam
        // eternamente diferentes de zero por ruido de float e por pedido
        // pre-2025. Exige o que muda comportamento:
        //
        //   nEscreveRecente — o tick escreve num pedido recente e, ao escrever,
        //                     grava `notificavel: true`;
        //   nReabre         — o REPARO (pedido recente sem `data_origem` local)
        //                     tambem grava `notificavel: true`, e nesse caso
        //                     status/total/subtotal/qtd podem estar TODOS
        //                     batendo, entao `nEscreveRecente` seria 0 e o
        //                     portao ficaria verde. Este e o estado do sistema
        //                     AGORA, antes do primeiro tick — exatamente quando
        //                     este relatorio e consultado para decidir religar.
        identico: !truncado && nFaltando === 0 && nSobrando === 0
          && nStatus === 0 && nValor === 0 && nPagamento === 0
          && nEscreveRecente === 0 && nReabre === 0,
        // Os TOTAIS sao o que decide se da para religar. As listas abaixo sao so
        // 20 exemplos cada.
        totais: {
          faltando_aqui: nFaltando,
          sobrando_aqui: nSobrando,
          status_diferente: nStatus,
          valor_diferente: nValor,
          pagamento_diferente: nPagamento,
          reparo_pendente: nReparo,
          reparo_reabre_notificavel: nReabre,
          proximo_tick_escreve: nVaiEscrever,
          proximo_tick_escreve_em_pedido_recente: nEscreveRecente,
        },
        aviso: truncado
          ? "LEITURA INCOMPLETA — a lista da origem nao terminou. `sobrando_aqui` aqui NAO significa lixo: sao pedidos que a origem ainda nao listou. Rode de novo com budget_ms maior."
          : null,
        diferencas: {
          faltando_aqui: faltando,
          sobrando_aqui: sobrando,
          status_diferente: statusDiferente,
          valor_diferente: valorDiferente,
          pagamento_diferente: pagamentoDiferente,
          reparo_pendente: reparoPendente,
          reparo_reabre_notificavel: reparoReabre,
          proximo_tick_escreve: vaiEscreverEx,
          proximo_tick_escreve_em_pedido_recente: escreveRecenteEx,
        },
        segundos: Math.round((Date.now() - inicio) / 1000),
      }, null, 2), { headers: jsonHeaders });
    }

    // ========================================================================
    // COMPARACAO DO CATALOGO — produtos, variantes e clientes.
    //
    // Irma do `diff_orders`, que so cobria pedidos. O dono pediu prova de que
    // "TUDO" esta sincronizado antes de religar; o sync escreve 13 tabelas e so
    // uma tinha conferencia.
    //
    // SO LEITURA. Nenhum insert/update/delete. Se um dia alguem acrescentar
    // escrita aqui, quebra a unica garantia que faz este endpoint seguro de
    // rodar a qualquer hora.
    //
    // O criterio de comparacao e o MESMO do upsert de cada entidade (o valor
    // MAPEADO, nao o cru). Comparar o cru diria "diferente" para todo produto,
    // porque `is_active` (bool) nunca e igual a `ativo` depois do `!== false`.
    // ========================================================================
    if (action === "diff_catalog") {
      const inicio = Date.now();
      const LIMITE_EX = 20;
      let truncado = false;
      // QUAL leitura falhou. So `leitura_truncada: true` nao diz se e para
      // tentar de novo (rede) ou investigar (endpoint mudou) — e o relatorio
      // vira um beco sem saida.
      const truncouEm: string[] = [];

      // A leitura local pagina pelo `lerTudo` que ja existe neste arquivo — o
      // PostgREST corta em 1000 SEM erro, e foi esse corte silencioso que
      // produziu o incidente dos 1.508 SMS. Eu tinha escrito uma copia identica
      // aqui; duas copias da mesma regra divergem, e a que ninguem le e a que
      // fica errada.

      const num = (x: any) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
      // Centavos: `0.1 + 0.2 !== 0.3` em ponto flutuante, e um relatorio que
      // acusa mil produtos por residuo binario nao e lido por ninguem.
      const mesmoDinheiro = (a: any, b: any) => Math.round(num(a) * 100) === Math.round(num(b) * 100);

      // ---------- PRODUTOS ----------
      const prodOrigem = new Map<number, any>();
      let prodTrunc = false;
      try {
        // `fetchAllPages`, o MESMO que o `sync_products` usa. Eu tinha escrito
        // `fetchAllPaginated` (o de `?paginated=1&per_page=500`): endpoint que
        // pagina de outro jeito devolve outra lista, e o relatorio compararia
        // contra um universo diferente do que o sync escreve.
        const lista = await fetchAllPages("products.json", username, apiKey);
        // Resposta nao-array e leitura FALHA, nao lista vazia. Tratar como vazia
        // faria o relatorio declarar todo produto daqui "sobrando".
        if (!Array.isArray(lista)) {
          prodTrunc = true;
        } else {
          for (const it of lista) {
            const o = (it as any).product || it;
            const n = parseInt(o.id) || 0;
            if (n > 0) prodOrigem.set(n, o);
          }
        }
      } catch (_e) { prodTrunc = true; }
      if (prodTrunc) { truncado = true; truncouEm.push("products.json"); }

      // PRECO: `products.json` muitas vezes NAO traz preco algum — a fonte real
      // e `product_prices.json` (um registro por produto x tabela), resolvido
      // pela tabela DEFAULT. Eu tinha comparado com `o.wholesale_price`, campo
      // que na maioria dos produtos nem vem: o relatorio acusaria quase todos e
      // ninguem leria o resto. Este bloco replica a cascata do `sync_products`.
      let precoTrunc = false;
      const precoPorProduto = new Map<number, Map<number, number>>();
      let tabelaPadraoId: number | null = null;
      // Nome de cada tabela da origem: e por NOME (minusculo) que o sync casa
      // com a tabela local, entao o nome tem que vir junto.
      const nomeTabelaOrigem = new Map<number, string>();
      try {
        const pls = await fetchAllPages("price_lists.json", username, apiKey);
        if (!Array.isArray(pls)) throw new Error("price_lists nao-array");
        for (const pl of pls) {
          nomeTabelaOrigem.set(Number((pl as any).id), String((pl as any).name ?? ""));
          if ((pl as any).is_default === true) tabelaPadraoId = Number((pl as any).id);
        }
        const pps = await fetchAllPaginated("product_prices.json", username, apiKey);
        if (!Array.isArray(pps)) throw new Error("product_prices nao-array");
        for (const pp of pps) {
          const pid = Number((pp as any).product_id), plid = Number((pp as any).pricelist_id);
          const val = parseFloat((pp as any).price ?? "0") || 0;
          if (!pid || !plid) continue;
          if (!precoPorProduto.has(pid)) precoPorProduto.set(pid, new Map());
          precoPorProduto.get(pid)!.set(plid, val);
        }
      } catch (_e) { precoTrunc = true; }
      if (precoTrunc) { truncado = true; truncouEm.push("price_lists.json / product_prices.json (preco nao comparado)"); }

      // A MESMA cascata do `sync_products`: tabela padrao -> primeira tabela com
      // valor > 0 -> `p.price`/`wholesale_price`/`base_price` -> MSRP.
      const precoDaOrigem = (o: any): number => {
        const m = precoPorProduto.get(Number(o.id));
        let base = 0;
        if (m) {
          if (tabelaPadraoId != null && m.has(tabelaPadraoId)) base = m.get(tabelaPadraoId)!;
          else { const primeiro = [...m.values()].find(v => v > 0); if (primeiro) base = primeiro; }
        }
        const atacado = base || parseFloat(o.price || o.wholesale_price || o.base_price || "0") || 0;
        const msrp = parseFloat(o.price_msrp || o.retail_price || o.price_retail || "0") || 0;
        return atacado || msrp;
      };

      const prodAqui = new Map<number, any>();
      for (const r of await lerTudo(
        "produtos", "id, b2bwave_id, sku, nome, preco, ativo, estoque_total", adminClient)) {
        if ((r as any).b2bwave_id != null) prodAqui.set(Number((r as any).b2bwave_id), r);
      }

      const prodFaltando: any[] = [];
      const prodSobrando: any[] = [];
      const prodPreco: any[] = [];
      const prodAtivo: any[] = [];
      const prodEstoque: any[] = [];
      let nPrecoDif = 0, nAtivoDif = 0, nEstoqueDif = 0, nProdFalta = 0, nProdSobra = 0;

      if (!prodTrunc) {
        for (const [n, o] of prodOrigem) {
          const local = prodAqui.get(n);
          if (!local) {
            nProdFalta++;
            if (prodFaltando.length < LIMITE_EX) prodFaltando.push({ b2bwave_id: n, sku: o.sku, nome: o.name });
            continue;
          }
          const precoLa = precoDaOrigem(o);
          // Preco so e comparavel se a leitura das tabelas de preco deu certo.
          // Sem esta guarda, falha em `product_prices.json` viraria "todo produto
          // esta com preco errado" — panico em cima de uma leitura que falhou.
          if (!precoTrunc && !mesmoDinheiro(precoLa, local.preco)) {
            nPrecoDif++;
            if (prodPreco.length < LIMITE_EX) {
              prodPreco.push({ b2bwave_id: n, sku: local.sku, la: precoLa, aqui: num(local.preco) });
            }
          }
          const ativoLa = o.is_active !== false;
          if (ativoLa !== (local.ativo === true)) {
            nAtivoDif++;
            if (prodAtivo.length < LIMITE_EX) {
              prodAtivo.push({ b2bwave_id: n, sku: local.sku, la: ativoLa, aqui: local.ativo });
            }
          }
          // ESTOQUE fica SEPARADO de proposito. Enquanto a decisao 2.1 (quem
          // manda no estoque durante a transicao) nao for tomada, TODO check-in
          // de producao feito aqui aparece como divergencia — e legitimo, nao e
          // falha do sync. Misturado com preco e ativo, afogaria o sinal real.
          const estoqueLa = parseInt(o.quantity ?? o.stock ?? "0") || 0;
          if (estoqueLa !== (parseInt(local.estoque_total) || 0)) {
            nEstoqueDif++;
            if (prodEstoque.length < LIMITE_EX) {
              prodEstoque.push({ b2bwave_id: n, sku: local.sku, la: estoqueLa, aqui: local.estoque_total });
            }
          }
        }
        for (const [n, r] of prodAqui) {
          if (!prodOrigem.has(n)) {
            nProdSobra++;
            if (prodSobrando.length < LIMITE_EX) prodSobrando.push({ b2bwave_id: n, sku: (r as any).sku });
          }
        }
      }

      // ---------- VARIANTES ----------
      // Chave: (produto local, codigo) com trim — o mesmo par que o upsert usa.
      // Sem o trim, codigo com espaco nas pontas viraria "falta la" + "sobra aqui".
      const varAqui = new Map<string, any>();
      for (const r of await lerTudo(
        "produto_variantes", "id, produto_id, codigo, quantidade, ativo", adminClient)) {
        varAqui.set((r as any).produto_id + "|" + String((r as any).codigo ?? "").trim(), r);
      }
      // Produtos locais que VIERAM no feed — so esses podem julgar "sobra".
      const locaisNoFeed = new Set<string>();
      for (const [n, r] of prodAqui) {
        if (prodOrigem.has(n)) locaisNoFeed.add(String((r as any).id));
      }
      const idLocalPorB2b = new Map<number, string>();
      for (const [n, r] of prodAqui) idLocalPorB2b.set(n, String((r as any).id));

      const varFaltando: any[] = [];
      const varSobrando: any[] = [];
      const varQtd: any[] = [];
      let nVarQtd = 0, nVarFalta = 0, nVarSobra = 0;
      const vistasNoFeed = new Set<string>();

      if (!prodTrunc) {
        for (const [n, o] of prodOrigem) {
          const idLocal = idLocalPorB2b.get(n);
          if (!idLocal) continue;   // produto ausente ja foi contado acima
          // SO `product_variants` — e o unico campo que o `sync_products` le
          // (`Array.isArray(p.product_variants) ? ... : []`). Eu tinha posto
          // `o.variants` na frente; se o feed trouxer os dois, o relatorio
          // compararia contra um campo que o sync ignora e acusaria diferenca
          // em variante que esta perfeita.
          const vs = (o as any).product_variants;
          if (!Array.isArray(vs)) continue;
          for (const v of vs) {
            const codigo = String(v.code || v.sku || (o.id + "-var")).trim();
            const chave = idLocal + "|" + codigo;
            vistasNoFeed.add(chave);
            const local = varAqui.get(chave);
            if (!local) {
              nVarFalta++;
              if (varFaltando.length < LIMITE_EX) varFaltando.push({ produto_b2bwave: n, codigo });
              continue;
            }
            const qLa = parseInt(v.quantity || "0") || 0;
            if (qLa !== (parseInt((local as any).quantidade) || 0)) {
              nVarQtd++;
              if (varQtd.length < LIMITE_EX) {
                varQtd.push({ produto_b2bwave: n, codigo, la: qLa, aqui: (local as any).quantidade });
              }
            }
          }
        }
        // Sobra aqui: so conta variante de produto QUE VEIO no feed. Variante de
        // produto ausente ja esta contada como produto faltando; contar de novo
        // aqui inflaria o numero e mandaria procurar no lugar errado.
        for (const [chave, r] of varAqui) {
          const idProd = chave.split("|")[0];
          if (locaisNoFeed.has(idProd) && !vistasNoFeed.has(chave)) {
            nVarSobra++;
            if (varSobrando.length < LIMITE_EX) {
              varSobrando.push({ produto_local: idProd, codigo: (r as any).codigo });
            }
          }
        }
      }

      // ---------- REGUA DE PRECO (tabela_preco_itens) ----------
      // A tabela mais cara que faltava: divergencia aqui sai dinheiro em TODO
      // pedido futuro, nao so no historico.
      //
      // O sync casa a tabela da origem com a local pelo NOME em minusculo, e
      // `continue` quando nao acha — em SILENCIO. Uma regua inteira pode nunca
      // estar sendo gravada sem nada reclamar. E o primeiro numero deste bloco.
      const tabelasAqui = new Map<string, string>();   // nome minusculo -> id local
      for (const r of await lerTudo("tabelas_preco", "id, nome", adminClient)) {
        tabelasAqui.set(String((r as any).nome ?? "").toLowerCase(), String((r as any).id));
      }
      const tabelasSemPar: string[] = [];
      if (!precoTrunc) {
        for (const [, nome] of nomeTabelaOrigem) {
          if (!tabelasAqui.has(nome.toLowerCase())) tabelasSemPar.push(nome);
        }
      }

      const reguaAqui = new Map<string, number>();     // "produto|tabela" -> preco
      for (const r of await lerTudo(
        "tabela_preco_itens", "produto_id, tabela_preco_id, preco", adminClient)) {
        reguaAqui.set((r as any).produto_id + "|" + (r as any).tabela_preco_id, num((r as any).preco));
      }

      const reguaFaltando: any[] = [];
      const reguaPreco: any[] = [];
      const reguaObsoleta: any[] = [];
      let nReguaFalta = 0, nReguaPreco = 0, nReguaPares = 0, nReguaObsoleta = 0;
      // Pares (produto, tabela) que a ORIGEM tem — para achar o inverso depois.
      const paresDaOrigem = new Set<string>();

      if (!prodTrunc && !precoTrunc) {
        for (const [prodB2b, porTabela] of precoPorProduto) {
          const idLocalProd = idLocalPorB2b.get(prodB2b);
          if (!idLocalProd) continue;              // produto ausente ja foi contado
          for (const [tabB2b, precoLa] of porTabela) {
            const nome = nomeTabelaOrigem.get(tabB2b);
            if (nome == null) continue;            // tabela desconhecida na origem
            const idLocalTab = tabelasAqui.get(nome.toLowerCase());
            if (!idLocalTab) continue;             // ja contado em `tabelasSemPar`
            nReguaPares++;
            const chave = idLocalProd + "|" + idLocalTab;
            paresDaOrigem.add(chave);
            if (!reguaAqui.has(chave)) {
              nReguaFalta++;
              if (reguaFaltando.length < LIMITE_EX) {
                reguaFaltando.push({ produto_b2bwave: prodB2b, tabela: nome, preco_la: precoLa });
              }
              continue;
            }
            if (!mesmoDinheiro(precoLa, reguaAqui.get(chave))) {
              nReguaPreco++;
              if (reguaPreco.length < LIMITE_EX) {
                reguaPreco.push({ produto_b2bwave: prodB2b, tabela: nome,
                                  la: precoLa, aqui: reguaAqui.get(chave) });
              }
            }
          }
        }
      }

      // PRECO OBSOLETO. O sync so faz `upsert` em `tabela_preco_itens` — nunca
      // `delete`. Preco TIRADO de uma regua no B2BWave continua valendo aqui
      // para sempre, e o cliente segue comprando pelo valor antigo. Isto nao e
      // so lacuna do relatorio: e dinheiro saindo errado, em silencio.
      //
      // So julga linha cujo produto VEIO no feed — sem o feed daquele produto
      // nao da para saber se o preco sumiu ou se a leitura e que nao o trouxe.
      if (!prodTrunc && !precoTrunc) {
        const b2bPorLocalProd = new Map<string, number>();
        for (const [b2b, loc] of idLocalPorB2b) b2bPorLocalProd.set(loc, b2b);
        for (const chave of reguaAqui.keys()) {
          const [idProd] = chave.split("|");
          const b2b = b2bPorLocalProd.get(idProd);
          if (b2b == null || !prodOrigem.has(b2b)) continue;
          if (paresDaOrigem.has(chave)) continue;
          nReguaObsoleta++;
          if (reguaObsoleta.length < LIMITE_EX) {
            reguaObsoleta.push({ produto_b2bwave: b2b, preco_aqui: reguaAqui.get(chave) });
          }
        }
      }

      // ---------- CLIENTES ----------
      // Correlacao por E-MAIL minusculo — e a chave que o upsert usa
      // (`existingMap.get(email.toLowerCase())`), nao `b2bwave_id`.
      const cliOrigem = new Map<string, any>();
      let cliTrunc = false;
      try {
        const lista = await fetchAllPages("customers.json", username, apiKey);
        if (!Array.isArray(lista)) {
          cliTrunc = true;
        } else {
          for (const it of lista) {
            const c = (it as any).customer || it;
            const em = String(c.email ?? "").trim().toLowerCase();
            if (em) cliOrigem.set(em, c);
          }
        }
      } catch (_e) { cliTrunc = true; }
      if (cliTrunc) { truncado = true; truncouEm.push("customers.json"); }

      const cliAqui = new Map<string, any>();
      for (const r of await lerTudo(
        "clientes", "id, email, nome, status, disable_ordering", adminClient)) {
        const em = String((r as any).email ?? "").trim().toLowerCase();
        if (em) cliAqui.set(em, r);
      }

      const cliFaltando: any[] = [];
      const cliSobrando: any[] = [];
      const cliStatus: any[] = [];
      const cliBloqueio: any[] = [];
      let nCliStatus = 0, nCliBloqueio = 0, nCliFalta = 0, nCliSobra = 0;

      if (!cliTrunc) {
        for (const [em, c] of cliOrigem) {
          const local = cliAqui.get(em);
          if (!local) {
            nCliFalta++;
            if (cliFaltando.length < LIMITE_EX) cliFaltando.push({ email: em, empresa: c.company_name });
            continue;
          }
          const statusLa = c.approved === false ? "pendente" : (c.is_active === false ? "inativo" : "ativo");
          if (statusLa !== String((local as any).status ?? "")) {
            nCliStatus++;
            if (cliStatus.length < LIMITE_EX) {
              cliStatus.push({ email: em, la: statusLa, aqui: (local as any).status });
            }
          }
          const bloqLa = c.disable_ordering === true;
          if (bloqLa !== ((local as any).disable_ordering === true)) {
            nCliBloqueio++;
            if (cliBloqueio.length < LIMITE_EX) {
              cliBloqueio.push({ email: em, la: bloqLa, aqui: (local as any).disable_ordering });
            }
          }
        }
        // "Sobrando" aqui NAO e defeito: cliente cadastrado direto no PermShield
        // (o cadastro publico) nunca existiu no B2BWave. O numero e informativo.
        for (const [em, r] of cliAqui) {
          if (!cliOrigem.has(em)) {
            nCliSobra++;
            if (cliSobrando.length < LIMITE_EX) cliSobrando.push({ email: em, nome: (r as any).nome });
          }
        }
      }

      const limpo = !truncado
        && nProdFalta === 0 && nProdSobra === 0 && nPrecoDif === 0 && nAtivoDif === 0
        && nVarFalta === 0 && nVarSobra === 0 && nVarQtd === 0
        && tabelasSemPar.length === 0 && nReguaFalta === 0 && nReguaPreco === 0
        && nReguaObsoleta === 0
        && nCliFalta === 0 && nCliStatus === 0 && nCliBloqueio === 0;

      return new Response(JSON.stringify({
        success: true,
        // Se a leitura truncou, NADA aqui prova identidade. O campo vem primeiro
        // para nao ser lido depois da conclusao.
        leitura_truncada: truncado,
        truncou_em: truncouEm,
        veredito: truncado
          ? "INCONCLUSIVO — a leitura da origem falhou ou truncou; nao use este relatorio para decidir"
          : (limpo ? "IDENTICO nos campos comparados" : "DIVERGENTE — veja os contadores"),
        produtos: {
          na_origem: prodOrigem.size, aqui: prodAqui.size,
          faltando_aqui: nProdFalta, sobrando_aqui: nProdSobra,
          preco_diferente: nPrecoDif, ativo_diferente: nAtivoDif,
        },
        variantes: {
          aqui: varAqui.size,
          faltando_aqui: nVarFalta, sobrando_aqui: nVarSobra, quantidade_diferente: nVarQtd,
        },
        regua_de_preco: {
          // Regua da origem que nao tem tabela de mesmo nome aqui: o sync PULA
          // essas em silencio. Se vier nome nesta lista, nenhum preco daquela
          // regua esta sendo gravado.
          tabelas_sem_par_aqui: tabelasSemPar,
          pares_comparados: nReguaPares,
          aqui: reguaAqui.size,
          faltando_aqui: nReguaFalta,
          preco_diferente: nReguaPreco,
          obsoleto_aqui: nReguaObsoleta,
          nota_obsoleto: "o sync nunca APAGA de tabela_preco_itens: preco tirado da regua no B2BWave continua valendo aqui. Se este numero nao for zero, o cliente esta comprando por valor que a origem ja removeu",
        },
        clientes: {
          na_origem: cliOrigem.size, aqui: cliAqui.size,
          faltando_aqui: nCliFalta, sobrando_aqui: nCliSobra,
          status_diferente: nCliStatus, bloqueio_diferente: nCliBloqueio,
        },
        estoque_de_produto: {
          diferente: nEstoqueDif,
          nota: "NAO conta como divergencia do sync: enquanto a decisao 2.1 nao for tomada, todo check-in de producao feito aqui aparece como diferenca legitima",
          exemplos: prodEstoque,
        },
        exemplos: {
          produto_faltando: prodFaltando, produto_sobrando: prodSobrando,
          produto_preco: prodPreco, produto_ativo: prodAtivo,
          variante_faltando: varFaltando, variante_sobrando: varSobrando,
          variante_quantidade: varQtd,
          regua_faltando: reguaFaltando, regua_preco: reguaPreco,
          regua_obsoleta: reguaObsoleta,
          cliente_faltando: cliFaltando, cliente_sobrando: cliSobrando,
          cliente_status: cliStatus, cliente_bloqueio: cliBloqueio,
        },
        // O QUE ESTE RELATORIO NAO OLHA. Vai no corpo da resposta de proposito:
        // "diff_catalog: IDENTICO" lido sozinho vira "tudo esta sincronizado", que
        // e a mesma armadilha de tratar leitura truncada como igualdade. O sync
        // escreve 13 tabelas; entre esta e a `diff_orders`, quatro ficam de fora.
        nao_comparado: {
          tabelas: ["categorias", "brands", "representantes",
                    "privacy_groups", "company_activities", "pedido_itens"],
          nota: "sao metadados de catalogo e as linhas do historico de pedidos; nenhuma decide preco de pedido novo. `pedido_itens` e a que mais pesa das que sobraram: erro ali sai no PDF do pedido antigo",
        },
        segundos: Math.round((Date.now() - inicio) / 1000),
      }, null, 2), { headers: jsonHeaders });
    }

    // Mede como a API de pedidos pagina. O backfill voltou "done" com 1 pagina de
    // 9 pedidos, com 1.147 no banco — ou seja, `orders.json?page=N` sozinho NAO
    // varre o historico. Outros endpoints deste mesmo sync usam
    // `paginated=1&per_page=500`. Isto compara as duas formas em vez de adivinhar.
    if (action === "debug_orders_paging") {
      const medir = async (rotulo: string, ep: string, pagina: number) => {
        try {
          const d = await fetchPage(ep, username, apiKey, pagina);
          const rows = Array.isArray(d) ? d : ((d as any)?.data ?? null);
          return {
            forma: rotulo, page: pagina,
            tipo: Array.isArray(d) ? "array" : typeof d,
            qtd: Array.isArray(rows) ? rows.length : null,
            primeiro_id: Array.isArray(rows) && rows[0] ? ((rows[0] as any).order || rows[0]).id : null,
            ultimo_id: Array.isArray(rows) && rows.length ? ((rows[rows.length - 1] as any).order || rows[rows.length - 1]).id : null,
            chaves_do_envelope: Array.isArray(d) ? null : Object.keys((d as any) ?? {}),
          };
        } catch (e) {
          return { forma: rotulo, page: pagina, erro: String((e as any)?.message ?? e).slice(0, 200) };
        }
      };
      return new Response(JSON.stringify({
        success: true,
        medidas: [
          await medir("simples", "orders.json", 1),
          await medir("simples", "orders.json", 2),
          await medir("paginated", "orders.json?paginated=1&per_page=500", 1),
          await medir("paginated", "orders.json?paginated=1&per_page=500", 2),
        ],
      }, null, 2), { headers: jsonHeaders });
    }

    // Backfill do HISTORICO INTEIRO, com cursor proprio e orcamento de tempo.
    //
    // O `sync_orders_all` processa 50 pedidos por chamada e devolve nextPage/
    // nextOffset para quem chamou continuar o laco — util para um script, inutil
    // para rodar na mao: com 1.147 pedidos daria ~23 chamadas. E o `cron_orders`
    // pula tudo que e anterior a 2025 (`skipPre2025 = true`), entao nao serve
    // para recuperar historico.
    //
    // Este varre pagina a pagina, SEM pular por data, ate acabar ou o orcamento
    // de tempo estourar. Guarda a posicao em `sync_state` (chave propria, para
    // nao mexer no cursor do cron), entao basta chamar de novo ate `done: true`.
    if (action === "sync_orders_backfill") {
      const CHAVE = "orders_backfill_cursor";
      const ORCAMENTO_MS = body.budget_ms || 100_000;   // folga sob o limite da Edge Function
      const inicio = Date.now();

      // Reconciliacao em massa: NENHUMA notificacao de status. Foi exatamente
      // este caminho que mandou 1281 SMS em 25/ago.
      await suprimirNotificacao(adminClient, true, 30);
      try {

      const { data: est } = await adminClient.from("sync_state").select("value").eq("key", CHAVE).maybeSingle();
      let page = Number((est?.value as any)?.page) || 1;

      let created = 0, updated = 0, skipped = 0, errors = 0, paginas = 0;
      let done = false;

      while (Date.now() - inicio < ORCAMENTO_MS) {
        let data: any;
        try {
          data = await fetchOrdersPage(username, apiKey, page);
        } catch (_e) {
          errors++;
          break;   // retoma do mesmo cursor na proxima chamada
        }
        if (!Array.isArray(data) || data.length === 0) { done = true; break; }

        // `skipPre2025 = false`: e backfill, o historico antigo E o alvo.
        // `notify = false`: reprocessar 1.147 pedidos nao pode disparar notificacao.
        const r = await processOrderSlice(adminClient, data, false, false);
        created += r.created; updated += r.updated; skipped += r.skipped; errors += r.errors;
        paginas++;

        const ultima = data.length < ORDERS_PER_PAGE;
        page++;
        await adminClient.from("sync_state").upsert({ key: CHAVE, value: { page } }, { onConflict: "key" });
        if (ultima) { done = true; break; }
      }

      if (done) {
        // Zera o cursor para que uma proxima chamada recomece do inicio.
        await adminClient.from("sync_state").upsert({ key: CHAVE, value: { page: 1 } }, { onConflict: "key" });
      }
      await logRun(adminClient, "sync_orders_backfill", { created, updated, skipped, errors });
      return new Response(JSON.stringify({
        success: true, done, paginas, proxima_pagina: done ? 1 : page,
        created, updated, skipped, errors,
        segundos: Math.round((Date.now() - inicio) / 1000),
      }), { headers: jsonHeaders });

      } finally {
        // `finally`: libera mesmo se o laco lancar. Se o processo morrer antes
        // disto, a validade de 30 min desliga sozinha.
        await suprimirNotificacao(adminClient, false);
      }
    }

    if (action === "sync_orders_all") {
      const pageNum = body.page || 1;
      const offset = body.offset || 0;
      const limit = 50;
      
      const data = await fetchOrdersPage(username, apiKey, pageNum);
      if (!Array.isArray(data) || data.length === 0) {
        return new Response(JSON.stringify({ success: true, hasMore: false, message: `Page ${pageNum}: no data`, synced: 0, errors: 0 }), { headers: jsonHeaders });
      }
      
      const slice = data.slice(offset, offset + limit);
      if (slice.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, hasMore: data.length >= ORDERS_PER_PAGE, 
          nextPage: pageNum + 1, nextOffset: 0,
          synced: 0, message: `Page ${pageNum} offset ${offset}: done, move to next page`
        }), { headers: jsonHeaders });
      }

      // Upsert (cria novos, ATUALIZA existentes). Histórico completo (sem filtro de data).
      // Acao MANUAL de historico completo: suprime notificacao de status, como o
      // backfill. Quem varre historico nao esta comunicando novidade a ninguem.
      await suprimirNotificacao(adminClient, true, 10);
      let created = 0, updated = 0, skipped = 0, errors = 0;
      try {
        const r = await processOrderSlice(adminClient, slice, false, false);
        created = r.created; updated = r.updated; skipped = r.skipped; errors = r.errors;
      } finally {
        await suprimirNotificacao(adminClient, false);
      }

      const moreInThisPage = offset + limit < data.length;
      const morePages = data.length >= ORDERS_PER_PAGE;

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
      // Suprime a notificacao de STATUS durante o tick inteiro: sao ate 6
      // paginas x 500 pedidos, e reconciliar status em lote foi exatamente o que
      // disparou 1281 SMS. O aviso de PEDIDO NOVO (`new_order`) continua saindo,
      // porque so acontece em pedido criado agora e e a notificacao legitima —
      // e o teto de canal limita o estrago se algo der errado.
      // DENTRO do try: `suprimirNotificacao(true)` LANCA de proposito quando a
      // RPC nao existe — que e exatamente o cenario "SQL nao aplicado" que o
      // catch abaixo diz cobrir. Fora do try, esse caso continuava sumindo do
      // `sync_log`. Desligar que falha nao lanca, entao o `finally` e seguro
      // mesmo se nunca chegou a ligar.
      //
      // Contadores declarados FORA do try: no catch eles precisam existir, senao
      // o log de erro grava 0/0/0 mesmo com 5 paginas ja processadas.
      let created = 0, updated = 0, skipped = 0, errors = 0, reachedEnd = false;
      try {
      await suprimirNotificacao(adminClient, true, 20);
      const PAGES_PER_TICK = body.pages || 6;
      let page = await getOrdersCursor(adminClient);

      for (let i = 0; i < PAGES_PER_TICK; i++) {
        let data: any;
        try {
          data = await fetchOrdersPage(username, apiKey, page);
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

      } catch (e) {
        // Sem isto o tick que lanca some do `sync_log`: `logRun` fica DEPOIS do
        // laco e nunca roda. Se o erro for permanente (ex.: SQL nao aplicado), o
        // cron falha em toda tick, o cursor nao avanca, nada sincroniza — e a
        // tela de Sync do admin mostra "nada aconteceu" em vez do erro.
        await logRun(adminClient, "orders", { created, updated, skipped, errors: errors + 1, samples: [String((e as any)?.message ?? e).slice(0, 300)] });
        throw e;
      } finally {
        await suprimirNotificacao(adminClient, false);
      }
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
