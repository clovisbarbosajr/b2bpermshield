import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const STATUSES = ["recebido", "em_processamento", "enviado", "concluido", "cancelado"];

const OrderSummaryByStatus = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, cliRes] = await Promise.all([
        supabase.from("pedidos").select("id, numero, cliente_id, status, total, created_at, updated_at"),
        supabase.from("clientes").select("id, nome"),
      ]);
      setOrders(ordRes.data ?? []);
      setCustomers(cliRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const custMap = useMemo(() => {
    const m: Record<string, string> = {};
    customers.forEach((c) => (m[c.id] = c.nome));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [orders, dateFrom, dateTo]);

  const statusSummary = useMemo(() => {
    return STATUSES.map((s) => {
      const statusOrders = filtered.filter((o) => o.status === s);
      return {
        status: s,
        count: statusOrders.length,
        total: statusOrders.reduce((a, o) => a + o.total, 0),
        avg: statusOrders.length > 0 ? statusOrders.reduce((a, o) => a + o.total, 0) / statusOrders.length : 0,
      };
    });
  }, [filtered]);

  const statusColor = (s: string) => {
    const map: Record<string, string> = { recebido: "bg-blue-500/20 text-blue-400", em_processamento: "bg-yellow-500/20 text-yellow-400", enviado: "bg-purple-500/20 text-purple-400", concluido: "bg-green-500/20 text-green-400", cancelado: "bg-red-500/20 text-red-400" };
    return map[s] || "";
  };

  const handleExport = () => {
    exportToCSV(statusSummary, "order_summary_by_status", [
      { key: "status", label: "Status" },
      { key: "count", label: "# Orders" },
      { key: "total", label: "Total Revenue" },
      { key: "avg", label: "Avg Order Value" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Order Summary by Status</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end">
        <div><label className="mb-1 block text-xs text-muted-foreground">From</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">To</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
            {statusSummary.map((s) => (
              <div key={s.status} className="rounded-md border p-4">
                <Badge className={`mb-2 ${statusColor(s.status)}`}>{s.status.replace("_", " ")}</Badge>
                <p className="text-2xl font-bold">{formatNumber(s.count)}</p>
                <p className="text-sm text-muted-foreground">{formatCurrency(s.total)}</p>
                <p className="text-xs text-muted-foreground">Avg: {formatCurrency(s.avg)}</p>
              </div>
            ))}
          </div>
          {/* Detail table */}
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-primary">Status</TableHead>
                  <TableHead className="text-right"># Orders</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Avg Order Value</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusSummary.map((s) => {
                  const totalAll = filtered.reduce((a, o) => a + o.total, 0);
                  const pct = totalAll > 0 ? (s.total / totalAll) * 100 : 0;
                  return (
                    <TableRow key={s.status}>
                      <TableCell><Badge className={statusColor(s.status)}>{s.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right">{formatNumber(s.count)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.avg)}</TableCell>
                      <TableCell className="text-right">{pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </AdminLayout>
  );
};

export default OrderSummaryByStatus;
