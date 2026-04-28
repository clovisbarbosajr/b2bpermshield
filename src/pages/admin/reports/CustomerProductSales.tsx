import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const PAGE_SIZE = 25;

const CustomerProductSales = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [ordRes, itemRes, cliRes] = await Promise.all([
        supabase.from("pedidos").select("id, cliente_id"),
        supabase.from("pedido_itens").select("pedido_id, produto_id, nome_produto, sku, quantidade, subtotal"),
        supabase.from("clientes").select("id, nome, empresa"),
      ]);
      setOrders(ordRes.data ?? []);
      setItems(itemRes.data ?? []);
      setCustomers(cliRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  const reportData = useMemo(() => {
    const orderClientMap: Record<string, string> = {};
    orders.forEach((o) => (orderClientMap[o.id] = o.cliente_id));
    const clientMap: Record<string, { nome: string; empresa: string }> = {};
    customers.forEach((c) => (clientMap[c.id] = { nome: c.nome, empresa: c.empresa }));

    const map: Record<string, { customer: string; company: string; product: string; sku: string; qty: number; revenue: number }> = {};
    items.forEach((i) => {
      const clienteId = orderClientMap[i.pedido_id];
      if (!clienteId) return;
      if (customerFilter !== "all" && clienteId !== customerFilter) return;
      if (productFilter && !i.nome_produto.toLowerCase().includes(productFilter.toLowerCase())) return;
      const key = `${clienteId}_${i.produto_id}`;
      const client = clientMap[clienteId] || { nome: "Unknown", empresa: "" };
      if (!map[key]) map[key] = { customer: client.nome, company: client.empresa, product: i.nome_produto, sku: i.sku, qty: 0, revenue: 0 };
      map[key].qty += i.quantidade;
      map[key].revenue += i.subtotal;
    });

    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [orders, items, customers, customerFilter, productFilter]);

  const totalPages = Math.ceil(reportData.length / PAGE_SIZE);
  const paginated = reportData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(reportData, "customer_product_sales", [
      { key: "customer", label: "Customer" },
      { key: "company", label: "Company" },
      { key: "sku", label: "SKU" },
      { key: "product", label: "Product" },
      { key: "qty", label: "Qty Sold" },
      { key: "revenue", label: "Revenue" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Customer Product Sales</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Customer</label>
          <Select value={customerFilter} onValueChange={(v) => { setCustomerFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Customers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Product</label><Input value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }} placeholder="Filter..." /></div>
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
                <TableHead>SKU</TableHead>
                <TableHead className="text-primary">Product</TableHead>
                <TableHead className="text-right">Qty Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No data available.</TableCell></TableRow>
              ) : paginated.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-primary">{r.customer}</TableCell>
                  <TableCell>{r.company}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className="text-primary">{r.product}</TableCell>
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

export default CustomerProductSales;
