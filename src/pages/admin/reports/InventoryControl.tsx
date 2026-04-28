import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

interface Product {
  id: string;
  sku: string;
  nome: string;
  custo: number | null;
  estoque_total: number;
  estoque_reservado: number;
  categoria_id: string | null;
  updated_at: string;
}

interface OrderItem {
  produto_id: string;
  quantidade: number;
  subtotal: number;
}

interface Category {
  id: string;
  nome: string;
}

const PAGE_SIZE = 25;

const InventoryControl = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [nameFilter, setNameFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");
  const [lastModifiedFilter, setLastModifiedFilter] = useState("");
  const [page, setPage] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState({ category: "all", name: "", code: "", lastModified: "" });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [prodRes, itemsRes, catRes] = await Promise.all([
        supabase.from("produtos").select("id, sku, nome, custo, estoque_total, estoque_reservado, categoria_id, updated_at"),
        supabase.from("pedido_itens").select("produto_id, quantidade, subtotal"),
        supabase.from("categorias").select("id, nome").order("nome"),
      ]);
      setProducts(prodRes.data ?? []);
      setOrderItems(itemsRes.data ?? []);
      setCategories(catRes.data ?? []);
      setLoading(false);
    };
    fetchData();
  }, []);

  const soldMap = useMemo(() => {
    const map: Record<string, { qty: number; value: number }> = {};
    orderItems.forEach((item) => {
      if (!map[item.produto_id]) map[item.produto_id] = { qty: 0, value: 0 };
      map[item.produto_id].qty += item.quantidade;
      map[item.produto_id].value += item.subtotal;
    });
    return map;
  }, [orderItems]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (appliedFilters.category !== "all" && p.categoria_id !== appliedFilters.category) return false;
      if (appliedFilters.name && !p.nome.toLowerCase().includes(appliedFilters.name.toLowerCase())) return false;
      if (appliedFilters.code && !p.sku.toLowerCase().includes(appliedFilters.code.toLowerCase())) return false;
      if (appliedFilters.lastModified) {
        const filterDate = new Date(appliedFilters.lastModified);
        const productDate = new Date(p.updated_at);
        if (productDate < filterDate) return false;
      }
      return true;
    });
  }, [products, appliedFilters]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const paginatedProducts = filteredProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = () => {
    setAppliedFilters({ category: categoryFilter, name: nameFilter, code: codeFilter, lastModified: lastModifiedFilter });
    setPage(1);
  };

  const handleExport = () => {
    const data = filteredProducts.map((p) => {
      const sold = soldMap[p.id] || { qty: 0, value: 0 };
      const available = p.estoque_total - p.estoque_reservado;
      return {
        sku: p.sku,
        nome: p.nome,
        custo: p.custo ?? 0,
        sold_qty: sold.qty,
        available_qty: available,
        sold_value: sold.value,
        inventory_value: (p.custo ?? 0) * available,
      };
    });
    exportToCSV(data, "inventory_control", [
      { key: "sku", label: "Product SKU" },
      { key: "nome", label: "Product Name" },
      { key: "custo", label: "Cost" },
      { key: "sold_qty", label: "Sold Quantity" },
      { key: "available_qty", label: "Available Quantity" },
      { key: "sold_value", label: "Sold Value" },
      { key: "inventory_value", label: "Inventory Value" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Inventory Control</h2>
        <Button onClick={handleExport} className="gap-1" size="sm">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Category</label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Name</label>
          <Input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Code</label>
          <Input value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} placeholder="" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Last Modified From</label>
          <Input type="date" value={lastModifiedFilter} onChange={(e) => setLastModifiedFilter(e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button onClick={handleSearch} className="gap-1">
            <Search className="h-4 w-4" /> Search
          </Button>
        </div>
      </div>

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="mb-2 flex gap-1">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
            <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p)}>
              {p}
            </Button>
          ))}
          {totalPages > 10 && <span className="px-2 text-sm text-muted-foreground">...</span>}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Product SKU</TableHead>
                <TableHead className="text-primary">Product Name</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Sold Quantity</TableHead>
                <TableHead className="text-right">Available Quantity</TableHead>
                <TableHead className="text-right">Sold Value</TableHead>
                <TableHead className="text-right">Inventory Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedProducts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No products found.</TableCell></TableRow>
              ) : (
                paginatedProducts.map((p) => {
                  const sold = soldMap[p.id] || { qty: 0, value: 0 };
                  const available = p.estoque_total - p.estoque_reservado;
                  const inventoryValue = (p.custo ?? 0) * available;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-primary font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="text-primary">{p.nome}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.custo ?? 0)}</TableCell>
                      <TableCell className="text-right">{formatNumber(sold.qty)}</TableCell>
                      <TableCell className="text-right">{formatNumber(available)}</TableCell>
                      <TableCell className={`text-right ${sold.value > 0 ? "text-green-400" : ""}`}>{formatCurrency(sold.value)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(inventoryValue)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length} products</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default InventoryControl;
