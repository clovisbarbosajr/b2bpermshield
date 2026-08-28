import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/hooks/useActivityLog";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Save, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

// Ajuste de estoque em MASSA (estilo QuickBooks "Adjust Quantity/Value on Hand"):
// todos os produtos numa tabela com a CATEGORIA (pra saber de qual estoque/local é),
// coluna "New Quantity" editável linha a linha, e um Save que aplica tudo de uma vez.
// Cada produto alterado gera: update em produtos.estoque_total + linha em estoque_log
// + entrada DETALHADA em activity_logs (aparece em Settings → Activity Logs).

type Produto = { id: string; nome: string; sku: string; categoria_id: string | null; estoque_total: number };
type Categoria = { id: string; nome: string; parent_id: string | null };

// Cabeçalho ordenável — mesmo padrão visual da Produção (Status/Dashboard).
const SortHead = ({ k, label, sortKey, sortDir, onSort, className }: {
  k: string; label: string; sortKey: string; sortDir: "asc" | "desc"; onSort: (k: any) => void; className?: string;
}) => (
  <TableHead onClick={() => onSort(k)} className={`cursor-pointer select-none whitespace-nowrap hover:text-foreground ${className ?? ""}`}>
    <span className="inline-flex items-center gap-1">
      {label}
      {sortKey === k
        ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)
        : <ArrowUpDown className="h-3 w-3 opacity-30" />}
    </span>
  </TableHead>
);

