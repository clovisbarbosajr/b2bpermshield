import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Search, Image as ImageIcon, Eye, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useActivityLog } from "@/hooks/useActivityLog";

const PAGE_SIZE = 25;

const statusOptions = [
  { value: "disponivel", label: "Available" },
  { value: "estoque_limitado", label: "Limited Stock" },
  { value: "pre_venda", label: "Pre-order" },
  { value: "indisponivel", label: "Not available" },
  { value: "esgotado", label: "Sold Out" },
];

type Produto = {
  id: string; nome: string; sku: string; preco: number; ativo: boolean;
  estoque_total: number; estoque_reservado: number; categoria_id: string | null;
  imagem_url: string | null; status_produto: string | null; preco_msrp: number | null;
  custo: number | null; created_at: string; updated_at: string;
};
type Categoria = { id: string; nome: string };
type Brand = { id: string; nome: string };

const emptyFilters = {
  name: "", code: "", category: "", isActive: "Active", status: "",
  brand: "", privacyGroup: "", allowBackorder: "",
};

const AdminProdutos = () => {
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // Price lists for columns
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [priceData, setPriceData] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    const fetchAll = async () => {
      const [p, c, b, pg, pl] = await Promise.all([
        supabase.from("produtos").select("*").order("nome"),
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("brands").select("id, nome").order("nome"),
        supabase.from("privacy_groups").select("id, nome").eq("ativo", true),
        supabase.from("tabelas_preco").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      setProdutos((p.data as Produto[]) ?? []);
      setCategorias(c.data ?? []);
      setBrands(b.data ?? []);
      setPrivacyGroups(pg.data ?? []);
      setPriceLists(pl.data ?? []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const setFilter = (key: string, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setPage(1);
  };

  const clearFilters = () => { setFilters({ ...emptyFilters }); setPage(1); };

  const getCategoryName = (id: string | null) => {
    if (!id) return "—";
    return categorias.find(c => c.id === id)?.nome ?? "—";
  };

  const filtered = produtos.filter(p => {
    if (filters.name && !p.nome.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.code && !p.sku.toLowerCase().includes(filters.code.toLowerCase())) return false;
    if (filters.category && p.categoria_id !== filters.category) return false;
    if (filters.isActive === "Active" && !p.ativo) return false;
    if (filters.isActive === "Inactive" && p.ativo) return false;
    if (filters.status && p.status_produto !== filters.status) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  };

  const handleStatusChange = async (productId: string, newStatus: string) => {
    const { error } = await supabase.from("produtos").update({ status_produto: newStatus }).eq("id", productId);
    if (error) { toast.error(error.message); return; }
    setProdutos(prev => prev.map(p => p.id === productId ? { ...p, status_produto: newStatus } : p));
  };

  const handleActiveChange = async (productId: string, newActive: string) => {
    const ativo = newActive === "Active";
    const { error } = await supabase.from("produtos").update({ ativo }).eq("id", productId);
    if (error) { toast.error(error.message); return; }
    setProdutos(prev => prev.map(p => p.id === productId ? { ...p, ativo } : p));
  };

  const handleDelete = async (e: React.MouseEvent, productId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this product?")) return;
    const produto = produtos.find(p => p.id === productId);
    const { error } = await supabase.from("produtos").delete().eq("id", productId);
    if (error) { toast.error(error.message); return; }
    setProdutos(prev => prev.filter(p => p.id !== productId));
    toast.success("Product deleted");
    log("deleted", "product", productId, produto?.nome);
  };

  return (
    <AdminLayout>
      <h2 className="font-display text-2xl font-semibold mb-4">Products</h2>

      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <div>
            <Label className="text-xs text-primary">Name</Label>
            <Input value={filters.name} onChange={e => setFilter("name", e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs text-primary">Code</Label>
            <Input value={filters.code} onChange={e => setFilter("code", e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs text-primary">Category</Label>
            <Select value={filters.category || "__all__"} onValueChange={v => setFilter("category", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose category</SelectItem>
                {categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Is active?</Label>
            <Select value={filters.isActive || "__all__"} onValueChange={v => setFilter("isActive", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Status</Label>
            <Select value={filters.status || "__all__"} onValueChange={v => setFilter("status", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose Status</SelectItem>
                {statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Brand</Label>
            <Select value={filters.brand || "__all__"} onValueChange={v => setFilter("brand", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose brand</SelectItem>
                {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm mt-3">
          <div>
            <Label className="text-xs text-primary">Privacy group</Label>
            <Select value={filters.privacyGroup || "__all__"} onValueChange={v => setFilter("privacyGroup", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose privacy group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose privacy group</SelectItem>
                {privacyGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Allow Backorder</Label>
            <Select value={filters.allowBackorder || "__all__"} onValueChange={v => setFilter("allowBackorder", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1"><X className="h-3 w-3" /> Clear</Button>
        </div>
      </Card>

      {/* New product button */}
      <div className="flex items-center justify-between mb-3">
        <Button onClick={() => navigate("/admin/products/new")} className="gap-1 bg-green-600 hover:bg-green-700">
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          {Array.from({ length: Math.min(totalPages, 9) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 9) pageNum = i + 1;
            else if (i < 7) pageNum = i + 1;
            else if (i === 7) pageNum = totalPages - 1;
            else pageNum = totalPages;
            return (
              <Button key={i} variant={page === pageNum ? "default" : "outline"} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(pageNum)}>
                {i === 7 && totalPages > 9 && pageNum !== 8 ? "..." : pageNum}
              </Button>
            );
          })}
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16" />
                <TableHead className="text-primary">
                  <div>Code</div>
                  <div className="text-xs font-normal">Name</div>
                </TableHead>
                <TableHead className="text-primary">Category</TableHead>
                <TableHead className="text-primary">
                  <div>Quantity</div>
                  <div className="text-xs font-normal">Status</div>
                </TableHead>
                <TableHead className="text-primary">Active</TableHead>
                <TableHead className="text-primary">
                  <div>Retail</div>
                  <div className="text-xs font-normal">Wholesale Price</div>
                </TableHead>
                <TableHead className="text-primary">
                  <div>Created</div>
                  <div className="text-xs font-normal">Updated</div>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No products found</TableCell></TableRow>
              ) : paginated.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/products/${p.id}`)}>
                  <TableCell>
                    {p.imagem_url ? (
                      <img src={p.imagem_url} alt={p.nome} className="h-14 w-14 rounded object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded bg-muted">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-block rounded bg-primary/80 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground mb-0.5">{p.sku}</span>
                    <div className="text-primary hover:underline text-sm">{p.nome}</div>
                  </TableCell>
                  <TableCell className="text-sm">{getCategoryName(p.categoria_id)}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="text-xs mb-1">Quantity: {p.estoque_total - p.estoque_reservado}</div>
                    <Select
                      value={p.status_produto || "disponivel"}
                      onValueChange={v => handleStatusChange(p.id, v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Select
                      value={p.ativo ? "Active" : "Inactive"}
                      onValueChange={v => handleActiveChange(p.id, v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">${Number(p.preco_msrp || p.preco).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">${Number(p.preco).toFixed(2)}</div>
                    {p.custo != null && Number(p.custo) > 0 && (
                      <div className="text-xs text-muted-foreground">${Number(p.custo).toFixed(2)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    <div>{fmtDate(p.created_at)}</div>
                    <div className="text-muted-foreground">{fmtDate(p.updated_at)}</div>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => navigate(`/admin/products/${p.id}`)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => window.open(`/portal/produto/${p.id}`, '_blank')} title="Preview">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="icon" className="h-7 w-7 bg-destructive hover:bg-destructive/90" onClick={(e) => handleDelete(e, p.id)} title="Delete">
                        <X className="h-3.5 w-3.5 font-bold" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default AdminProdutos;
