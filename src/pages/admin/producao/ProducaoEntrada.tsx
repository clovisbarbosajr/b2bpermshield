import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { restringeLocais } from "@/lib/restringeLocais";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/hooks/useActivityLog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

type Produto = { id: string; nome: string; sku: string; categoria_id: string | null };
type Categoria = { id: string; nome: string; parent_id: string | null };
type Line = { key: string; categoria_id: string; produto_id: string; quantidade: string; est_ready: string; est_entrega: string; numero_ordem: string; numero_container: string };

let LINE_SEQ = 0;
const newLine = (): Line => ({ key: `l${++LINE_SEQ}`, categoria_id: "", produto_id: "", quantidade: "", est_ready: "", est_entrega: "", numero_ordem: "", numero_container: "" });

const ProducaoEntrada = () => {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { log } = useActivityLog();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [allowedLocs, setAllowedLocs] = useState<Set<string>>(new Set());
  // Guardado separado de `allowedLocs` de PROPOSITO: "nao tem local cadastrado" e
  // "nao consegui ler os locais" davam os dois um Set vazio, e o vazio abria a
  // tela inteira. Ver o comentario em `restricted`.
  const [erro, setErro] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      // `fetchAllRows` LANCA em erro, e e isso que se quer aqui: as tres leituras
      // ignoravam `error` e caiam no `?? []`. Uma falha de rede ou de RLS deixava a
      // tela sem produto nenhum, sem uma palavra — e, no caso dos locais, ABRIA o
      // acesso (ver `restricted`). E paginado porque `.select()` sem `.range()` para
      // em 1000 linhas com `error: null`; o operador simplesmente nao acha o produto.
      try {
        const [p, c, ul] = await Promise.all([
          fetchAllRows<Produto>((f, t) => supabase.from("produtos").select("id, nome, sku, categoria_id").eq("ativo", true).order("id", { ascending: true }).range(f, t)),
          fetchAllRows<Categoria>((f, t) => supabase.from("categorias").select("id, nome, parent_id").eq("ativo", true).order("id", { ascending: true }).range(f, t)),
          fetchAllRows<any>((f, t) => supabase.from("user_locations").select("id, categoria_id").eq("user_id", user?.id ?? "").order("categoria_id", { ascending: true }).range(f, t)),
        ]);
        setProdutos([...p].sort((x, y) => x.nome.localeCompare(y.nome)));
        setCategorias(c);
        setAllowedLocs(new Set(ul.map((x) => x.categoria_id)));
        setErro(null);
      } catch (e: any) {
        setErro(e?.message ?? String(e));
        setProdutos([]); setCategorias([]); setAllowedLocs(new Set());
      }
    };
    if (user) load();
  }, [user]);

  // Produtos agrupados pela categoria REAL (id) — não pelo nome. Antes, categorias
  // homônimas em estados diferentes (ex.: "One Plus" em 3 estados) viravam UM grupo só
  // e ficava impossível saber qual é qual. Agora cada categoria é um grupo, rotulado
  // com o CAMINHO completo (Estado › ... › One Plus).
  const grouped = useMemo(() => {
    const catById = new Map(categorias.map((c) => [c.id, c]));
    const topId = (catId: string | null): string | null => {
      let cur = catId ? catById.get(catId) : undefined;
      if (!cur) return null;
      // `guard`: sem ele, um `parent_id` circular travava esta tela (o `catById.get`
      // sempre acha e o laço não sai). Mesma correção do ProducaoDashboard.
      let guard = 0;
      while (cur.parent_id && catById.get(cur.parent_id) && guard++ < 12) cur = catById.get(cur.parent_id)!;
      return cur.id;
    };
    // Caminho "Pai › Filho" do topo até a categoria imediata.
    const catPath = (catId: string | null): string => {
      const chain: string[] = [];
      let cur = catId ? catById.get(catId) : undefined;
      let guard = 0;
      while (cur && guard++ < 12) { chain.unshift(cur.nome); cur = cur.parent_id ? catById.get(cur.parent_id) : undefined; }
      return chain.length ? chain.join(" › ") : "Uncategorized";
    };
    // Restricao: se o usuario tem locais e nao e admin, so mostra produtos desses
    // locais. A regra mora em `lib/restringeLocais` porque tem um caso que a
    // leitura sozinha nao mostra e um teste mostra — ver la.
    const restricted = restringeLocais(role, allowedLocs.size, erro);
    const groups = new Map<string, { id: string; path: string; prods: Produto[] }>();
    for (const p of produtos) {
      if (restricted) {
        const t = topId(p.categoria_id);
        if (!t || !allowedLocs.has(t)) continue;
      }
      const key = p.categoria_id ?? "__uncat__";
      if (!groups.has(key)) groups.set(key, { id: key, path: catPath(p.categoria_id), prods: [] });
      groups.get(key)!.prods.push(p);
    }
    return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [produtos, categorias, allowedLocs, role, erro]);

  // Produtos da categoria selecionada numa linha (o 2º select puxa só desses).
  const prodsOfCat = (catId: string): Produto[] => grouped.find((g) => g.id === catId)?.prods ?? [];

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (key: string) => setLines((prev) => prev.length > 1 ? prev.filter((l) => l.key !== key) : prev);

  const save = async () => {
    const valid = lines.filter((l) => l.produto_id && parseInt(l.quantidade) > 0);
    if (valid.length === 0) { toast.error("Add at least one product with a quantity."); return; }
    const incomplete = lines.find((l) => (l.produto_id && !(parseInt(l.quantidade) > 0)) || (!l.produto_id && parseInt(l.quantidade) > 0));
    if (incomplete) { toast.error("Each line needs both a product and a quantity."); return; }

    setSaving(true);
    const rows = valid.map((l) => ({
      produto_id: l.produto_id,
      quantidade: parseInt(l.quantidade),
      est_ready: l.est_ready || null,
      est_entrega: l.est_entrega || null,
      numero_ordem: l.numero_ordem || null,
      numero_container: l.numero_container || null,
      // Container # é o rastreio na prática (frete marítimo): já nasce como tracking,
      // sem precisar redigitar na tela de Status.
      tracking: l.numero_container.trim() || null,
      // Regra: entrada JÁ com container = mercadoria embarcada → nasce "On the way".
      status: l.numero_container.trim() ? "a_caminho" : "solicitado",
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("producao_pedidos").insert(rows as any);
    setSaving(false);
    if (error) { toast.error("Error: " + error.message); return; }
    // Log de atividade: uma entrada por linha criada (aparece em Activity Logs).
    const prodById = new Map(produtos.map((p) => [p.id, p]));
    for (const l of valid) {
      const p = prodById.get(l.produto_id);
      log("created", "production", l.produto_id, `${p?.nome ?? "Item"} (qty ${l.quantidade})`, {
        sku: p?.sku ?? null, qty: parseInt(l.quantidade), est_ready: l.est_ready || null,
        eta: l.est_entrega || null, order_no: l.numero_ordem || null, container: l.numero_container || null,
        status: l.numero_container.trim() ? "a_caminho" : "solicitado",
      });
    }
    toast.success(`${rows.length} production item(s) saved.`);
    navigate("/admin/producao/status");
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Production — New entry</h2>
          <p className="text-sm text-muted-foreground">Register products going into production. This does NOT add to inventory — it enters stock only when received.</p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-1"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}</Button>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-semibold">Products and locations could not be loaded — nothing is being shown.</p>
          <p className="mt-1 text-sm text-muted-foreground">{erro}</p>
        </div>
      )}

      <div className="space-y-3">
        {lines.map((l, idx) => (
          <Card key={l.key} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <Label>Category *</Label>
                <Select value={l.categoria_id} onValueChange={(v) => setLine(l.key, { categoria_id: v, produto_id: "" })}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="Choose category" /></SelectTrigger>
                  <SelectContent className="max-h-[460px] min-w-[300px]">
                    {grouped.map((g) => (
                      <SelectItem key={g.id} value={g.id} className="text-base py-2.5">{g.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Product *</Label>
                <Select value={l.produto_id} onValueChange={(v) => setLine(l.key, { produto_id: v })} disabled={!l.categoria_id}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder={l.categoria_id ? "Choose product" : "Pick a category first"} /></SelectTrigger>
                  <SelectContent className="max-h-[460px] min-w-[300px]">
                    {prodsOfCat(l.categoria_id).map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-base py-2.5">{p.nome}{p.sku && <span className="text-xs text-muted-foreground"> ({p.sku})</span>}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1">
                <Label>Qty *</Label>
                <Input type="number" min={1} value={l.quantidade} onChange={(e) => setLine(l.key, { quantidade: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>Est Ready</Label>
                <Input type="date" value={l.est_ready} onChange={(e) => setLine(l.key, { est_ready: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>ETA</Label>
                <Input type="date" value={l.est_entrega} onChange={(e) => setLine(l.key, { est_entrega: e.target.value })} />
              </div>
              <div className="md:col-span-1">
                <Label>Order #</Label>
                <Input value={l.numero_ordem} onChange={(e) => setLine(l.key, { numero_ordem: e.target.value })} />
              </div>
              <div className="md:col-span-1">
                <Label>Container #</Label>
                <Input value={l.numero_container} onChange={(e) => setLine(l.key, { numero_container: e.target.value })} />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <Button size="icon" variant="ghost" onClick={() => removeLine(l.key)} disabled={lines.length === 1} title="Remove line">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-3">
        <Button variant="outline" onClick={addLine} className="gap-1"><Plus className="h-4 w-4" /> Add another product</Button>
      </div>
    </AdminLayout>
  );
};

export default ProducaoEntrada;
