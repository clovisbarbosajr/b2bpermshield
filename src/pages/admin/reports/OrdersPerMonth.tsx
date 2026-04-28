import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const OrdersPerMonth = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("pedidos").select("id, total, created_at, status").then(({ data }) => {
      setOrders(data ?? []);
      setLoading(false);
    });
  }, []);

  const monthlyData = useMemo(() => {
    const map: Record<string, { month: string; orders: number; revenue: number }> = {};
    orders.forEach((o) => {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map[key]) map[key] = { month: key, orders: 0, revenue: 0 };
      map[key].orders += 1;
      map[key].revenue += o.total;
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [orders]);

  const handleExport = () => {
    exportToCSV(monthlyData, "orders_per_month", [
      { key: "month", label: "Month" },
      { key: "orders", label: "# Orders" },
      { key: "revenue", label: "Revenue" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Orders per Month</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <>
          {monthlyData.length > 0 && (
            <div className="mb-6 rounded-md border p-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="orders" fill="hsl(var(--primary))" name="# Orders" />
                  <Bar yAxisId="right" dataKey="revenue" fill="hsl(var(--accent))" name="Revenue ($)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-primary">Month</TableHead>
                  <TableHead className="text-right"># Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyData.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No orders yet.</TableCell></TableRow>
                ) : monthlyData.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="text-primary">{m.month}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.orders)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(m.revenue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(m.orders > 0 ? m.revenue / m.orders : 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </AdminLayout>
  );
};

export default OrdersPerMonth;
