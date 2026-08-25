import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";
import { canonicalStatus, statusBadge, statusLabel } from "@/lib/orderStatuses";

const STATUSES = ["submitted", "ready_for_pickup", "partial", "on_hold", "sent", "complete", "cancelled"];

const OrderSummaryByStatus = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      // Paginado (fetchAllRows): o PostgREST corta em 1000 linhas SEM erro.
      const [ord, cli] = await Promise.all([
        fetchAllRows((f, t) => supabase.from("pedidos").select("id, numero, cliente_id, status, total, created_at, updated_at").order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("clientes").select("id, nome").order("id", { ascending: true }).range(f, t)),
      ]);
      setOrders(ord);
      setCustomers(cli);
      setLoading(false);
    };
    fetch().catch((e) => {
      // fetchAllRows LANCA em erro (antes o `.data ?? []` engolia). Sem este catch
      // o setLoading(false) nunca rodava: spinner eterno + unhandled rejection.
      console.error(e);
      toast.error("Could not load this report. Try again.");
      setLoading(false);
    });
  }, []);

  const custMap = useMemo(() => {
    const m: Record<string, string> = {};
    customers.forEach((c) => (m[c.id] = c.nome));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      // Date-only e parseado como UTC; date-time sem offset, como LOCAL. Sem o
      // "T00:00:00" as duas pontas do filtro ficavam em fusos diferentes e o
      // "From" trazia horas do dia ANTERIOR.
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom + "T00:00:00")) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59.999")) return false;
      return true;
    });
  }, [orders, dateFrom, dateTo]);

  const statusSummary = useMemo(() => {
    return STATUSES.map((s) => {
      const statusOrders = filtered.filter((o) => canonicalStatus(o.status) === s);
      return {
        status: s,
        count: statusOrders.length,
        total: statusOrders.reduce((a, o) => a + o.total, 0),
        avg: statusOrders.length > 0 ? statusOrders.reduce((a, o) => a + o.total, 0) / statusOrders.length : 0,
      };
    });
  }, [filtered]);

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
                <Badge className={`mb-2 ${statusBadge(s.status)}`}>{statusLabel(s.status)}</Badge>
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
                      <TableCell><Badge className={statusBadge(s.status)}>{statusLabel(s.status)}</Badge></TableCell>
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
