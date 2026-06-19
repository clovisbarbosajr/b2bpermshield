import { useState, useEffect, useMemo } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, Truck, PackageCheck, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; produto_id: string; quantidade: number; est_entrega: string | null; numero_ordem: string | null;
  numero_container: string | null; status: string; tracking: string | null;
  quantidade_recebida: number | null; recebido_em: string | null; created_at: string;
  produtos: { nome: string; sku: string } | null;
};
type Produto = { id: string; nome: string; sku: string; categoria_id: string | null };
type Categoria = { id: string; nome: string };

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "outline" }> = {
  solicitado: { label: "Requested", variant: "secondary" },
  a_caminho: { label: "On the way", variant: "default" },
  delivered: { label: "Delivered", variant: "outline" },
};

const ProducaoStatus = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingEdit, setTrackingEdit] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [recvQty, setRecvQty] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ produto_id: "", quantidade: "", est_entrega: "", numero_ordem: "", numero_container: "" });

  const load = async () => {
    const [pr, prod, cat] = await Promise.all([
      supabase.from("producao_pedidos").select("id, produto_id, quantidade, est_entrega, numero_ordem, numero_container, status, tracking, quantidade_recebida, recebido_em, created_at, produtos(nome, sku)").order("created_at", { ascending: false }),
      supabase.from("produtos").select("id, nome, sku, categoria_id").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    setRows((pr.data as any[]) ?? []);
    setProdutos((prod.data as Produto[]) ?? []);
    setCategorias((cat.data as Categoria[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

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

  const saveTracking = async (r: Row) => {
    const tracking = (trackingEdit[r.id] ?? r.tracking ?? "").trim();
    const patch: any = { tracking: tracking || null };
    if (tracking && r.status === "solicitado") patch.status = "a_caminho";
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update(patch).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved"); load();
  };

  const markOnTheWay = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update({ status: "a_caminho" }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const startReceive = (r: Row) => { setReceivingId(r.id); setRecvQty(String(r.quantidade)); };

  const checkIn = async (r: Row) => {
    const q = parseInt(recvQty);
    if (!(q >= 0)) { toast.error("Enter a valid received quantity."); return; }
    if (!confirm(`Receive ${q} of "${r.produtos?.nome}"? This adds ${q} to inventory and cannot be undone here.`)) return;
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos")
      .update({ status: "delivered", quantidade_recebida: q, recebido_em: new Date().toISOString(), recebido_por: user?.id ?? null }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(`Received — ${q} added to inventory.`);
    setReceivingId(null); load();
  };

  const openEdit = (r: Row) => {
    setEditRow(r);
    setEditForm({ produto_id: r.produto_id, quantidade: String(r.quantidade), est_entrega: r.est_entrega ?? "", numero_ordem: r.numero_ordem ?? "", numero_container: r.numero_container ?? "" });
  };
  const saveEdit = async () => {
    if (!editRow) return;
    if (!editForm.produto_id || !(parseInt(editForm.quantidade) > 0)) { toast.error("Product and quantity are required."); return; }
    const { error } = await supabase.from("producao_pedidos").update({
      produto_id: editForm.produto_id, quantidade: parseInt(editForm.quantidade),
      est_entrega: editForm.est_entrega || null, numero_ordem: editForm.numero_ordem || null, numero_container: editForm.numero_container || null,
    }).eq("id", editRow.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Updated"); setEditRow(null); load();
  };

  const remove = async (r: Row) => {
    if (!confirm(`Delete this production item ("${r.produtos?.nome}")? This cannot be undone.`)) return;
    const { error } = await supabase.from("producao_pedidos").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted"); load();
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Production — Status</h2>
        <p className="text-sm text-muted-foreground">Track items, add tracking, edit/delete pending ones, and check in received goods (adds to inventory at the product's location).</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Est. delivery</TableHead>
              <TableHead>Order # / Container</TableHead><TableHead className="min-w-[190px]">Tracking</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nothing in production yet.</TableCell></TableRow>
            ) : rows.map((r) => {
              const b = STATUS_BADGE[r.status] ?? { label: r.status, variant: "outline" as const };
              const isDelivered = r.status === "delivered";
              const isReceiving = receivingId === r.id;
              return (
                <TableRow key={r.id} className={isDelivered ? "bg-muted/20" : ""}>
                  <TableCell className="font-medium">{r.produtos?.nome ?? "—"} <span className="text-xs text-muted-foreground">({r.produtos?.sku ?? ""})</span></TableCell>
                  <TableCell>{r.quantidade}{r.quantidade_recebida != null && r.quantidade_recebida !== r.quantidade && (<span className="text-xs text-amber-600"> → {r.quantidade_recebida} recv.</span>)}</TableCell>
                  <TableCell>{r.est_entrega ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.numero_ordem ?? "—"}{r.numero_container ? ` / ${r.numero_container}` : ""}</TableCell>
                  <TableCell>
                    {isDelivered ? <span className="text-sm">{r.tracking ?? "—"}</span> : (
                      <div className="flex gap-1">
                        <Input className="h-8" placeholder="Tracking #" value={trackingEdit[r.id] ?? r.tracking ?? ""} onChange={(e) => setTrackingEdit((p) => ({ ...p, [r.id]: e.target.value }))} />
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => saveTracking(r)}>Save</Button>
                      </div>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={b.variant} className="gap-1">{r.status === "a_caminho" && <Truck className="h-3 w-3" />}{isDelivered && <PackageCheck className="h-3 w-3" />}{b.label}</Badge></TableCell>
                  <TableCell className="text-right">
                    {isDelivered ? (
                      <span className="text-xs text-muted-foreground">{r.recebido_em ? new Date(r.recebido_em).toLocaleDateString() : "received"}</span>
                    ) : isReceiving ? (
                      <div className="flex items-center gap-2 justify-end">
                        <Input type="number" min={0} className="h-8 w-20" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} title="Received quantity" />
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy === r.id} onClick={() => checkIn(r)}><Check className="h-4 w-4" /> Check in</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReceivingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === "solicitado" && (
                          <Button size="sm" variant="outline" className="gap-1" disabled={busy === r.id} onClick={() => markOnTheWay(r)}><Truck className="h-4 w-4" /> On the way</Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => startReceive(r)}><PackageCheck className="h-4 w-4" /> Receive</Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground mt-3">"Receive" lets you adjust the quantity if less arrived than ordered (e.g., ordered 10, got 8), then the green Check in adds the received quantity to inventory. Delivered items can't be edited/deleted here (already in stock).</p>

      {/* Editar item de produção (não-recebido) */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit production item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product *</Label>
              <Select value={editForm.produto_id} onValueChange={(v) => setEditForm((f) => ({ ...f, produto_id: v }))}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Choose product" /></SelectTrigger>
                <SelectContent className="max-h-[400px]">
                  {grouped.map(([cat, prods]) => (
                    <SelectGroup key={cat}>
                      <SelectLabel className="text-primary font-bold text-sm uppercase bg-primary/10 px-2 py-1.5 my-1 rounded-sm">{cat}</SelectLabel>
                      {prods.map((p) => <SelectItem key={p.id} value={p.id} className="py-2 pl-4">{p.nome} <span className="text-xs text-muted-foreground">({p.sku})</span></SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantity *</Label><Input type="number" min={1} value={editForm.quantidade} onChange={(e) => setEditForm((f) => ({ ...f, quantidade: e.target.value }))} /></div>
              <div><Label>Est. delivery</Label><Input type="date" value={editForm.est_entrega} onChange={(e) => setEditForm((f) => ({ ...f, est_entrega: e.target.value }))} /></div>
              <div><Label>Order #</Label><Input value={editForm.numero_ordem} onChange={(e) => setEditForm((f) => ({ ...f, numero_ordem: e.target.value }))} /></div>
              <div><Label>Container #</Label><Input value={editForm.numero_container} onChange={(e) => setEditForm((f) => ({ ...f, numero_container: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ProducaoStatus;
