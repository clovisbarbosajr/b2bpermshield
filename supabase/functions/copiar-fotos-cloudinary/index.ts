// USO UNICO — copiar as fotos do Cloudinary do B2BWave para o nosso storage.
//
// Contexto (16/set/2026): 321 de 326 `produtos.imagem_url` apontam para
// `res.cloudinary.com/dbrtm8pf6/...`, o Cloudinary do B2BWave. O front carrega
// de la em cada pagina. Quando a conta do B2BWave for cancelada, somem — 6 dos
// Slat Wall ja respondem 404. Esta funcao baixa cada URL viva, sobe no bucket
// `product-images` (num caminho deterministico por linha) e troca o link na
// mesma linha. URL morta NAO e tocada: entra no relatorio.
//
// Regras: sem e-mail/SMS/notificacao (nao importar `_shared/dispatch.ts` nem
// `_shared/senders.ts`); sem auth; sem API do B2BWave (so as URLs do banco);
// nao apaga nada; `dry_run` e o padrao — a primeira chamada so conta.
//
// Como usar (depois do deploy pelo chat do Lovable), logado como admin:
//   POST /functions/v1/copiar-fotos-cloudinary  { "dry_run": true }
//   POST /functions/v1/copiar-fotos-cloudinary  { "dry_run": false }
//     repetir enquanto `copiadas > 0` ou `parada_por_tempo = true`. O que sobrar
//     em `restantes` esta listado em `mortas` (404 na origem — subir de novo na
//     mao) e `erros`; `restantes` NAO chega a zero enquanto houver morta.
//
// OPERACIONAL: rodar com NENHUMA ficha de produto aberta. A ficha guarda a URL
// carregada e o Save regrava por cima (o token `admin_rev` nao ve esta troca);
// a galeria e regravada inteira no Save. Se alguem salvar no meio, basta rodar
// de novo: a linha volta a ser candidata.
//
// Idempotente: a selecao e `ILIKE '%res.cloudinary.com%'`, entao linha ja
// trocada nao volta a ser candidata; falha no meio e segura (caminho fixo +
// upsert). Sem `offset`: o conjunto encolhe a cada UPDATE.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ALVOS, BUCKET, caminhoNoBucket, ehCloudinary, extensaoPorContentType } from "./puro.ts";

type Morta = { tabela: string; id: string; url: string; status: number };
type Erro = { tabela: string; id: string; url: string; motivo: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    // ── Admin check: identico ao de admin-create-user ────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await admin
      .from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
    if (!roleData) return json({ error: "Only admins can run this" }, 403);

    // ── Parametros ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    // `dry_run` so e falso quando vier LITERALMENTE false: ausente, null ou
    // "false" (string) continuam sendo ensaio.
    const dryRun = body?.dry_run !== false;
    const limite = Math.min(Math.max(Number(body?.limit) || 500, 1), 2000);
    const orcamentoMs = Math.min(Math.max(Number(body?.orcamento_ms) || 100_000, 5_000), 120_000);
    const inicio = Date.now();
    const estourou = () => Date.now() - inicio > orcamentoMs;

    const candidatas: Record<string, number> = {};
    const mortas: Morta[] = [];
    const erros: Erro[] = [];
    let copiadas = 0;
    let paradaPorTempo = false;

    for (const [tabela, coluna] of ALVOS) {
      const chave = `${tabela}.${coluna}`;
      const { data: linhas, error: selErr } = await admin
        .from(tabela).select(`id, ${coluna}`).ilike(coluna, "%res.cloudinary.com%").limit(limite);
      if (selErr) {
        // Tabela/coluna que nao existe neste banco: reporta e segue.
        erros.push({ tabela: chave, id: "-", url: "-", motivo: `select: ${selErr.message}` });
        continue;
      }
      candidatas[chave] = linhas?.length ?? 0;
      if (dryRun || !linhas?.length) continue;

      for (const linha of linhas as Array<Record<string, unknown>>) {
        if (estourou()) { paradaPorTempo = true; break; }
        const id = String(linha.id);
        const url = String(linha[coluna] ?? "");
        if (!ehCloudinary(url)) {
          erros.push({ tabela: chave, id, url, motivo: "nao e URL https do Cloudinary" });
          continue;
        }

        let res: Response;
        try {
          res = await fetch(url);
        } catch (e) {
          erros.push({ tabela: chave, id, url, motivo: `fetch: ${(e as Error).message}` });
          continue;
        }
        if (!res.ok) {
          // 404 (`x-cld-error: Resource not found`) e o caso dos Slat Wall:
          // nada e escrito, a linha fica como esta.
          mortas.push({ tabela: chave, id, url, status: res.status });
          continue;
        }
        const contentType = res.headers.get("content-type");
        const ext = extensaoPorContentType(contentType);
        if (!ext) {
          erros.push({ tabela: chave, id, url, motivo: `content-type recusado: ${contentType ?? "(vazio)"}` });
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0) {
          erros.push({ tabela: chave, id, url, motivo: "corpo vazio" });
          continue;
        }

        const caminho = caminhoNoBucket(tabela, coluna, id, ext);
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(caminho, bytes, { contentType: String(contentType).split(";")[0].trim(), upsert: true });
        if (upErr) {
          erros.push({ tabela: chave, id, url, motivo: `upload: ${upErr.message}` });
          continue;
        }
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(caminho);
        const novaUrl = pub?.publicUrl;
        if (!novaUrl) {
          erros.push({ tabela: chave, id, url, motivo: "getPublicUrl vazio" });
          continue;
        }

        // Troca SO a coluna da URL, na linha certa, e confirma que casou 1 linha.
        // `admin_rev` (bloqueio otimista da ficha) nao e tocado.
        const { data: atualizada, error: updErr } = await admin
          .from(tabela).update({ [coluna]: novaUrl }).eq("id", id).select("id").maybeSingle();
        if (updErr || !atualizada) {
          erros.push({ tabela: chave, id, url, motivo: `update: ${updErr?.message ?? "0 linhas"}` });
          continue;
        }
        copiadas++;
      }
      if (paradaPorTempo) break;
    }

    // Quantas ainda apontam para o Cloudinary depois desta chamada.
    // Contagem que falha NAO pode virar 0: 0 e o sinal de "acabou".
    let restantes: number | null = 0;
    for (const [tabela, coluna] of ALVOS) {
      const { count, error: cntErr } = await admin
        .from(tabela).select("id", { count: "exact", head: true }).ilike(coluna, "%res.cloudinary.com%");
      if (cntErr || count === null) {
        erros.push({ tabela: `${tabela}.${coluna}`, id: "-", url: "-", motivo: `count: ${cntErr?.message ?? "null"}` });
        restantes = null;
      } else if (restantes !== null) {
        restantes += count;
      }
    }

    return json({
      dry_run: dryRun,
      candidatas,
      copiadas,
      mortas,
      erros,
      restantes,
      parada_por_tempo: paradaPorTempo,
      duracao_ms: Date.now() - inicio,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
