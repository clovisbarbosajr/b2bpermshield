import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  RefreshCw, Package, FolderTree, Users, DollarSign, ShoppingCart,
  Tag, UserCheck, CheckCircle2, AlertCircle, Loader2, StopCircle, Search, Copy
} from "lucide-react";

type SyncStatus = "idle" | "loading" | "success" | "error";

interface SyncItem {
  key: string;
  label: string;
  action: string;
  icon: React.ElementType;
  description: string;
}

const syncItems: SyncItem[] = [
  { key: "categories", label: "Categories", action: "sync_categories", icon: FolderTree, description: "Sync categories by name" },
  { key: "brands", label: "Brands", action: "sync_brands", icon: Tag, description: "Sync brands by name" },
  { key: "price_lists", label: "Price Lists", action: "sync_price_lists", icon: DollarSign, description: "Sync price lists by name" },
  { key: "sales_reps", label: "Sales Reps", action: "sync_sales_reps", icon: UserCheck, description: "Sync sales reps by email" },
  { key: "products", label: "Products", action: "sync_products", icon: Package, description: "Sync all products with correct wholesale price (upsert by SKU)" },
  { key: "customers", label: "Customers", action: "sync_customers", icon: Users, description: "Sync customers with price list & rep mapping" },
  { key: "privacy_groups", label: "Privacy Groups", action: "sync_privacy_groups", icon: Users, description: "Sync privacy groups" },
  { key: "company_activities", label: "Company Activities", action: "sync_company_activities", icon: Tag, description: "Sync company activity types" },
  // Removidos: "Extra Fields" (não existe na API do B2BWave) e "Fix Order Prices"
  // (redundante — o sync normal de pedidos já recalcula os $0.00 somando os itens).
];