const InventoryAdjustment = () => {
  const { user } = useAuth();
  const { log } = useActivityLog();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  // Nova quantidade por produto (string vazia = não mexe nessa linha).
  const [newQty, setNewQty] = useState<Record<string, string>>({});
  // Linhas que não entraram no último Save — ficam listadas na tela em vez de
  // sumirem com um toast que nomeava só a primeira.
  const [falhas, setFalhas] = useState<string[]>([]);
  // Linhas em que o ESTOQUE FOI salvo mas o historico nao. Lista separada de
  // proposito: o card de `falhas` diz "the quantity you typed is still in the
  // table", e para estas duas coisas isso e falso — o estoque entrou e a
  // quantidade digitada foi limpa. Misturar as duas fazia a tela mentir sobre o
  // banco no meio de uma contagem fisica.
  const [avisos, setAvisos] = useState<string[]>([]);

  const fetchData = async () => {
    // Pagina de verdade: esta tela lista TUDO sem paginação de UI, entao acima de
    // 1000 produtos ativos os ultimos sumiam da contagem e nao podiam ser
    // ajustados, sem nenhum aviso. E o erro passa a aparecer, em vez de virar
    // "No products found".
    try {
      const [prod, cat] = await Promise.all([
        fetchAllRows<Produto>((f, t) => supabase.from("produtos").select("id, nome, sku, categoria_id, estoque_total, estoque_reservado").eq("ativo", true).order("nome").order("id", { ascending: true }).range(f, t) as any),
        fetchAllRows<Categoria>((f, t) => supabase.from("categorias").select("id, nome, parent_id").eq("ativo", true).order("id", { ascending: true }).range(f, t) as any),
      ]);
      setProdutos(prod);
      setCategorias(cat);
    } catch (e: any) {
      console.error(e);
      toast.error("Could not load products. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchData(); }, []);

  // Caminho completo da categoria ("Estado › ... › One Plus") — mesmo padrão da Produção.
  const catPath = useMemo(() => {
    const byId = new Map(categorias.map((c) => [c.id, c]));
    return (catId: string | null): string => {
      const chain: string[] = [];
      let cur = catId ? byId.get(catId) : undefined;
      let guard = 0;
      while (cur && guard++ < 12) { chain.unshift(cur.nome); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
      return chain.length ? chain.join(" › ") : "Uncategorized";
    };
  }, [categorias]);

  // Ordenação por coluna (padrão: alfabético por Item — não há ETA aqui).
  type SortKey = "nome" | "categoria" | "estoque";
  const [sortKey, setSortKey] = useState<SortKey>("nome");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q ? produtos : produtos.filter((p) =>
      p.nome.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || catPath(p.categoria_id).toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortKey === "estoque") return (a.estoque_total - b.estoque_total) * dir;
      if (sortKey === "categoria") return catPath(a.categoria_id).localeCompare(catPath(b.categoria_id)) * dir;
      return a.nome.localeCompare(b.nome) * dir;
    });
  }, [produtos, search, catPath, sortKey, sortDir]);

  // Linhas efetivamente alteradas (valor preenchido, válido e diferente do atual).
  const changes = useMemo(() =>
    produtos
      .map((p) => {
        const raw = (newQty[p.id] ?? "").trim();
        if (raw === "") return null;
        const q = parseInt(raw);
        if (!Number.isFinite(q) || q < 0 || q === p.estoque_total) return null;
        return { p, q, diff: q - p.estoque_total };
      })
      .filter(Boolean) as { p: Produto; q: number; diff: number }[],
  [produtos, newQty]);

  const save = async () => {
    if (changes.length === 0) { toast.error("Enter a new quantity in at least one line."); return; }
    if (!confirm(`Apply inventory adjustment to ${changes.length} product(s)?`)) return;
    setSaving(true);

    // REGRA NUMERO UM (a mesma do topo de `b2bwave-sync/index.ts`): operacao em
    // MASSA suprime notificacao ANTES de comecar — e a pergunta certa e QUAL
    // GATILHO ela acorda, nao qual tabela ela toca.
    //
    // Esta tela grava `estoque_total` uma vez por linha, e `estoque_total` e
    // coluna vigiada por `trg_low_stock_notify`. Uma contagem fisica de 40 itens
    // que derrube 12 abaixo do limite vira 10 alertas (o teto de 10/h) e 2
    // engolidos — engolidos COM rastro (o ramo do teto grava `low_stock_teto`),
    // mas sem contagem por produto. O teto e ALARME, nao licenca.
    //
    // A chave e a de ESTOQUE (`set_suppress_stock_notify`), nao a de pedidos: as
    // duas sao contadas por referencia no banco, entao ligar aqui nao atrapalha
    // um sync que esteja rodando, nem o sync desliga a nossa.
    // Piso de 30 min, nao 10: `desde` e COMPARTILHADO e fica ancorado no
    // PRIMEIRO lote da sequencia. Se um sync orfao abriu a sequencia ha 110
    // minutos, esta chamada herda aquele `desde` e o silencio morre em 10 — no
    // meio da contagem. O SQL ja limita em 120, entao pedir mais nao custa nada.
    const minutosSup = Math.max(30, Math.ceil(changes.length / 100) * 5);
    const { error: supErr } = await supabase.rpc("set_suppress_stock_notify" as any, {
      _on: true, _minutos: minutosSup,
    });
    if (supErr) {
      // Falhar aqui ABORTA, e nada e gravado. Rodar o lote sem supressao e o
      // cenario do incidente de 25/ago: melhor a contagem nao subir do que subir
      // disparando alerta por produto.
      setSaving(false);
      toast.error("Could not pause stock alerts — nothing was saved. " + supErr.message);
      return;
    }

    // Limpa os cards do Save ANTERIOR — so AQUI, depois de o confirm ter sido
    // aceito E de a supressao ter dado certo. Esta lista so existe no estado do
    // componente (nao vai para `estoque_log` nem para `activity_logs`), entao
    // apaga-la num gesto que nao faz nada — cancelar o confirm, ou um abort que
    // termina em "nothing was saved" — destroi a unica copia que existe. A
    // versao anterior limpava antes do abort da RPC e violava a propria regra que
    // o comentario estabelecia vinte linhas acima.
    setFalhas([]); setAvisos([]);

    let ok = 0; const failed: string[] = [];
    // Ids que REALMENTE entraram no banco. A versao anterior inferia isso
    // filtrando `changes` por prefixo de nome em `failed` — e essa inferencia
    // quebrava exatamente quando mais custava: numa excecao, `failed` continha
    // so a mensagem do aborto, nenhum nome casava, e a tela limpava as 37
    // quantidades que o laco NUNCA chegou a gravar, dizendo ao operador que
    // continuavam na tabela. Contagem fisica perdida com a tela mentindo.
    const idsOk: string[] = [];
    const avisosLocais: string[] = [];
    let abortou = false;
    let msgAborto = "";
    try {
    for (const { p, q, diff } of changes) {
      // Rele o estoque AGORA. A contagem fisica pode levar horas: com o update
      // ABSOLUTO sobre o valor carregado no mount, todo pedido concluido no
      // intervalo tinha sua baixa DESFEITA — e o estoque_log registrava um
      // "quantidade_anterior" que nunca foi verdade.
      const { data: atual, error: reErr } = await supabase.from("produtos")
        .select("estoque_total, estoque_reservado").eq("id", p.id).maybeSingle();
      if (reErr || !atual) { failed.push(`${p.nome}: could not re-read stock`); continue; }
      if (atual.estoque_total !== p.estoque_total) {
        failed.push(`${p.nome}: stock changed to ${atual.estoque_total} while you were counting (was ${p.estoque_total})`);
        continue;
      }
      if (q < (atual.estoque_reservado ?? 0)) {
        failed.push(`${p.nome}: ${atual.estoque_reservado} unit(s) reserved by open orders`);
        continue;
      }
      // O filtro `.eq("estoque_total", ...)` fecha a janela que a releitura acima
      // apenas ESTREITA. A releitura compara com o retrato do mount, mas entre o
      // SELECT e este UPDATE ainda cabe a baixa de um pedido concluido — e o
      // update ABSOLUTO a desfazia em silencio, devolvendo o estoque ao numero que
      // o admin viu na tela. Mesmo molde de `src/lib/gravarProdutoComToken.ts`:
      // filtro e escrita no MESMO statement, porque separar em dois reabre a
      // corrida no meio.
      // A coluna "New Quantity" e a quantidade CONTADA, valor absoluto — por isso
      // nao da para trocar por `estoque_total = estoque_total + N`, que resolveria
      // a corrida sem filtro se a tela pedisse um delta.
      const { data: gravado, error } = await supabase.from("produtos")
        .update({ estoque_total: q }).eq("id", p.id).eq("estoque_total", p.estoque_total)
        .select("id").maybeSingle();
      if (error) { failed.push(`${p.nome}: ${error.message}`); continue; }
      // Sem erro e sem linha = o `id` casou (veio da propria grade) e o
      // `estoque_total` nao. Nada foi escrito nesta linha, entao ela vai para
      // `failed` — o card diz que a quantidade digitada continua na tabela, e aqui
      // isso e verdade.
      if (!gravado) { failed.push(`${p.nome}: stock changed while saving — this line was not written`); continue; }
      // Histórico de estoque (mesma tabela que o ajuste unitário da tela Inventory usa).
      //
      // O `error` e LIDO. Sem isto, RLS negando `estoque_log` fazia a tela dizer
      // "40 products adjusted" com o historico da contagem fisica VAZIO, em
      // silencio — e o subtitulo da propria tela promete ao operador que toda
      // mudanca fica registrada. Nao derruba a linha (o estoque JA foi gravado, e
      // reverter aqui seria pior), mas aparece no card AMBAR de avisos — lista
      // `avisos`, NAO `falhas`. A distincao nao e cosmetica: o card de `falhas`
      // diz "the quantity you typed is still in the table", e para esta linha as
      // duas metades sao falsas. Trocar por `failed.push` reintroduz a tela
      // mentindo sobre o banco no meio de uma contagem fisica.
      const { error: logErr } = await supabase.from("estoque_log").insert({
        produto_id: p.id, quantidade_anterior: p.estoque_total, quantidade_nova: q,
        motivo: [reference && `Ref ${reference}`, memo].filter(Boolean).join(" — ") || "Inventory adjustment",
        usuario_id: user?.id ?? null,
      });
      if (logErr) avisosLocais.push(`${p.nome}: stock saved, but the history entry failed — ${logErr.message}`);
      // Log de atividade DETALHADO (Settings → Activity Logs).
      await log("updated", "inventory", p.id, p.sku ? `${p.nome} (${p.sku})` : p.nome, {
        category: catPath(p.categoria_id),
        qty_before: p.estoque_total, qty_after: q, difference: diff,
        reference: reference || null, memo: memo || null,
      });
      ok++;
      idsOk.push(p.id);
    }
    } catch (e: any) {
      // SEM este `catch`, uma excecao no laco virava rejeicao nao tratada:
      // parte dos produtos ja gravada, a grade mostrando o estoque VELHO, e
      // nenhum sinal para o operador. Numa contagem fisica e o pior desfecho
      // possivel — a tela mente sobre o estado do banco depois de uma gravacao
      // parcial.
      //
      // `abortou` escolhe o texto do toast e suprime o verde. Quem impede que
      // linha NAO PROCESSADA seja tratada como salva e o `idsOk` — e so ele.
      // Registrado assim de proposito: a versao anterior deste comentario dava o
      // credito a `abortou`, e quem mantivesse isto amanha poderia apagar o
      // `idsOk` achando que estava coberto — trazendo de volta a perda da
      // contagem fisica que este bloco existe para impedir.
      // A mensagem de aborto NAO entra em `failed`. `failed` e a lista de linhas
      // que o operador digitou e nao entraram — o card fala em nome dela ("a
      // quantidade que voce digitou continua na tabela"), e o aborto nao e uma
      // linha digitada.
      //
      // As duas versoes anteriores misturaram as duas coisas e tentaram separar
      // por PREFIXO no texto: primeiro "stopped: ", que colidia com produto de
      // mesmo nome, depois um caractere de controle, que transformou este arquivo
      // em binario para o git — justamente o arquivo que mais precisou de
      // revisao por diff. Variavel separada nao tem string magica para colidir.
      abortou = true;
      // `||`, nao `??`: `??` preserva string vazia, e um `Error("")` produzia
      // "Save stopped:  — 0 product(s)..." sem causa nenhuma no meio.
      msgAborto = e?.message || String(e);
    } finally {
      // `setSaving(false)` PRIMEIRO: se a liberacao lancar (rede caindo, sessao
      // expirando numa contagem longa), a tela nao pode ficar presa em "Saving".
      setSaving(false);
      try {
        const { error } = await supabase.rpc("set_suppress_stock_notify" as any, { _on: false, _minutos: 0 });
        if (error) console.error("[inventory] release stock suppression failed:", error.message);
      } catch (e) {
        // Nao aborta. Mas NAO e verdade que "a janela expira sozinha": se o `n`
        // ficar orfao, `ate` vencer nao levanta nada — o gatilho le
        // `ate > now() OR (n > 0 AND desde > now() - 120min)`. Quem destrava e a
        // EXPRESSAO DE LEITURA do gatilho (20260826090000), nao a auto-cura do
        // setter, que so roda na proxima chamada com `_on = true`. Ou seja: o
        // alerta de estoque pode ficar mudo por ate 2 HORAS, nao pelos minutos
        // desta janela — inclusive para cruzamento causado por checkout de
        // cliente. Nao aborta porque nao ha nada a proteger neste ponto, mas o
        // custo e esse, e nao e pequeno.
        console.error("[inventory] release stock suppression threw:", e);
      }
    }
    if (failed.length) {
      // Antes mostrava so o PRIMEIRO que falhou e limpava a grade inteira: as
      // linhas que nao entraram voltavam ao valor antigo, sem marcacao, e o dono
      // nao tinha como saber quais foram.
      // No caminho de ABORTO, um unico toast: antes somava o do `catch` a este e
      // ainda o verde do `ok > 0`, tres avisos ao mesmo tempo, um deles dizendo
      // sucesso. No caminho normal (linhas reprovadas na validacao) continuam
      // saindo DOIS — verde do que entrou, vermelho do que nao entrou — e ai
      // esta certo: o resultado e parcial de verdade.
      setFalhas(failed);
      toast.error(abortou
        ? `Save stopped: ${msgAborto} — ${ok} product(s) were saved before it stopped.`
        : `${failed.length} line(s) failed — see the list above the table.`);
    } else {
      setFalhas([]);
    }
    // O aborto tem toast proprio quando nenhuma linha falhou por validacao —
    // senao um erro de rede no primeiro produto sairia sem aviso nenhum.
    if (abortou && failed.length === 0) {
      toast.error(`Save stopped: ${msgAborto} — ${ok} product(s) were saved before it stopped.`);
    }
    setAvisos(avisosLocais);
    if (ok > 0 && !abortou) {
      toast.success(`${ok} product(s) adjusted.`);
    }
    if (ok > 0) {
      // So limpa o que REALMENTE entrou no banco — `idsOk` e preenchido linha a
      // linha, depois do UPDATE. Nunca inferido a partir de `failed`.
      const entrou = new Set(idsOk);
      setNewQty((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !entrou.has(id))));
      // `avisosLocais` tambem segura o Ref/Memo: eles montam o `motivo` do
      // `estoque_log`, e o card ambar acabou de dizer ao operador que o historico
      // daquelas linhas NAO foi gravado. Apagar o texto que ele precisa para
      // refazer a entrada a mao seria tirar a corda de quem esta pendurado. A
      // condicao ficou presa em `failed` quando a lista foi partida em duas.
      if (failed.length === 0 && avisosLocais.length === 0 && !abortou) { setReference(""); setMemo(""); }
    }
    // INCONDICIONAL. O `update produtos` acontece ANTES do `ok++`, entao uma
    // excecao no `estoque_log` ou no `log()` deixa o banco JA gravado com
    // `ok === 0` — e a versao anterior, que so recarregava dentro de
    // `if (ok > 0)`, deixava a grade mostrando o estoque velho justamente ai.
    fetchData();
  };

  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Inventory Adjustment</h2>
          <p className="text-sm text-muted-foreground">Enter the new quantity only on the lines you need to change, then Save. Every change is recorded in the Activity Logs.</p>
        </div>
        <Button onClick={save} disabled={saving || changes.length === 0} className="gap-1">
          <Save className="h-4 w-4" /> {saving ? "Saving..." : `Save${changes.length ? ` (${changes.length})` : ""}`}
        </Button>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><Label className="text-xs text-primary">Adjustment date</Label><Input value={today} disabled className="h-9" /></div>
          <div><Label className="text-xs text-primary">Reference No.</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" /></div>
          <div className="col-span-2"><Label className="text-xs text-primary">Memo</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. weekly count, damaged items..." className="h-9" /></div>
        </div>
        <div className="relative mt-3 sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by product, SKU or category..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {avisos.length > 0 && (
        <Card className="mb-4 border-amber-500/50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-600">
            {avisos.length} line(s): the stock WAS saved, but the history entry failed.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Card>
      )}
      {falhas.length > 0 && (
        <Card className="mb-4 border-destructive/50 p-4">
          <p className="mb-2 text-sm font-semibold text-destructive">
            {falhas.length} line(s) were NOT saved — the quantity you typed is still in the table:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {falhas.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </Card>
      )}
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="nome" label="Item" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead k="categoria" label="Category" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead k="estoque" label="Qty on Hand" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="text-right" />
                <TableHead className="w-36 text-right">New Quantity</TableHead>
                <TableHead className="text-right">Qty Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const raw = (newQty[p.id] ?? "").trim();
                const q = raw === "" ? null : parseInt(raw);
                const diff = q !== null && Number.isFinite(q) ? q - p.estoque_total : null;
                return (
                  <TableRow key={p.id} className={diff !== null && diff !== 0 ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">{p.nome}{p.sku && <span className="text-xs text-muted-foreground"> ({p.sku})</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{catPath(p.categoria_id)}</TableCell>
                    <TableCell className="text-right">{p.estoque_total}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={0} value={newQty[p.id] ?? ""} placeholder="—"
                        onChange={(e) => setNewQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="h-8 w-28 ml-auto text-right" />
                    </TableCell>
                    <TableCell className={`text-right text-sm font-medium ${diff === null || diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-green-600" : "text-red-600"}`}>
                      {diff === null || diff === 0 ? "—" : diff > 0 ? `+${diff}` : diff}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No products found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default InventoryAdjustment;
