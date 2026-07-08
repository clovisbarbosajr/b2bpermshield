import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
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

  const fetchData = async () => {
    const [prod, cat] = await Promise.all([
      supabase.from("produtos").select("id, nome, sku, categoria_id, estoque_total").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome, parent_id").eq("ativo", true),
    ]);
    setProdutos((prod.data as Produto[]) ?? []);
    setCategorias((cat.data as Categoria[]) ?? []);
    setLoading(false);
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
    let ok = 0; const failed: string[] = [];
    for (const { p, q, diff } of changes) {
      const { error } = await supabase.from("produtos").update({ estoque_total: q }).eq("id", p.id);
      if (error) { failed.push(`${p.nome}: ${error.message}`); continue; }
      // Histórico de estoque (mesma tabela que o ajuste unitário da tela Inventory usa).
      await supabase.from("estoque_log").insert({
        produto_id: p.id, quantidade_anterior: p.estoque_total, quantidade_nova: q,
        motivo: [reference && `Ref ${reference}`, memo].filter(Boolean).join(" — ") || "Inventory adjustment",
        usuario_id: user?.id ?? null,
      });
      // Log de atividade DETALHADO (Settings → Activity Logs).
      await log("updated", "inventory", p.id, p.sku ? `${p.nome} (${p.sku})` : p.nome, {
        category: catPath(p.categoria_id),
        qty_before: p.estoque_total, qty_after: q, difference: diff,
        reference: reference || null, memo: memo || null,
      });
      ok++;
    }
    setSaving(false);
    if (failed.length) toast.error(`${failed.length} failed: ${failed[0]}`);
    if (ok > 0) {
      toast.success(`${ok} product(s) adjusted.`);
      setNewQty({}); setReference(""); setMemo("");
      fetchData();
    }
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
