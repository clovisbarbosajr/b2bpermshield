import { useState, useEffect, useMemo } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Factory, Truck, MapPin, ChevronRight, PackageCheck, X } from "lucide-react";

type Item = {
  id: string; quantidade: number; status: string; tracking: string | null;
  numero_container: string | null; est_entrega: string | null;
  produtos: { nome: string; sku: string; categoria_id: string | null } | null;
};
type Categoria = { id: string; nome: string; parent_id: string | null };
type Loc = { name: string; items: Item[]; qty: number; onTheWay: number };

const ProducaoDashboard = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLoc, setOpenLoc] = useState<Loc | null>(null);

  useEffect(() => {
    const load = async () => {
      const [it, cat] = await Promise.all([
        supabase.from("producao_pedidos").select("id, quantidade, status, tracking, numero_container, est_entrega, produtos(nome, sku, categoria_id)").neq("status", "delivered"),
        supabase.from("categorias").select("id, nome, parent_id"),
      ]);
      setItems((it.data as any[]) ?? []);
      setCategorias((cat.data as Categoria[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const locations = useMemo<Loc[]>(() => {
    const catById = new Map(categorias.map((c) => [c.id, c]));
    const topName = (catId: string | null): string => {
      let cur = catId ? catById.get(catId) : undefined;
      if (!cur) return "Unassigned";
      while (cur.parent_id && catById.get(cur.parent_id)) cur = catById.get(cur.parent_id)!;
      return cur.nome;
    };
    const map = new Map<string, Loc>();
    for (const it of items) {
      const name = topName(it.produtos?.categoria_id ?? null);
      if (!map.has(name)) map.set(name, { name, items: [], qty: 0, onTheWay: 0 });
      const e = map.get(name)!;
      e.items.push(it); e.qty += it.quantidade;
      if (it.status === "a_caminho") e.onTheWay += 1;
    }
    // Ordem ALFABÉTICA (antes era por volume de unidades, o que parecia aleatório).
    // Itens do drill-down também em ordem alfabética de produto.
    const locs = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    locs.forEach((l) => l.items.sort((x, y) => (x.produtos?.nome ?? "").localeCompare(y.produtos?.nome ?? "")));
    return locs;
  }, [items, categorias]);

  return (
    <AdminLayout>
      <div className="mb-8">
        <h2 className="font-display text-3xl font-bold">Production by location</h2>
        <p className="text-base text-muted-foreground mt-1">Tap a location to see everything in production there.</p>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground text-lg">Loading…</div>
      ) : locations.length === 0 ? (
        <Card className="p-16 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
          <Factory className="h-12 w-12 opacity-40" />
          <p className="text-lg">Nothing in production right now.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {locations.map((loc) => {
            const arriving = loc.onTheWay > 0;
            return (
              <button
                key={loc.name}
                onClick={() => setOpenLoc((cur) => (cur?.name === loc.name ? null : loc))}
                className={`group relative text-left rounded-2xl border-2 p-6 transition-all hover:shadow-lg hover:-translate-y-0.5
                  ${openLoc?.name === loc.name ? "ring-2 ring-primary ring-offset-2" : ""}
                  ${arriving ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : "border-border bg-card hover:border-primary/40"}`}
              >
                {arriving && (
                  <span className="absolute top-4 right-4 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500" />
                  </span>
                )}
                <div className="flex items-center gap-2 text-primary mb-4">
                  <MapPin className="h-6 w-6" />
                  <h3 className="text-2xl font-bold">{loc.name}</h3>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-5xl font-extrabold leading-none">{loc.qty.toLocaleString()}</span>
                  <span className="text-lg text-muted-foreground mb-1">units</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="text-sm px-3 py-1">{loc.items.length} item{loc.items.length !== 1 ? "s" : ""}</Badge>
                    {arriving && <Badge className="text-sm px-3 py-1 gap-1 bg-blue-600"><Truck className="h-3.5 w-3.5" /> {loc.onTheWay} on the way</Badge>}
                  </div>
                  <ChevronRight className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Drill-down INLINE (mesma página, não popup) */}
      {openLoc && (
        <Card className="mt-6 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-2xl font-bold"><MapPin className="h-6 w-6 text-primary" /> {openLoc.name}</h3>
            <button onClick={() => setOpenLoc(null)} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1"><X className="h-4 w-4" /> Close</button>
          </div>
          <div className="space-y-2">
            {openLoc.items.map((it) => {
              const arriving = it.status === "a_caminho";
              return (
                <div key={it.id} className={`rounded-xl border p-4 flex items-center justify-between ${arriving ? "border-blue-300 bg-blue-50/40 dark:bg-blue-950/10" : "border-border"}`}>
                  <div>
                    <p className="text-lg font-semibold">{it.produtos?.nome ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {it.numero_container ? `Container ${it.numero_container}` : "No container"}
                      {it.tracking ? ` · ${it.tracking}` : ""}
                      {it.est_entrega ? ` · est. ${it.est_entrega}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold">{it.quantidade}</span>
                    {arriving ? (
                      <Badge className="gap-1 bg-blue-600 text-sm px-3 py-1"><Truck className="h-3.5 w-3.5" /> On the way</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-sm px-3 py-1">Requested</Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {openLoc.items.length === 0 && <p className="text-center text-muted-foreground py-6">No items.</p>}
          </div>
        </Card>
      )}
    </AdminLayout>
  );
};

export default ProducaoDashboard;
