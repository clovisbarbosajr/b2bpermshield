import { useState, useEffect, useMemo } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/hooks/useActivityLog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, Truck, PackageCheck, Pencil, Trash2, ChevronDown, ChevronRight, StickyNote, Copy } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; produto_id: string; quantidade: number; est_ready: string | null; est_entrega: string | null; numero_ordem: string | null;
  numero_container: string | null; status: string; tracking: string | null; notes: string | null;
  quantidade_recebida: number | null; recebido_em: string | null; created_at: string;
  produtos: { nome: string; sku: string } | null;
};
type Produto = { id: string; nome: string; sku: string; categoria_id: string | null };
type Categoria = { id: string; nome: string; parent_id: string | null };

const fmtDT = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const ProducaoStatus = () => {
  const { user } = useAuth();
  const { log } = useActivityLog();
  const [rows, setRows] = useState<Row[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingEdit, setTrackingEdit] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [recvQty, setRecvQty] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ produto_id: "", quantidade: "", est_ready: "", est_entrega: "", numero_ordem: "", numero_container: "", status: "solicitado" });
  const [showReceived, setShowReceived] = useState(false);
  const [notesRow, setNotesRow] = useState<Row | null>(null);
  const [notesText, setNotesText] = useState("");

  const load = async () => {
    const [pr, prod, cat] = await Promise.all([
      supabase.from("producao_pedidos").select("id, produto_id, quantidade, est_ready, est_entrega, numero_ordem, numero_container, status, tracking, notes, quantidade_recebida, recebido_em, created_at, produtos(nome, sku)").order("created_at", { ascending: false }),
      supabase.from("produtos").select("id, nome, sku, categoria_id").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome, parent_id").eq("ativo", true).order("nome"),
    ]);
    setRows((pr.data as any[]) ?? []);
    setProdutos((prod.data as Produto[]) ?? []);
    setCategorias((cat.data as Categoria[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const active = useMemo(() => rows.filter((r) => r.status !== "delivered"), [rows]);
  const received = useMemo(() => rows.filter((r) => r.status === "delivered"), [rows]);

  // Agrupa pela categoria REAL (id) e rotula com o caminho completo (Estado › ... › One Plus)
  // — categorias homônimas em estados diferentes ficavam misturadas num grupo só.
  const grouped = useMemo(() => {
    const catById = new Map(categorias.map((c) => [c.id, c]));
    const catPath = (catId: string | null): string => {
      const chain: string[] = [];
      let cur = catId ? catById.get(catId) : undefined;
      let guard = 0;
      while (cur && guard++ < 12) { chain.unshift(cur.nome); cur = cur.parent_id ? catById.get(cur.parent_id) : undefined; }
      return chain.length ? chain.join(" › ") : "Uncategorized";
    };
    const groups = new Map<string, { path: string; prods: Produto[] }>();
    for (const p of produtos) {
      const key = p.categoria_id ?? "__uncat__";
      if (!groups.has(key)) groups.set(key, { path: catPath(p.categoria_id), prods: [] });
      groups.get(key)!.prods.push(p);
    }
    return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [produtos, categorias]);

  const clearTrackingEdit = (id: string) => setTrackingEdit((p) => { const n = { ...p }; delete n[id]; return n; });

  const saveTracking = async (r: Row) => {
    const tracking = (trackingEdit[r.id] ?? r.tracking ?? "").trim();
    const patch: any = { tracking: tracking || null };
    if (tracking && r.status === "solicitado") patch.status = "a_caminho";
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update(patch).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    log("updated", "production", r.id, `${r.produtos?.nome ?? "Item"} (qty ${r.quantidade})`, { field: "tracking", tracking: tracking || null, ...(patch.status ? { status: patch.status } : {}) });
    clearTrackingEdit(r.id);
    toast.success("Tracking saved"); load();
  };

  // "On the way" também SALVA o tracking pendente (antes sumia ao avançar o status).
  const goOnTheWay = async (r: Row) => {
    const tracking = (trackingEdit[r.id] ?? r.tracking ?? "").trim();
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update({ status: "a_caminho", tracking: tracking || null }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    log("updated", "production", r.id, `${r.produtos?.nome ?? "Item"} (qty ${r.quantidade})`, { status: "a_caminho", tracking: tracking || null });
    clearTrackingEdit(r.id); load();
  };

  const setStatus = async (r: Row, status: string) => {
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update({ status }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    log("updated", "production", r.id, `${r.produtos?.nome ?? "Item"} (qty ${r.quantidade})`, { status_before: r.status, status_after: status });
    load();
  };

  const openNotes = (r: Row) => { setNotesRow(r); setNotesText(r.notes ?? ""); };
  const saveNotes = async () => {
    if (!notesRow) return;
    const { error } = await supabase.from("producao_pedidos").update({ notes: notesText || null }).eq("id", notesRow.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Notes saved"); setNotesRow(null); load();
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
    log("updated", "production", r.id, `${r.produtos?.nome ?? "Item"}`, { received_qty: q, ordered_qty: r.quantidade, status: "delivered", added_to_inventory: true });
    toast.success(`Received — ${q} added to inventory.`);
    setReceivingId(null); load();
  };

  const openEdit = (r: Row) => {
    setEditRow(r);
    setEditForm({ produto_id: r.produto_id, quantidade: String(r.quantidade), est_ready: r.est_ready ?? "", est_entrega: r.est_entrega ?? "", numero_ordem: r.numero_ordem ?? "", numero_container: r.numero_container ?? "", status: r.status });
  };
  const saveEdit = async () => {
    if (!editRow) return;
    if (!editForm.produto_id || !(parseInt(editForm.quantidade) > 0)) { toast.error("Product and quantity are required."); return; }
    const patch: any = {
      produto_id: editForm.produto_id, quantidade: parseInt(editForm.quantidade), status: editForm.status,
      est_ready: editForm.est_ready || null, est_entrega: editForm.est_entrega || null,
      numero_ordem: editForm.numero_ordem || null, numero_container: editForm.numero_container || null,
    };
    // Container # É o rastreio na prática (frete marítimo): preencher o container aqui
    // também preenche o Tracking da lista — sem redigitar. Só NÃO sobrescreve um
    // tracking digitado manualmente diferente do container antigo.
    const newContainer = (editForm.numero_container || "").trim();
    const curTracking = (editRow.tracking ?? "").trim();
    const oldContainer = (editRow.numero_container ?? "").trim();
    if (newContainer && (!curTracking || curTracking === oldContainer)) {
      patch.tracking = newContainer;
    }
    const { error } = await supabase.from("producao_pedidos").update(patch).eq("id", editRow.id);
    if (error) { toast.error(error.message); return; }
    log("updated", "production", editRow.id, `${editRow.produtos?.nome ?? "Item"}`, {
      qty_before: editRow.quantidade, qty_after: parseInt(editForm.quantidade),
      status: editForm.status, est_ready: editForm.est_ready || null, eta: editForm.est_entrega || null,
      order_no: editForm.numero_ordem || null, container: editForm.numero_container || null,
      ...(patch.tracking ? { tracking: patch.tracking } : {}),
    });
    toast.success("Updated"); setEditRow(null); load();
  };

  const remove = async (r: Row) => {
    if (!confirm(`Delete this production item ("${r.produtos?.nome}")? This cannot be undone.`)) return;
    const { error } = await supabase.from("producao_pedidos").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    log("deleted", "production", r.id, `${r.produtos?.nome ?? "Item"} (qty ${r.quantidade})`, { status: r.status, order_no: r.numero_ordem, container: r.numero_container });
    toast.success("Deleted"); load();
  };

  // Duplica a entrada (mesmo produto/qtd/datas/ordem), como nova solicitação.
  const duplicate = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").insert({
      produto_id: r.produto_id, quantidade: r.quantidade,
      est_ready: r.est_ready ?? null, est_entrega: r.est_entrega ?? null,
      numero_ordem: r.numero_ordem ?? null, numero_container: r.numero_container ?? null,
      status: "solicitado", created_by: user?.id ?? null,
    } as any);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    log("created", "production", r.id, `${r.produtos?.nome ?? "Item"} (qty ${r.quantidade})`, { duplicated_from: r.id, order_no: r.numero_ordem, container: r.numero_container });
    toast.success("Entry duplicated"); load();
  };

  const StatusPill = ({ r }: { r: Row }) => {
    if (r.status === "delivered") return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 px-2.5 py-1 text-xs font-medium">
        <PackageCheck className="h-3.5 w-3.5" /> Delivered
      </span>
    );
    if (r.status === "a_caminho") return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2.5 py-1 text-xs font-medium">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
        <Truck className="h-3.5 w-3.5" /> On the way
      </span>
    );
    return <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-2.5 py-1 text-xs font-medium">Requested</span>;
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Production — Status</h2>
        <p className="text-sm text-muted-foreground">Active items in production. When you check in a received item it moves to the Received log below and is added to inventory.</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Est Ready</TableHead><TableHead>ETA</TableHead>
              <TableHead>Order # / Container</TableHead><TableHead className="min-w-[190px]">Tracking</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : active.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nothing active in production.</TableCell></TableRow>
            ) : active.map((r) => {
              const isReceiving = receivingId === r.id;
              return (
                <TableRow key={r.id} className={r.status === "a_caminho" ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}>
                  <TableCell className="font-medium">{r.produtos?.nome ?? "—"} <span className="text-xs text-muted-foreground">({r.produtos?.sku ?? ""})</span></TableCell>
                  <TableCell>{r.quantidade}</TableCell>
                  <TableCell>{r.est_ready ?? "—"}</TableCell>
                  <TableCell>{r.est_entrega ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.numero_ordem ?? "—"}{r.numero_container ? ` / ${r.numero_container}` : ""}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Input className="h-8" placeholder="Tracking #" value={trackingEdit[r.id] ?? r.tracking ?? ""} onChange={(e) => setTrackingEdit((p) => ({ ...p, [r.id]: e.target.value }))} />
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => saveTracking(r)}>Save</Button>
                    </div>
                  </TableCell>
                  <TableCell><StatusPill r={r} /></TableCell>
                  <TableCell className="text-right">
                    {isReceiving ? (
                      <div className="flex items-center gap-2 justify-end">
                        <Input type="number" min={0} className="h-8 w-20" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} title="Received quantity" />
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy === r.id} onClick={() => checkIn(r)}><Check className="h-4 w-4" /> Check in</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReceivingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === "solicitado"
                          ? <Button size="sm" variant="outline" className="gap-1" disabled={busy === r.id} onClick={() => goOnTheWay(r)}><Truck className="h-4 w-4" /> On the way</Button>
                          : <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" disabled={busy === r.id} onClick={() => setStatus(r, "solicitado")}>↩ Undo</Button>}
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => startReceive(r)}><PackageCheck className="h-4 w-4" /> Receive</Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title={r.notes ? "Notes (has content)" : "Add notes"} onClick={() => openNotes(r)}><StickyNote className={`h-4 w-4 ${r.notes ? "text-primary fill-primary/20" : ""}`} /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate entry" disabled={busy === r.id} onClick={() => duplicate(r)}><Copy className="h-4 w-4" /></Button>
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

      {/* Log de Recebidos (colapsável) */}
      <Card className="mt-4 overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors" onClick={() => setShowReceived((v) => !v)}>
          <span className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
            <PackageCheck className="h-4 w-4" /> Received log ({received.length})
          </span>
          {showReceived ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showReceived && (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Product</TableHead><TableHead>Ordered → Received</TableHead><TableHead>Container</TableHead><TableHead>Received at</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {received.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nothing received yet.</TableCell></TableRow>
              ) : received.map((r) => (
                <TableRow key={r.id} className="bg-green-50/30 dark:bg-green-950/10">
                  <TableCell className="font-medium">{r.produtos?.nome ?? "—"} <span className="text-xs text-muted-foreground">({r.produtos?.sku ?? ""})</span></TableCell>
                  <TableCell>{r.quantidade} → <b className={r.quantidade_recebida !== r.quantidade ? "text-amber-600" : "text-green-700"}>{r.quantidade_recebida ?? r.quantidade}</b></TableCell>
                  <TableCell className="text-sm">{r.numero_container ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.recebido_em ? fmtDT(r.recebido_em) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Editar (inclui status — pra desfazer "on the way") */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit production item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product *</Label>
              <Select value={editForm.produto_id} onValueChange={(v) => setEditForm((f) => ({ ...f, produto_id: v }))}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Choose product" /></SelectTrigger>
                <SelectContent className="max-h-[400px]">
                  {grouped.map((g) => (
                    <SelectGroup key={g.path}>
                      <SelectLabel className="text-primary font-bold text-sm uppercase bg-primary/10 px-2 py-1.5 my-1 rounded-sm">{g.path}</SelectLabel>
                      {g.prods.map((p) => <SelectItem key={p.id} value={p.id} className="py-2 pl-4">{p.nome} <span className="text-xs text-muted-foreground">({p.sku})</span></SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantity *</Label><Input type="number" min={1} value={editForm.quantidade} onChange={(e) => setEditForm((f) => ({ ...f, quantidade: e.target.value }))} /></div>
              <div>
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solicitado">Requested</SelectItem>
                    <SelectItem value="a_caminho">On the way</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Est Ready</Label><Input type="date" value={editForm.est_ready} onChange={(e) => setEditForm((f) => ({ ...f, est_ready: e.target.value }))} /></div>
              <div><Label>ETA</Label><Input type="date" value={editForm.est_entrega} onChange={(e) => setEditForm((f) => ({ ...f, est_entrega: e.target.value }))} /></div>
              <div><Label>Order #</Label><Input value={editForm.numero_ordem} onChange={(e) => setEditForm((f) => ({ ...f, numero_ordem: e.target.value }))} /></div>
              <div><Label>Container #</Label><Input value={editForm.numero_container} onChange={(e) => setEditForm((f) => ({ ...f, numero_container: e.target.value }))} /></div>
            </div>
            <p className="text-xs text-muted-foreground">To mark as received (and add to inventory), use the green "Check in" on the list — not here.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes do item/container */}
      <Dialog open={!!notesRow} onOpenChange={(o) => !o && setNotesRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><StickyNote className="h-4 w-4" /> Notes — {notesRow?.produtos?.nome}{notesRow?.numero_container ? ` (container ${notesRow.numero_container})` : ""}</DialogTitle></DialogHeader>
          <Textarea rows={6} value={notesText} onChange={(e) => setNotesText(e.target.value)} placeholder="Write a note about this container/order…" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotesRow(null)}>Close</Button>
            <Button onClick={saveNotes}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ProducaoStatus;
