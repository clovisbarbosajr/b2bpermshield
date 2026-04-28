import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const STATUSES = ["recebido", "em_processamento", "enviado", "concluido", "cancelado"];
const PAGE_SIZE = 25;

const OrdersSummary = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [itemsCount, setItemsCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, cliRes, itemRes] = await Promise.all([
        supabase.from("pedidos").select("*").order("created_at", { ascending: false }),
        supabase.from("clientes").select("id, nome, empresa"),
        supabase.from("pedido_itens").select("pedido_id"),
      ]);
      setOrders(ordRes.data ?? []);
      setCustomers(cliRes.data ?? []);
      const counts: Record<string, number> = {};
      (itemRes.data ?? []).forEach((i) => { counts[i.pedido_id] = (counts[i.pedido_id] || 0) + 1; });
      setItemsCount(counts);
      setLoading(false);
    };
    fetch();
  }, []);

  const custMap = useMemo(() => {
    const m: Record<string, { nome: string; empresa: string }> = {};
    customers.forEach((c) => (m[c.id] = { nome: c.nome, empresa: c.empresa }));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [orders, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const statusColor = (s: string) => {
    const map: Record<string, string> = { recebido: "bg-blue-500/20 text-blue-400", em_processamento: "bg-yellow-500/20 text-yellow-400", enviado: "bg-purple-500/20 text-purple-400", concluido: "bg-green-500/20 text-green-400", cancelado: "bg-red-500/20 text-red-400" };
    return map[s] || "";
  };

  const handleExport = () => {
    exportToCSV(filtered.map((o) => {
      const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
      return { numero: o.numero, customer: c.nome, company: c.empresa, status: o.status, items: itemsCount[o.id] || 0, subtotal: o.subtotal, total: o.total, date: new Date(o.created_at).toLocaleDateString() };
    }), "orders_summary", [
      { key: "numero", label: "Order #" },
      { key: "customer", label: "Customer" },
      { key: "company", label: "Company" },
      { key: "status", label: "Status" },
      { key: "items", label: "Items" },
      { key: "subtotal", label: "Subtotal" },
      { key: "total", label: "Total" },
      { key: "date", label: "Date" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Orders Summary</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">From</label><Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">To</label><Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} /></div>
      </div>
      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.map((s) => {
          const count = filtered.filter((o) => o.status === s).length;
          const total = filtered.filter((o) => o.status === s).reduce((a, o) => a + o.total, 0);
          return (
            <div key={s} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground capitalize">{s.replace("_", " ")}</p>
              <p className="text-lg font-bold">{count}</p>
              <p className="text-xs text-muted-foreground">{formatCurrency(total)}</p>
            </div>
          );
        })}
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No orders.</TableCell></TableRow>
              ) : paginated.map((o) => {
                const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-primary font-mono">#{o.numero}</TableCell>
                    <TableCell>{c.nome}</TableCell>
                    <TableCell>{c.empresa}</TableCell>
                    <TableCell><Badge className={statusColor(o.status)}>{o.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right">{itemsCount[o.id] || 0}</TableCell>
                    <TableCell className="text-right">{formatCurrency(o.total)}</TableCell>
                    <TableCell>{new Date(o.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default OrdersSummary;
