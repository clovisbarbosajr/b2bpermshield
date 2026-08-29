// sync-container-eta — atualiza o ETA dos itens de Producao a partir do projeto
// CONTAINER ZAP (tracker ShipsGo).
//
// COMO FUNCIONA
//   1. le os itens de `producao_pedidos` ainda NAO recebidos que tenham numero de
//      container OU tracking preenchido (paginado — o PostgREST corta em 1000);
//   2. normaliza os numeros (maiusculas, so letras/numeros) — o admin digita a
//      mao, entao "HDMU 2794405" e "hdmu-2794405" precisam casar;
//   3. chama a RPC `eta_por_containers` no tracker (unico ponto de contato: ela
//      devolve SO container + ETA + fonte, nada de evento/navio/produto);
//   4. grava em `producao_pedidos.est_entrega` (+ `eta_fonte`, `eta_atualizado_em`).
//
// DECISAO DO DONO (25/ago): o ETA do tracker SOBRESCREVE o que estiver na tela —
// "o ETA muda, as vezes o navio atrasa ou adianta". Nao ha modo "so se vazio".
//
// Container # e Tracking # sao a MESMA coisa no negocio (frete maritimo), entao
// o casamento tenta os dois campos. Ver docs/integracao-container-zap/PENDENCIAS.md.
//
// Cada execucao grava uma linha em `producao_eta_sync_log` — o pedido foi "1x por
// dia, SEM FALHA", e sem registro nao da pra afirmar que rodou. O gateway precisa
// de `verify_jwt = false` (config.toml), senao a chamada do cron morre ANTES de
// entrar aqui e nem o log fica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const PAGINA = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (d: any, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const iniciado = new Date().toISOString();
  let lidos = 0, casados = 0, atualizados = 0;
  const erros: string[] = [];

  const registrar = async (ok: boolean, mensagem: string | null) => {
    await db.from("producao_eta_sync_log").insert({
      iniciado_em: iniciado, ok, mensagem,
      itens_lidos: lidos, itens_casados: casados,
      itens_atualizados: atualizados, itens_com_erro: erros.length,
    });
  };

  // Autorizacao ANTES de qualquer escrita — inclusive antes de gravar log. Com
  // `verify_jwt = false` no gateway, qualquer requisicao com a anon key chega
  // aqui; sem esta guarda, dava pra encher a tabela de log de fora.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const enviado = req.headers.get("x-cron-secret") ?? "";
  let autorizado = !!cronSecret && enviado === cronSecret;
  if (!autorizado) {
    try {
      const authHeader = req.headers.get("authorization") ?? "";
      const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await caller.auth.getUser();
      if (user) {
        const { data: role } = await db.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
        autorizado = ["admin", "manager"].includes(role?.role ?? "");
      }
    } catch { /* segue como nao autorizado */ }
  }
  if (!autorizado) return json({ error: "Not authorized" }, 401);

  try {
    // `limpar`: colar o valor do .env no campo de secret costuma trazer aspas
    // junto (`"https://..."`). O fetch morre com "Invalid URL" e o lote inteiro
    // fica sem ETA — aconteceu na 1a configuracao. Tira aspas/apostrofos das
    // pontas e espaco em volta antes de usar.
    const limpar = (v: string | undefined) =>
      (v ?? "").trim().replace(/^['"]+/, "").replace(/['"]+$/, "").trim();
    const trackerUrl = limpar(Deno.env.get("TRACKER_SUPABASE_URL")).replace(/\/+$/, "");
    const trackerKey = limpar(Deno.env.get("TRACKER_SUPABASE_ANON_KEY"));
    if (!trackerUrl || !trackerKey) {
      await registrar(false, "TRACKER_SUPABASE_URL/ANON_KEY nao configurados");
      return json({ error: "Tracker not configured" }, 500);
    }

    // Itens ainda em transito. Recebido nao muda mais de ETA.
    // PAGINADO: `solicitado`/`a_caminho` so saem da lista no check-in, entao
    // acumulam. Passando de 1000, o PostgREST cortaria SEM erro e o excedente
    // ficaria sem ETA com o log dizendo "ok".
    const pendentes: any[] = [];
    let de = 0;
    for (;;) {
      const { data, error } = await db
        .from("producao_pedidos")
        .select("id, numero_container, tracking, est_entrega, status")
        .neq("status", "delivered")
        // `id` como desempate: `created_at` NAO e unico (ProducaoEntrada insere
        // varias linhas num unico statement, todas com o mesmo now()). Sem o
        // desempate, a paginacao por OFFSET pode pular ou repetir linha.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) throw new Error("falha ao ler producao_pedidos: " + error.message);
      const pagina = data ?? [];
      pendentes.push(...pagina.filter((i: any) => norm(i.numero_container) || norm(i.tracking)));
      // Avanca pelo QUE VEIO, e para so quando vier vazio: se o `db-max-rows` do
      // projeto for menor que PAGINA, a 1a pagina volta curta e o `< PAGINA`
      // encerraria o laco deixando o resto sem ETA — com o log dizendo "ok".
      if (pagina.length === 0) break;
      de += pagina.length;
    }

    lidos = pendentes.length;
    if (lidos === 0) {
      await registrar(true, "nenhum item com container/tracking");
      return json({ ok: true, lidos: 0, atualizados: 0 });
    }

    // Container # e Tracking # sao o mesmo dado — consulta os dois.
    const numeros = [...new Set(
      pendentes.flatMap((i: any) => [norm(i.numero_container), norm(i.tracking)]).filter(Boolean),
    )];

    const resp = await fetch(`${trackerUrl}/rest/v1/rpc/eta_por_containers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: trackerKey, Authorization: `Bearer ${trackerKey}` },
      body: JSON.stringify({ _containers: numeros }),
    });
    if (!resp.ok) throw new Error(`tracker respondeu ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

    const linhas: Array<{ container_number: string; eta: string | null; fonte: string | null }> = await resp.json();
    const porContainer = new Map<string, { eta: string; fonte: string | null }>();
    for (const l of linhas) {
      // Chaveia pelo numero JA NORMALIZADO e descarta o que normaliza pra vazio
      // (ex.: "-", "  "). Sem isso a chave "" entrava no mapa, e todo item que so
      // tem container (tracking vazio) casava no 2o `get(norm(item.tracking))` ===
      // `get("")` e recebia o ETA de um registro que nao e o dele.
      const chave = norm(l?.container_number);
      if (chave && l?.eta) porContainer.set(chave, { eta: l.eta, fonte: l.fonte ?? null });
    }

    for (const item of pendentes) {
      const achado = porContainer.get(norm(item.numero_container)) ?? porContainer.get(norm(item.tracking));
      if (!achado) continue;
      casados++;
      // So grava se MUDOU — evita um UPDATE por linha todo dia e mantem o
      // `updated_at` significando "algo mudou de verdade".
      if (String(item.est_entrega ?? "") === achado.eta) continue;
      // `sheet` = ETA da PLANILHA do tracker, um dado ESTATICO. O dono pediu
      // "sobrescreve sempre" pensando no rastreio ao vivo ("o navio atrasa ou
      // adianta"). Deixar a planilha sobrescrever tambem faria uma data velha
      // apagar o ETA digitado a mao TODO DIA, pra sempre, sem jeito de fixar.
      // Entao a planilha so PREENCHE o que esta vazio; rastreio ao vivo
      // (arrival/eta_predicted/eta) sobrescreve como pedido.
      if (achado.fonte === "sheet" && String(item.est_entrega ?? "") !== "") continue;
      // Erro em UMA linha NAO aborta o lote: antes o primeiro `throw` deixava
      // todo o resto sem sincronizar ate o dia seguinte.
      const { error } = await db.from("producao_pedidos")
        .update({ est_entrega: achado.eta, eta_fonte: achado.fonte, eta_atualizado_em: new Date().toISOString() })
        .eq("id", item.id);
      if (error) { erros.push(`${item.id}: ${error.message}`); continue; }
      atualizados++;
    }

    // `ok` = "o lote rodou ate o fim". Falha em item isolado vai em
    // `itens_com_erro` + mensagem. Marcar a execucao inteira como falha por 1
    // erro em 500 tornaria o painel inutil pra responder "rodou hoje?".
    await registrar(true, erros.length ? `${erros.length} item(ns) falharam. Primeiro: ${erros[0]}`.slice(0, 500) : null);
    return json({ ok: true, lidos, casados, atualizados, com_erro: erros.length });
  } catch (err: any) {
    await registrar(false, String(err?.message ?? err).slice(0, 500));
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
