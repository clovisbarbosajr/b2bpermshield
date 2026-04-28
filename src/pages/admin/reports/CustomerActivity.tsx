import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const PAGE_SIZE = 25;

const CustomerActivity = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameFilter, setNameFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [cliRes, ordRes] = await Promise.all([
        supabase.from("clientes").select("id, nome, empresa, email, status, created_at"),
        supabase.from("pedidos").select("id, cliente_id, total, created_at"),
      ]);
      setCustomers(cliRes.data ?? []);
      setOrders(ordRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const reportData = useMemo(() => {
    const orderMap: Record<string, { count: number; total: number; first: string; last: string }> = {};
    orders.forEach((o) => {
      if (!orderMap[o.cliente_id]) orderMap[o.cliente_id] = { count: 0, total: 0, first: o.created_at, last: o.created_at };
      orderMap[o.cliente_id].count += 1;
      orderMap[o.cliente_id].total += o.total;
      if (o.created_at < orderMap[o.cliente_id].first) orderMap[o.cliente_id].first = o.created_at;
      if (o.created_at > orderMap[o.cliente_id].last) orderMap[o.cliente_id].last = o.created_at;
    });

    return customers
      .map((c) => {
        const od = orderMap[c.id] || { count: 0, total: 0, first: "", last: "" };
        return { id: c.id, nome: c.nome, empresa: c.empresa, email: c.email, status: c.status, registered: c.created_at, orderCount: od.count, totalSpent: od.total, firstOrder: od.first, lastOrder: od.last };
      })
      .filter((d) => !nameFilter || d.nome.toLowerCase().includes(nameFilter.toLowerCase()) || d.empresa.toLowerCase().includes(nameFilter.toLowerCase()))
      .sort((a, b) => b.totalSpent - a.totalSpent);
  }, [customers, orders, nameFilter]);

  const totalPages = Math.ceil(reportData.length / PAGE_SIZE);
  const paginated = reportData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(reportData, "customer_activity", [
      { key: "nome", label: "Customer" },
      { key: "empresa", label: "Company" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status" },
      { key: "orderCount", label: "# Orders" },
      { key: "totalSpent", label: "Total Spent" },
      { key: "firstOrder", label: "First Order" },
      { key: "lastOrder", label: "Last Order" },
      { key: "registered", label: "Registered" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Customer Activity</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted-foreground">Customer / Company</label>
        <Input value={nameFilter} onChange={(e) => { setNameFilter(e.target.value); setPage(1); }} placeholder="Filter..." className="max-w-xs" />
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Customer</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right"># Orders</TableHead>
                <TableHead className="text-right">Total Spent</TableHead>
                <TableHead>First Order</TableHead>
                <TableHead>Last Order</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
              ) : paginated.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-primary">{r.nome}</TableCell>
                  <TableCell>{r.empresa}</TableCell>
                  <TableCell className="capitalize">{r.status}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.orderCount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.totalSpent)}</TableCell>
                  <TableCell>{r.firstOrder ? new Date(r.firstOrder).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>{r.lastOrder ? new Date(r.lastOrder).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>{new Date(r.registered).toLocaleDateString()}</TableCell>
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

export default CustomerActivity;
