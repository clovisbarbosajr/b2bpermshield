import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const STATUSES = ["recebido", "em_processamento", "enviado", "concluido", "cancelado"];
const PAGE_SIZE = 25;

const ProductsByOrderStatus = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, itemRes] = await Promise.all([
        supabase.from("pedidos").select("id, status"),
        supabase.from("pedido_itens").select("pedido_id, produto_id, nome_produto, sku, quantidade, subtotal"),
      ]);
      setOrders(ordRes.data ?? []);
      setItems(itemRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const reportData = useMemo(() => {
    const orderStatusMap: Record<string, string> = {};
    orders.forEach((o) => (orderStatusMap[o.id] = o.status));

    const map: Record<string, { sku: string; product: string; status: string; qty: number; revenue: number }> = {};
    items.forEach((i) => {
      const status = orderStatusMap[i.pedido_id];
      if (!status) return;
      if (statusFilter !== "all" && status !== statusFilter) return;
      const key = `${i.produto_id}_${status}`;
      if (!map[key]) map[key] = { sku: i.sku, product: i.nome_produto, status, qty: 0, revenue: 0 };
      map[key].qty += i.quantidade;
      map[key].revenue += i.subtotal;
    });

    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [orders, items, statusFilter]);

  const totalPages = Math.ceil(reportData.length / PAGE_SIZE);
  const paginated = reportData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(reportData, "products_by_order_status", [
      { key: "sku", label: "SKU" },
      { key: "product", label: "Product" },
      { key: "status", label: "Order Status" },
      { key: "qty", label: "Quantity" },
      { key: "revenue", label: "Revenue" },
    ]);
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = { recebido: "bg-blue-500/20 text-blue-400", em_processamento: "bg-yellow-500/20 text-yellow-400", enviado: "bg-purple-500/20 text-purple-400", concluido: "bg-green-500/20 text-green-400", cancelado: "bg-red-500/20 text-red-400" };
    return map[s] || "";
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Products by Order Status</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted-foreground">Order Status</label>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-primary">Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data available.</TableCell></TableRow>
              ) : paginated.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className="text-primary">{r.product}</TableCell>
                  <TableCell><Badge className={statusColor(r.status)}>{r.status.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-right">{formatNumber(r.qty)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, reportData.length)} of {reportData.length}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default ProductsByOrderStatus;
