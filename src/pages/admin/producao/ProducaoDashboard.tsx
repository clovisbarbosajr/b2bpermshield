import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Factory, Truck, ClipboardList, MapPin, Package } from "lucide-react";

type Item = { id: string; quantidade: number; status: string; produto_id: string };
type Produto = { id: string; nome: string; categoria_id: string | null };
type Categoria = { id: string; nome: string; parent_id: string | null };

const ProducaoDashboard = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [it, pr, cat] = await Promise.all([
        supabase.from("producao_pedidos").select("id, quantidade, status, produto_id").neq("status", "delivered"),
        supabase.from("produtos").select("id, nome, categoria_id"),
        supabase.from("categorias").select("id, nome, parent_id"),
      ]);
      setItems((it.data as Item[]) ?? []);
      setProdutos((pr.data as Produto[]) ?? []);
      setCategorias((cat.data as Categoria[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  // Resolve a LOCALIZAÇÃO = categoria de TOPO do produto (sobe pelo parent_id).
  const byLocation = useMemo(() => {
    const catById = new Map(categorias.map((c) => [c.id, c]));
    const topName = (catId: string | null): string => {
      let cur = catId ? catById.get(catId) : undefined;
      if (!cur) return "Unassigned";
      while (cur.parent_id && catById.get(cur.parent_id)) cur = catById.get(cur.parent_id)!;
      return cur.nome;
    };
    const prodById = new Map(produtos.map((p) => [p.id, p]));
    const map = new Map<string, { items: number; qty: number; requested: number; onTheWay: number }>();
    for (const it of items) {
      const prod = prodById.get(it.produto_id);
      const loc = topName(prod?.categoria_id ?? null);
      if (!map.has(loc)) map.set(loc, { items: 0, qty: 0, requested: 0, onTheWay: 0 });
      const e = map.get(loc)!;
      e.items += 1; e.qty += it.quantidade;
      if (it.status === "solicitado") e.requested += 1;
      if (it.status === "a_caminho") e.onTheWay += 1;
    }
    return [...map.entries()].sort((a, b) => b[1].qty - a[1].qty);
  }, [items, produtos, categorias]);

  const totals = useMemo(() => byLocation.reduce((a, [, v]) => ({
    items: a.items + v.items, qty: a.qty + v.qty, requested: a.requested + v.requested, onTheWay: a.onTheWay + v.onTheWay,
  }), { items: 0, qty: 0, requested: 0, onTheWay: 0 }), [byLocation]);

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Production — Dashboard</h2>
          <p className="text-sm text-muted-foreground">Items currently in production, by location.</p>
        </div>
        <Link to="/admin/producao/status" className="text-sm text-primary hover:underline">Open Status →</Link>
      </div>

      {/* Totais gerais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Locations", value: byLocation.length, icon: MapPin },
          { label: "Items in production", value: totals.items, icon: Factory },
          { label: "Total units", value: totals.qty.toLocaleString(), icon: Package },
          { label: "On the way", value: totals.onTheWay, icon: Truck },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><s.icon className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      ) : byLocation.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
          <Factory className="h-10 w-10 opacity-40" />
          <p>Nothing in production right now.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {byLocation.map(([loc, v]) => (
            <Card key={loc} className="overflow-hidden">
              <div className="bg-primary/10 px-4 py-3 flex items-center gap-2 border-b border-border">
                <MapPin className="h-4 w-4 text-primary" />
                <h3 className="font-bold text-primary">{loc}</h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold">{v.qty.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">units across {v.items} item{v.items !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="gap-1"><ClipboardList className="h-3 w-3" /> {v.requested} requested</Badge>
                  <Badge variant="default" className="gap-1"><Truck className="h-3 w-3" /> {v.onTheWay} on the way</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
};

export default ProducaoDashboard;
