import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const PAGE_SIZE = 25;

const ProductSales = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameFilter, setNameFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    supabase.from("pedido_itens").select("produto_id, nome_produto, sku, quantidade, subtotal").then(({ data }) => {
      setItems(data ?? []);
      setLoading(false);
    });
  }, []);

  const reportData = useMemo(() => {
    const map: Record<string, { sku: string; nome: string; qty: number; revenue: number; orders: number }> = {};
    items.forEach((i) => {
      if (!map[i.produto_id]) map[i.produto_id] = { sku: i.sku, nome: i.nome_produto, qty: 0, revenue: 0, orders: 0 };
      map[i.produto_id].qty += i.quantidade;
      map[i.produto_id].revenue += i.subtotal;
      map[i.produto_id].orders += 1;
    });
    return Object.entries(map)
      .map(([id, d]) => ({ id, ...d }))
      .filter((d) => !nameFilter || d.nome.toLowerCase().includes(nameFilter.toLowerCase()) || d.sku.toLowerCase().includes(nameFilter.toLowerCase()))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, nameFilter]);

  const totalPages = Math.ceil(reportData.length / PAGE_SIZE);
  const paginated = reportData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(reportData, "product_sales", [
      { key: "sku", label: "SKU" },
      { key: "nome", label: "Product" },
      { key: "qty", label: "Qty Sold" },
      { key: "orders", label: "# Orders" },
      { key: "revenue", label: "Revenue" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Product Sales</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end">
        <div><label className="mb-1 block text-xs text-muted-foreground">Product / SKU</label><Input value={nameFilter} onChange={(e) => { setNameFilter(e.target.value); setPage(1); }} placeholder="Filter..." /></div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">SKU</TableHead>
                <TableHead className="text-primary">Product</TableHead>
                <TableHead className="text-right">Qty Sold</TableHead>
                <TableHead className="text-right"># Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sales data.</TableCell></TableRow>
              ) : paginated.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className="text-primary">{r.nome}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.qty)}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.orders)}</TableCell>
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

export default ProductSales;
