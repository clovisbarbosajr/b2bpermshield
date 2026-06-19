import { useState, useEffect } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string; quantidade: number; est_entrega: string | null; numero_ordem: string | null;
  numero_container: string | null; status: string; tracking: string | null;
  quantidade_recebida: number | null; created_at: string;
  produtos: { nome: string; sku: string; categoria_id: string | null } | null;
};

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "outline" }> = {
  solicitado: { label: "Requested", variant: "secondary" },
  a_caminho: { label: "On the way", variant: "default" },
  delivered: { label: "Delivered", variant: "outline" },
};

const ProducaoStatus = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("producao_pedidos")
      .select("id, quantidade, est_entrega, numero_ordem, numero_container, status, tracking, quantidade_recebida, created_at, produtos(nome, sku, categoria_id)")
      .order("created_at", { ascending: false })
      .then(({ data }) => { setRows((data as any[]) ?? []); setLoading(false); });
  }, []);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Production — Status</h2>
        <p className="text-sm text-muted-foreground">Everything requested for production. Tracking and the receive/check-in (which adds to inventory) are added in the next step.</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Est. delivery</TableHead>
              <TableHead>Order #</TableHead><TableHead>Container #</TableHead><TableHead>Tracking</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nothing in production yet.</TableCell></TableRow>
            ) : rows.map((r) => {
              const b = STATUS_BADGE[r.status] ?? { label: r.status, variant: "outline" as const };
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.produtos?.nome ?? "—"} <span className="text-xs text-muted-foreground">({r.produtos?.sku ?? ""})</span></TableCell>
                  <TableCell>{r.quantidade}{r.quantidade_recebida != null && r.quantidade_recebida !== r.quantidade ? ` → ${r.quantidade_recebida}` : ""}</TableCell>
                  <TableCell>{r.est_entrega ?? "—"}</TableCell>
                  <TableCell>{r.numero_ordem ?? "—"}</TableCell>
                  <TableCell>{r.numero_container ?? "—"}</TableCell>
                  <TableCell>{r.tracking ?? "—"}</TableCell>
                  <TableCell><Badge variant={b.variant}>{b.label}</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </AdminLayout>
  );
};

export default ProducaoStatus;