const B2BWaveSync = () => {
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  // Order sync state
  const [orderSyncing, setOrderSyncing] = useState(false);
  const [orderProgress, setOrderProgress] = useState("");
  const [orderTotalSynced, setOrderTotalSynced] = useState(0);
  const [orderTotalUpdated, setOrderTotalUpdated] = useState(0);
  const [orderTotalSkipped, setOrderTotalSkipped] = useState(0);
  const [orderTotalItems, setOrderTotalItems] = useState(0);
  const [orderTotalErrors, setOrderTotalErrors] = useState(0);
  const stopRef = useRef(false);

  // ── Conferência (SÓ LEITURA) ────────────────────────────────────────────────
  // Estas duas comparam este sistema com o B2BWave sem escrever nada. Existem
  // porque a decisão de religar a sincronização depende do resultado delas, e
  // sem botão o único jeito seria `curl` com token de admin na mão.
  const [conferindo, setConferindo] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<Record<string, any>>({});

  const rodarConferencia = async (action: string, rotulo: string) => {
    setConferindo(action);
    setConferencia((c) => ({ ...c, [action]: null }));
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action },
      });
      if (error) throw error;
      setConferencia((c) => ({ ...c, [action]: data }));
      // O veredito de cada uma tem nome diferente: `identico` (pedidos) e
      // `veredito` (catálogo). Ler só um deixaria metade sem resumo no toast.
      const ok = data?.identico === true || data?.veredito?.startsWith("IDENTICO");
      const inconclusivo = data?.truncado === true || data?.leitura_truncada === true;
      if (inconclusivo) toast.warning(`${rotulo}: inconclusivo — alguma leitura falhou`);
      else if (ok) toast.success(`${rotulo}: idêntico`);
      else toast.warning(`${rotulo}: há divergências — veja os números`);
    } catch (err: any) {
      setConferencia((c) => ({ ...c, [action]: { erro: err.message || "falhou" } }));
      toast.error(`${rotulo}: ${err.message || "falhou"}`);
    }
    setConferindo(null);
  };

  const copiarConferencia = (action: string) => {
    const txt = JSON.stringify(conferencia[action], null, 2);
    navigator.clipboard.writeText(txt)
      .then(() => toast.success("Resultado copiado"))
      .catch(() => toast.error("Não consegui copiar — selecione o texto à mão"));
  };

  // Status PERSISTENTE — lido de sync_log no banco (não some ao recarregar a página).
  const [lastRuns, setLastRuns] = useState<any[]>([]);
  const fetchLastRuns = async () => {
    const { data } = await (supabase as any).from("sync_log").select("*").order("created_at", { ascending: false }).limit(50);
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const r of data ?? []) if (!seen.has(r.action)) { seen.add(r.action); latest.push(r); }
    setLastRuns(latest);
  };
  useEffect(() => { fetchLastRuns(); }, [orderSyncing]);

  const testConnection = async () => {
    setTesting(true);
    setConnectionOk(null);
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action: "test" },
      });
      if (error) throw error;
      if (data?.success) {
        setConnectionOk(true);
        toast.success("Connection to B2B Wave successful!");
      } else {
        throw new Error(data?.error || "Connection failed");
      }
    } catch (err: any) {
      setConnectionOk(false);
      toast.error("Connection failed: " + (err.message || "Unknown error"));
    }
    setTesting(false);
  };

  const runSync = async (item: SyncItem) => {
    setStatuses((s) => ({ ...s, [item.key]: "loading" }));
    setResults((r) => ({ ...r, [item.key]: "" }));
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action: item.action },
      });
      if (error) throw error;
      if (data?.success) {
        setStatuses((s) => ({ ...s, [item.key]: "success" }));
        setResults((r) => ({ ...r, [item.key]: data.message || "Done" }));
        // O toast recebe só o RESUMO (antes do "|" técnico de SYNC_VERSION) —
        // a mensagem completa fica no card. Antes o toast estourava por trás dos
        // outros cards com o array de debug inteiro.
        const short = String(data.message || "Done").split("|")[0].trim();
        toast.success(`${item.label}: ${short}`);
      } else {
        throw new Error(data?.error || "Failed");
      }
    } catch (err: any) {
      setStatuses((s) => ({ ...s, [item.key]: "error" }));
      setResults((r) => ({ ...r, [item.key]: err.message }));
      toast.error(`${item.label}: ${err.message}`);
    }
  };

  const syncAllOrders = async () => {
    setOrderSyncing(true);
    stopRef.current = false;
    setOrderTotalSynced(0);
    setOrderTotalSkipped(0);
    setOrderTotalItems(0);
    setOrderTotalErrors(0);

    // Usa o cursor do servidor (action cron_orders): RETOMA de onde parou. Se você
    // sair da página e voltar, NÃO recomeça do zero — o progresso fica salvo em
    // sync_state. É o mesmo motor do cron automático, só disparado manualmente.
    let totalSynced = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let tick = 0;

    while (!stopRef.current) {
      tick++;
      setOrderProgress(`Sincronizando… (lote ${tick}) — retoma automaticamente de onde parou`);
      try {
        const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
          body: { action: "cron_orders", pages: 2 },
        });
        if (error) throw error;

        totalSynced += data.created || 0;
        totalUpdated += data.updated || 0;
        totalSkipped += data.skipped || 0;
        totalErrors += data.errors || 0;
        setOrderTotalSynced(totalSynced);
        setOrderTotalUpdated(totalUpdated);
        setOrderTotalSkipped(totalSkipped);
        setOrderTotalErrors(totalErrors);
        // ~65 páginas no histórico (≈32k pedidos / 500). Cursor = página atual (mais antigos→novos).
        const estPct = Math.min(99, Math.round(((data.nextCursor || 1) / 65) * 100));
        setOrderProgress(`Página ${data.nextCursor} de ~65 (~${estPct}%) — ${totalSynced} novos · ${totalUpdated} atualizados · ${totalErrors} erros · (maio/junho estão nas últimas páginas)`);

        if (data.wrapped) {
          setOrderProgress(`✅ Ciclo completo! ${totalSynced} novos, ${totalUpdated} atualizados, ${totalErrors} erros. O cron mantém tudo atualizado sozinho a partir daqui.`);
          toast.success(`Sync: ${totalSynced} novos, ${totalUpdated} atualizados`);
          break;
        }
      } catch (err: any) {
        totalErrors++;
        setOrderTotalErrors(totalErrors);
        setOrderProgress(`⚠️ Erro no lote ${tick}: ${err.message}. Tentando de novo…`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (stopRef.current) {
      setOrderProgress(`⏹ Pausado — progresso salvo (cursor). Pode continuar depois, NÃO recomeça do zero.`);
    }
    setOrderSyncing(false);
  };

  const stopOrderSync = () => {
    stopRef.current = true;
  };

  // FANTASMAS — pedidos que existem aqui e sumiram do B2BWave.
  //
  // DOIS PASSOS de proposito. O primeiro so CONTA e mostra a lista; apagar
  // exige um segundo clique, depois de o admin ver os numeros. Exclusao de
  // pedido nao tem desfazer — o pedido nao existe mais na origem para
  // reimportar — entao ninguem apaga por engano num clique so.
  const limparFantasmas = async () => {
    setOrderSyncing(true);
    setOrderProgress("Conferindo quais pedidos sumiram do B2BWave…");
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action: "limpar_fantasmas", dry_run: true },
      });
      if (error) throw error;

      // O servidor ABORTA sozinho quando a leitura parece incompleta (teto de
      // sanidade, origem vazia, resposta invalida). Aqui so mostro o motivo.
      if (data?.abortado) {
        toast.error("Não apaguei nada", { description: data.motivo });
        setOrderProgress("⚠ " + data.motivo);
        setOrderSyncing(false);
        return;
      }

      const n = data?.fantasmas ?? 0;
      if (n === 0) {
        toast.success("Nenhum pedido sobrando — o clone está fechado deste lado.");
        setOrderProgress("✅ Nenhum pedido existe aqui sem existir no B2BWave.");
        setOrderSyncing(false);
        return;
      }

      const lista = (data?.numeros ?? []).join(", ");
      const ok = confirm(
        `${n} pedido(s) existem aqui e NÃO existem mais no B2BWave:\n\n${lista}\n\n` +
        `Apagar? Isto NÃO tem desfazer — eles não estão mais na origem para reimportar.\n\n` +
        `(Os itens de cada pedido vão junto.)`
      );
      if (!ok) {
        setOrderProgress(`ℹ ${n} fantasmas encontrados. Nada foi apagado.`);
        setOrderSyncing(false);
        return;
      }

      setOrderProgress(`Apagando ${n} pedido(s)…`);
      const { data: r2, error: e2 } = await supabase.functions.invoke("b2bwave-sync", {
        // Manda a lista que o admin ACABOU de confirmar. Sem ela o servidor
        // recalcula do zero, e um pedido apagado no B2BWave entre os dois
        // cliques seria apagado aqui sem ter aparecido na confirmação.
        body: { action: "limpar_fantasmas", dry_run: false, numeros: data?.numeros ?? [] },
      });
      if (e2) throw e2;
      if (r2?.abortado) {
        toast.error("Não apaguei nada", { description: r2.motivo });
        setOrderProgress("⚠ " + r2.motivo);
      } else {
        toast.success(`${r2?.apagados ?? 0} pedido(s) apagados`);
        setOrderProgress(`✅ ${r2?.apagados ?? 0} apagados${(r2?.falhas?.length ?? 0) > 0 ? `, ${r2.falhas.length} falharam` : ""}`);
      }
    } catch (err: any) {
      toast.error("Falhou: " + (err?.message ?? String(err)));
      setOrderProgress("❌ " + (err?.message ?? String(err)));
    }
    setOrderSyncing(false);
    fetchLastRuns();
  };

  // HISTORICO COMPLETO — a acao `sync_orders_all`, que traz TODO pedido do
  // B2BWave, inclusive os anteriores a 2025, e nao notifica ninguem
  // (`skipPre2025 = false`, `notify = false` no servidor).
  //
  // Existe separada da sincronizacao de rotina porque varre a base inteira e
  // demora. A comparacao de 26/ago achou 1.639 pedidos que existiam la e nao
  // aqui — todos de 2024 ou antes. Este botao e o que fecha esse buraco.
  const importarHistoricoCompleto = async () => {
    if (!confirm(
      "Bring EVERY order from B2BWave, including orders from 2024 and earlier?\n\n" +
      "This reads the whole history and can take several minutes.\n" +
      "No email or SMS is sent — this action never notifies."
    )) return;
    setOrderSyncing(true);
    stopRef.current = false;
    setOrderProgress("Importando histórico completo… isto varre a base inteira.");
    // A acao trabalha em PAGINA + DESLOCAMENTO (50 pedidos por chamada) e
    // devolve `nextPage`/`nextOffset`. Seguir so a pagina pularia 50 de cada
    // 500 — a importacao pareceria completa e nao seria.
    let pagina = 1, desloc = 0, criados = 0, atualizados = 0, erros = 0, chamadas = 0;
    try {
      while (!stopRef.current) {
        const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
          body: { action: "sync_orders_all", page: pagina, offset: desloc },
        });
        if (error) throw error;
        // O servidor devolve `synced` (nao `created`) nesta acao.
        criados += data?.synced ?? 0;
        atualizados += data?.updated ?? 0;
        erros += data?.errors ?? 0;
        chamadas++;
        setOrderProgress(
          `Histórico: página ${pagina} — ${criados} novos, ${atualizados} atualizados, ${erros} erros`
        );
        if (!data?.hasMore) break;
        const proxPagina = data?.nextPage ?? pagina + 1;
        const proxDesloc = data?.nextOffset ?? 0;
        // NAO-PROGRESSO, nao contador fixo. O teto de 400 que eu tinha posto
        // cobria ~20 mil pedidos, e o proprio arquivo estima ~32 mil no
        // historico: a importacao pararia em ~62% avisando que parou, mas sem
        // ter trazido tudo. Girar em falso e o que precisa ser detectado.
        if (proxPagina === pagina && proxDesloc === desloc) {
          setOrderProgress("⚠ O servidor devolveu o mesmo ponto duas vezes — parei para não girar em falso.");
          break;
        }
        pagina = proxPagina;
        desloc = proxDesloc;
      }
      toast.success(`Histórico importado: ${criados} novos, ${atualizados} atualizados`);
      setOrderProgress(`✅ Histórico completo: ${criados} novos, ${atualizados} atualizados, ${erros} erros`);
    } catch (err: any) {
      toast.error("Falhou: " + (err?.message ?? String(err)));
      setOrderProgress("❌ " + (err?.message ?? String(err)));
    }
    setOrderSyncing(false);
    fetchLastRuns();
  };

  const syncAll = async () => {
    for (const item of syncItems) {
      await runSync(item);
    }
    await syncAllOrders();
  };

  const statusIcon = (key: string) => {
    const s = statuses[key];
    if (s === "loading") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "error") return <AlertCircle className="h-4 w-4 text-destructive" />;
    return null;
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">B2B Wave Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import data from your B2B Wave account into this portal.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={testConnection} disabled={testing} className="gap-1">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Test Connection
          </Button>
          <Button onClick={syncAll} disabled={orderSyncing} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Sync All
          </Button>
        </div>
      </div>

      {/* Status persistente — sobrevive a recarregar/trocar de aba (vem do banco) */}
      {lastRuns.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Última sincronização (salvo no servidor)</h3>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={fetchLastRuns}>
              <RefreshCw className="h-3 w-3" /> Atualizar
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {lastRuns.map((r) => (
              <div key={r.id} className="rounded-md border p-2 text-xs">
                <div className="font-medium capitalize">{r.action}</div>
                <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                <div className="mt-1">
                  +{r.created_count} novos · {r.updated_count} atualizados · {r.skipped_count} iguais ·{" "}
                  <span className={r.errors_count > 0 ? "text-destructive font-medium" : ""}>{r.errors_count} erros</span>
                </div>
                {r.errors_count > 0 && Array.isArray(r.samples) && r.samples.length > 0 && (
                  <div className="mt-1 break-words text-destructive">{r.samples[0]}</div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Conferência: SÓ LEITURA. Fica separada dos botões de sync de propósito —
          tudo daqui para baixo ESCREVE, e isto aqui não. */}
      <Card className="mb-4 border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" /> Conferência — só leitura
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Compara este sistema com o B2BWave sem alterar nada e sem enviar e-mail ou SMS.
            É o que decide se dá para religar a sincronização.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {[
              { action: "diff_orders", rotulo: "Pedidos", desc: "pedidos, status, valores e as linhas de cada um" },
              { action: "diff_catalog", rotulo: "Catálogo", desc: "produtos, tamanhos/cores, régua de preço e clientes" },
            ].map((c) => (
              <Button
                key={c.action}
                variant="outline"
                onClick={() => rodarConferencia(c.action, c.rotulo)}
                disabled={conferindo !== null}
                className="gap-1"
                title={c.desc}
              >
                {conferindo === c.action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Comparar {c.rotulo}
              </Button>
            ))}
          </div>

          {Object.entries(conferencia).map(([action, r]) =>
            !r ? null : (
              <div key={action} className="rounded-md border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {action === "diff_orders" ? "Pedidos" : "Catálogo"}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                          onClick={() => copiarConferencia(action)}>
                    <Copy className="h-3 w-3" /> Copiar
                  </Button>
                </div>
                {r.erro ? (
                  <p className="text-sm text-destructive">{r.erro}</p>
                ) : (
                  <p className="mb-2 text-sm">
                    {r.truncado || r.leitura_truncada
                      ? <span className="font-medium text-amber-600 dark:text-amber-500">Inconclusivo — alguma leitura falhou, não use para decidir</span>
                      : (r.identico === true || String(r.veredito || "").startsWith("IDENTICO"))
                        ? <span className="font-medium text-green-600 dark:text-green-500">Idêntico nos campos comparados</span>
                        : <span className="font-medium text-amber-600 dark:text-amber-500">Há divergências</span>}
                  </p>
                )}
                {/* O JSON inteiro fica disponível: os números é que decidem, e é
                    isto que eu preciso receber para analisar. */}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Ver o resultado completo</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                    {JSON.stringify(r, null, 2)}
                  </pre>
                </details>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {connectionOk !== null && (
        <Card className={`mb-4 border ${connectionOk ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
          <CardContent className="flex items-center gap-2 py-3">
            {connectionOk ? (
              <><CheckCircle2 className="h-5 w-5 text-green-500" /> <span className="text-sm font-medium">Connected to B2B Wave successfully</span></>
            ) : (
              <><AlertCircle className="h-5 w-5 text-destructive" /> <span className="text-sm font-medium">Failed to connect — check your API credentials</span></>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {syncItems.map((item) => (
          <Card key={item.key}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2">
                <item.icon className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  {item.label} {statusIcon(item.key)}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>
              {results[item.key] && (
                <p className={`mb-2 text-xs break-words whitespace-pre-wrap ${statuses[item.key] === "error" ? "text-destructive" : "text-green-600"}`}>
                  {results[item.key]}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                disabled={statuses[item.key] === "loading"}
                onClick={() => runSync(item)}
              >
                {statuses[item.key] === "loading" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Sync Now
              </Button>
            </CardContent>
          </Card>
        ))}

        {/* Orders - Special card with progress */}
        <Card className="sm:col-span-2 lg:col-span-3">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="rounded-lg bg-accent/10 p-2">
              <ShoppingCart className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Orders (Full History)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Sync ALL orders from B2B Wave history. Processes 50 orders per batch to avoid timeouts.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {orderProgress && (
              <div className="mb-3 rounded-md bg-muted/50 p-3 text-sm">
                <p>{orderProgress}</p>
                {orderSyncing && (
                  <div className="mt-2 grid grid-cols-5 gap-4 text-xs text-muted-foreground">
                    <span>New: <strong className="text-foreground">{orderTotalSynced}</strong></span>
                    <span>Updated: <strong className="text-foreground">{orderTotalUpdated}</strong></span>
                    <span>Unchanged: <strong className="text-foreground">{orderTotalSkipped}</strong></span>
                    <span>Items: <strong className="text-foreground">{orderTotalItems}</strong></span>
                    <span>Errors: <strong className="text-foreground">{orderTotalErrors}</strong></span>
                  </div>
                )}
                {orderSyncing && <Progress className="mt-2" value={undefined} />}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={orderSyncing}
                onClick={syncAllOrders}
              >
                {orderSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {orderSyncing ? "Syncing..." : "Sync All Orders"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={orderSyncing}
                onClick={limparFantasmas}
                title="Procura pedidos que existem aqui e não existem mais no B2BWave. Mostra a lista antes de apagar."
              >
                <StopCircle className="h-3 w-3" /> Limpar pedidos que sumiram
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={orderSyncing}
                onClick={importarHistoricoCompleto}
                title="Traz TODO pedido do B2BWave, inclusive os de 2024 e antes. Não envia e-mail nem SMS."
              >
                <RefreshCw className="h-3 w-3" /> Importar histórico completo
              </Button>
              {orderSyncing && (
                <Button variant="destructive" size="sm" className="gap-1" onClick={stopOrderSync}>
                  <StopCircle className="h-3 w-3" /> Stop
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sync Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>• <strong>Products</strong> are matched by SKU — existing products are updated, new ones are created.</p>
          <p>• <strong>Categories, Brands, Price Lists</strong> are matched by name.</p>
          <p>• <strong>Sales Reps</strong> are matched by email.</p>
          <p>• <strong>Customers</strong> are synced with price list and sales rep mapping.</p>
          <p>• <strong>Orders</strong> are synced page by page (500 per API page, 50 per batch) to handle large datasets.</p>
          <p>• The B2B Wave API contains <strong>32,000+</strong> historical orders. Full sync may take 30-60 minutes.</p>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default B2BWaveSync;
