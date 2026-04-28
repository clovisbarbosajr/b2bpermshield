import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const PAGE_SIZE = 25;

const CustomersPerformance = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, cliRes] = await Promise.all([
        supabase.from("pedidos").select("id, cliente_id, total, created_at"),
        supabase.from("clientes").select("id, nome, empresa, email"),
      ]);
      setOrders(ordRes.data ?? []);
      setCustomers(cliRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const reportData = useMemo(() => {
    const filteredOrders = orders.filter((o) => {
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });

    const custMap: Record<string, { name: string; company: string; email: string; orders: number; revenue: number; lastOrder: string }> = {};
    customers.forEach((c) => {
      custMap[c.id] = { name: c.nome, company: c.empresa, email: c.email, orders: 0, revenue: 0, lastOrder: "" };
    });

    filteredOrders.forEach((o) => {
      if (custMap[o.cliente_id]) {
        custMap[o.cliente_id].orders += 1;
        custMap[o.cliente_id].revenue += o.total;
        if (!custMap[o.cliente_id].lastOrder || o.created_at > custMap[o.cliente_id].lastOrder) {
          custMap[o.cliente_id].lastOrder = o.created_at;
        }
      }
    });

    return Object.entries(custMap)
      .map(([id, d]) => ({ id, ...d, avgOrder: d.orders > 0 ? d.revenue / d.orders : 0 }))
      .filter((d) => !nameFilter || d.name.toLowerCase().includes(nameFilter.toLowerCase()) || d.company.toLowerCase().includes(nameFilter.toLowerCase()))
      .sort((a, b) => b.revenue - a.revenue);
  }, [orders, customers, dateFrom, dateTo, nameFilter]);

  const totalPages = Math.ceil(reportData.length / PAGE_SIZE);
  const paginated = reportData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(reportData, "customers_performance", [
      { key: "name", label: "Customer" },
      { key: "company", label: "Company" },
      { key: "email", label: "Email" },
      { key: "orders", label: "# Orders" },
      { key: "revenue", label: "Total Revenue" },
      { key: "avgOrder", label: "Avg Order" },
      { key: "lastOrder", label: "Last Order" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Customers Performance</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="mb-1 block text-xs text-muted-foreground">Date From</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Date To</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Customer / Company</label><Input value={nameFilter} onChange={(e) => { setNameFilter(e.target.value); setPage(1); }} placeholder="Filter..." /></div>
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
                <TableHead className="text-right"># Orders</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
                <TableHead className="text-right">Avg Order</TableHead>
                <TableHead>Last Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No data available.</TableCell></TableRow>
              ) : paginated.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-primary">{r.name}</TableCell>
                  <TableCell>{r.company}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.orders)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.avgOrder)}</TableCell>
                  <TableCell>{r.lastOrder ? new Date(r.lastOrder).toLocaleDateString() : "—"}</TableCell>
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

export default CustomersPerformance;
