import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency } from "@/lib/export-csv";

const SalesPerCategory = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, itemRes, prodRes, catRes] = await Promise.all([
        supabase.from("pedidos").select("id, created_at"),
        supabase.from("pedido_itens").select("pedido_id, produto_id, subtotal"),
        supabase.from("produtos").select("id, categoria_id"),
        supabase.from("categorias").select("id, nome"),
      ]);
      setOrders(ordRes.data ?? []);
      setItems(itemRes.data ?? []);
      setProducts(prodRes.data ?? []);
      setCategories(catRes.data ?? []);
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
    const prodCatMap: Record<string, string | null> = {};
    products.forEach((p) => (prodCatMap[p.id] = p.categoria_id));
    const catNameMap: Record<string, string> = {};
    categories.forEach((c) => (catNameMap[c.id] = c.nome));
    const orderDateMap: Record<string, string> = {};
    orders.forEach((o) => (orderDateMap[o.id] = o.created_at));

    const map: Record<string, Record<number, number>> = {};
    items.forEach((i) => {
      const orderDate = orderDateMap[i.pedido_id];
      if (!orderDate) return;
      const d = new Date(orderDate);
      if (String(d.getFullYear()) !== yearFilter) return;
      const catId = prodCatMap[i.produto_id];
      const catName = catId ? catNameMap[catId] || "Uncategorized" : "Uncategorized";
      if (!map[catName]) map[catName] = {};
      map[catName][d.getMonth()] = (map[catName][d.getMonth()] || 0) + i.subtotal;
    });

    return Object.entries(map)
      .map(([category, monthData]) => ({
        category,
        ...Object.fromEntries(months.map((_, idx) => [`m${idx}`, monthData[idx] || 0])),
        total: Object.values(monthData).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => (b.total as number) - (a.total as number));
  }, [orders, items, products, categories, yearFilter]);

  const handleExport = () => {
    const cols = [{ key: "category", label: "Category" }, ...months.map((m, i) => ({ key: `m${i}`, label: m })), { key: "total", label: "Total" }];
    exportToCSV(reportData, `sales_per_category_${yearFilter}`, cols);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Sales per Category per Month</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted-foreground">Year</label>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.length === 0 ? <SelectItem value={yearFilter}>{yearFilter}</SelectItem> : years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
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
                <TableHead className="text-primary sticky left-0 bg-card">Category</TableHead>
                {months.map((m) => <TableHead key={m} className="text-right text-xs">{m}</TableHead>)}
                <TableHead className="text-right font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
              ) : reportData.map((r: any) => (
                <TableRow key={r.category}>
                  <TableCell className="text-primary sticky left-0 bg-card">{r.category}</TableCell>
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

export default SalesPerCategory;
