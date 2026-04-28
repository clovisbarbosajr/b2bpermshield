import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const OrderRepsPerformance = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, repRes, cliRes] = await Promise.all([
        supabase.from("pedidos").select("id, cliente_id, total, status, created_at"),
        supabase.from("representantes").select("id, nome, email, comissao_percentual"),
        supabase.from("clientes").select("id, representante_id"),
      ]);
      setOrders(ordRes.data ?? []);
      setReps(repRes.data ?? []);
      setClients(cliRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const reportData = useMemo(() => {
    const clientRepMap: Record<string, string | null> = {};
    clients.forEach((c) => (clientRepMap[c.id] = c.representante_id));

    const filteredOrders = orders.filter((o) => {
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });

    const repMap: Record<string, { name: string; orders: number; revenue: number; commission: number; rate: number }> = {};
    reps.forEach((r) => {
      repMap[r.id] = { name: r.nome, orders: 0, revenue: 0, commission: 0, rate: r.comissao_percentual };
    });

    filteredOrders.forEach((o) => {
      const repId = clientRepMap[o.cliente_id];
      if (repId && repMap[repId]) {
        repMap[repId].orders += 1;
        repMap[repId].revenue += o.total;
        repMap[repId].commission += o.total * (repMap[repId].rate / 100);
      }
    });

    return Object.entries(repMap)
      .map(([id, d]) => ({ id, ...d, avgOrder: d.orders > 0 ? d.revenue / d.orders : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [orders, reps, clients, dateFrom, dateTo]);

  const handleExport = () => {
    exportToCSV(reportData, "order_reps_performance", [
      { key: "name", label: "Sales Rep" },
      { key: "orders", label: "# Orders" },
      { key: "revenue", label: "Total Revenue" },
      { key: "avgOrder", label: "Avg Order Value" },
      { key: "commission", label: "Commission" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Order Reps Performance</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end">
        <div><label className="mb-1 block text-xs text-muted-foreground">Date From</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Date To</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Sales Rep</TableHead>
                <TableHead className="text-right"># Orders</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
                <TableHead className="text-right">Avg Order Value</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data available.</TableCell></TableRow>
              ) : reportData.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-primary">{r.name}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.orders)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.avgOrder)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminLayout>
  );
};

export default OrderRepsPerformance;
