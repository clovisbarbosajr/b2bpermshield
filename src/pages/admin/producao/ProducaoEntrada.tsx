import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

type Produto = { id: string; nome: string; sku: string; categoria_id: string | null };
type Categoria = { id: string; nome: string };
type Line = { key: string; produto_id: string; quantidade: string; est_entrega: string; numero_ordem: string; numero_container: string };

let LINE_SEQ = 0;
const newLine = (): Line => ({ key: `l${++LINE_SEQ}`, produto_id: "", quantidade: "", est_entrega: "", numero_ordem: "", numero_container: "" });

const ProducaoEntrada = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [p, c] = await Promise.all([
        supabase.from("produtos").select("id, nome, sku, categoria_id").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      setProdutos((p.data as Produto[]) ?? []);
      setCategorias((c.data as Categoria[]) ?? []);
    };
    load();
  }, []);

  // Produtos agrupados por categoria (a "localização") para o dropdown.
  const grouped = useMemo(() => {
    const catName = new Map(categorias.map((c) => [c.id, c.nome]));
    const groups = new Map<string, Produto[]>();
    for (const p of produtos) {
      const g = p.categoria_id ? (catName.get(p.categoria_id) ?? "Uncategorized") : "Uncategorized";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(p);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [produtos, categorias]);

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
      est_entrega: l.est_entrega || null,
      numero_ordem: l.numero_ordem || null,
      numero_container: l.numero_container || null,
      status: "solicitado",
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("producao_pedidos").insert(rows);
    setSaving(false);
    if (error) { toast.error("Error: " + error.message); return; }
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

      <div className="space-y-3">
        {lines.map((l, idx) => (
          <Card key={l.key} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <Label>Product *</Label>
                <Select value={l.produto_id} onValueChange={(v) => setLine(l.key, { produto_id: v })}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="Choose product (by category)" /></SelectTrigger>
                  <SelectContent className="max-h-[460px] min-w-[380px]">
                    {grouped.map(([cat, prods]) => (
                      <SelectGroup key={cat}>
                        <SelectLabel className="text-primary font-bold text-sm uppercase tracking-wide bg-primary/10 px-2 py-2 my-1 rounded-sm">{cat}</SelectLabel>
                        {prods.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-base py-2.5 pl-4">{p.nome} <span className="text-xs text-muted-foreground">({p.sku})</span></SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Quantity *</Label>
                <Input type="number" min={1} value={l.quantidade} onChange={(e) => setLine(l.key, { quantidade: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>Est. delivery</Label>
                <Input type="date" value={l.est_entrega} onChange={(e) => setLine(l.key, { est_entrega: e.target.value })} />
              </div>
              <div className="md:col-span-2">
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

      <div className="mt-3 flex items-center justify-between">
        <Button variant="outline" onClick={addLine} className="gap-1"><Plus className="h-4 w-4" /> Add another product</Button>
        <Button onClick={save} disabled={saving} className="gap-1"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}</Button>
      </div>
    </AdminLayout>
  );
};

export default ProducaoEntrada;
