import { useState, useEffect } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Check, Truck, PackageCheck } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string; produto_id: string; quantidade: number; est_entrega: string | null; numero_ordem: string | null;
  numero_container: string | null; status: string; tracking: string | null;
  quantidade_recebida: number | null; recebido_em: string | null; created_at: string;
  produtos: { nome: string; sku: string } | null;
};

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "outline" }> = {
  solicitado: { label: "Requested", variant: "secondary" },
  a_caminho: { label: "On the way", variant: "default" },
  delivered: { label: "Delivered", variant: "outline" },
};

const ProducaoStatus = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingEdit, setTrackingEdit] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [recvQty, setRecvQty] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("producao_pedidos")
      .select("id, produto_id, quantidade, est_entrega, numero_ordem, numero_container, status, tracking, quantidade_recebida, recebido_em, created_at, produtos(nome, sku)")
      .order("created_at", { ascending: false });
    setRows((data as any[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Salva tracking; se ainda estava "solicitado", avança para "a caminho".
  const saveTracking = async (r: Row) => {
    const tracking = (trackingEdit[r.id] ?? r.tracking ?? "").trim();
    const patch: any = { tracking: tracking || null };
    if (tracking && r.status === "solicitado") patch.status = "a_caminho";
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update(patch).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    load();
  };

  const markOnTheWay = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos").update({ status: "a_caminho" }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const startReceive = (r: Row) => { setReceivingId(r.id); setRecvQty(String(r.quantidade)); };

  // Check-in: confirma o recebido (qtd pode diferir) → o trigger soma ao estoque.
  const checkIn = async (r: Row) => {
    const q = parseInt(recvQty);
    if (!(q >= 0)) { toast.error("Enter a valid received quantity."); return; }
    if (!confirm(`Receive ${q} of "${r.produtos?.nome}"? This adds ${q} to inventory and cannot be undone here.`)) return;
    setBusy(r.id);
    const { error } = await supabase.from("producao_pedidos")
      .update({ status: "delivered", quantidade_recebida: q, recebido_em: new Date().toISOString(), recebido_por: user?.id ?? null })
      .eq("id", r.id);
    setBusy(null);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(`Received — ${q} added to inventory.`);
    setReceivingId(null);
    load();
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Production — Status</h2>
        <p className="text-sm text-muted-foreground">Track items, add tracking numbers, and check in received goods (which adds them to inventory at the product's location).</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Est. delivery</TableHead>
              <TableHead>Order # / Container</TableHead><TableHead className="min-w-[200px]">Tracking</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Receive</TableHead>
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
                  <TableCell>
                    {r.quantidade}
                    {r.quantidade_recebida != null && r.quantidade_recebida !== r.quantidade && (
                      <span className="text-xs text-amber-600"> → {r.quantidade_recebida} recv.</span>
                    )}
                  </TableCell>
                  <TableCell>{r.est_entrega ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.numero_ordem ?? "—"}{r.numero_container ? ` / ${r.numero_container}` : ""}</TableCell>
                  <TableCell>
                    {isDelivered ? (
                      <span className="text-sm">{r.tracking ?? "—"}</span>
                    ) : (
                      <div className="flex gap-1">
                        <Input className="h-8" placeholder="Tracking #"
                          value={trackingEdit[r.id] ?? r.tracking ?? ""}
                          onChange={(e) => setTrackingEdit((p) => ({ ...p, [r.id]: e.target.value }))} />
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
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy === r.id} onClick={() => checkIn(r)}>
                          <Check className="h-4 w-4" /> Check in
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReceivingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 justify-end">
                        {r.status === "solicitado" && (
                          <Button size="sm" variant="outline" className="gap-1" disabled={busy === r.id} onClick={() => markOnTheWay(r)}>
                            <Truck className="h-4 w-4" /> On the way
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => startReceive(r)}>
                          <PackageCheck className="h-4 w-4" /> Receive
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground mt-3">
        "Receive" lets you adjust the quantity if less arrived than ordered (e.g., ordered 10, got 8), then the green Check in adds the received quantity to inventory.
      </p>
    </AdminLayout>
  );
};

export default ProducaoStatus;
