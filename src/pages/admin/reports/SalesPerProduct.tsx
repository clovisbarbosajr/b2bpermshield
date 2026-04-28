import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency } from "@/lib/export-csv";

const SalesPerProduct = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));
  const [nameFilter, setNameFilter] = useState("");

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, itemRes] = await Promise.all([
        supabase.from("pedidos").select("id, created_at"),
        supabase.from("pedido_itens").select("pedido_id, produto_id, nome_produto, sku, subtotal"),
      ]);
      setOrders(ordRes.data ?? []);
      setItems(itemRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const years = useMemo(() => {
    const set = new Set(orders.map((o) => String(new Date(o.created_at).getFullYear())));
    return Array.from(set).sort();
  }, [orders]);

  const reportData = useMemo(() => {
    const orderDateMap: Record<string, string> = {};
    orders.forEach((o) => (orderDateMap[o.id] = o.created_at));

    const map: Record<string, { nome: string; sku: string; months: Record<number, number> }> = {};
    items.forEach((i) => {
      const orderDate = orderDateMap[i.pedido_id];
      if (!orderDate) return;
      const d = new Date(orderDate);
      if (String(d.getFullYear()) !== yearFilter) return;
      if (!map[i.produto_id]) map[i.produto_id] = { nome: i.nome_produto, sku: i.sku, months: {} };
      map[i.produto_id].months[d.getMonth()] = (map[i.produto_id].months[d.getMonth()] || 0) + i.subtotal;
    });

    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        nome: d.nome,
        sku: d.sku,
        ...Object.fromEntries(months.map((_, idx) => [`m${idx}`, d.months[idx] || 0])),
        total: Object.values(d.months).reduce((a, b) => a + b, 0),
      }))
      .filter((d) => !nameFilter || d.nome.toLowerCase().includes(nameFilter.toLowerCase()))
      .sort((a, b) => (b.total as number) - (a.total as number));
  }, [orders, items, yearFilter, nameFilter]);

  const handleExport = () => {
    const cols = [{ key: "sku", label: "SKU" }, { key: "nome", label: "Product" }, ...months.map((m, i) => ({ key: `m${i}`, label: m })), { key: "total", label: "Total" }];
    exportToCSV(reportData, `sales_per_product_${yearFilter}`, cols);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Sales per Product per Month</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Year</label>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.length === 0 ? <SelectItem value={yearFilter}>{yearFilter}</SelectItem> : years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Product</label><Input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Filter..." /></div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary sticky left-0 bg-card">Product</TableHead>
                {months.map((m) => <TableHead key={m} className="text-right text-xs">{m}</TableHead>)}
                <TableHead className="text-right font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
              ) : reportData.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-primary sticky left-0 bg-card">{r.nome}</TableCell>
                  {months.map((_, i) => <TableCell key={i} className="text-right text-xs">{r[`m${i}`] > 0 ? formatCurrency(r[`m${i}`]) : "—"}</TableCell>)}
                  <TableCell className="text-right font-bold">{formatCurrency(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminLayout>
  );
};

export default SalesPerProduct;
