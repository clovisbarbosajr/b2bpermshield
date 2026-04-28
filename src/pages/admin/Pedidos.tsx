import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, ChevronLeft, ChevronRight, Pencil, X, Download } from "lucide-react";
import { toast } from "sonner";

const statusOptions = [
  { value: "recebido", label: "Submitted" },
  { value: "concluido", label: "Complete" },
  { value: "cancelado", label: "Cancelled" },
];

const statusClasses: Record<string, string> = {
  recebido: "bg-muted text-foreground",
  concluido: "bg-primary/15 text-primary",
  cancelado: "bg-destructive/15 text-destructive",
};

const PAGE_SIZE = 25;

const emptyFilters = {
  fromDeliveryDate: "",
  toDeliveryDate: "",
  fromDate: "",
  toDate: "",
  status: "",
  containsProductSku: "",
  category: "",
  paymentOption: "",
  isPaid: "",
  shippingOption: "",
  id: "",
  company: "",
  fullName: "",
  phone: "",
  email: "",
  country: "",
  state: "",
  purchaseOrder: "",
  hasInvoice: "",
  salesRep: "",
  submittedBy: "",
  withBackorderedItems: "",
  productSku: "",
};

const AdminPedidos = () => {
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [categories, setCategories] = useState<any[]>([]);
  const [paymentOpts, setPaymentOpts] = useState<any[]>([]);
  const [shippingOpts, setShippingOpts] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    const [{ data }, { data: cats }, { data: payOpts }, { data: shipOpts }, { data: repData }] = await Promise.all([
      supabase.from("pedidos").select("*, clientes(nome, empresa, email, telefone)").order("created_at", { ascending: false }),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("payment_options").select("id, nome").eq("ativo", true).order("ordem"),
      supabase.from("shipping_options").select("id, nome").eq("ativo", true).order("ordem"),
      supabase.from("representantes").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    const orderList = data ?? [];
    // Fetch real item quantities for all orders
    if (orderList.length > 0) {
      const ids = orderList.map((o: any) => o.id);
      // Fetch in batches of 200 to avoid query limits
      const qtyMap: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const { data: items } = await supabase
          .from("pedido_itens")
          .select("pedido_id, quantidade")
          .in("pedido_id", batch);
        (items ?? []).forEach((it: any) => {
          qtyMap[it.pedido_id] = (qtyMap[it.pedido_id] ?? 0) + (it.quantidade ?? 0);
        });
      }
      orderList.forEach((o: any) => {
        o._real_qty = qtyMap[o.id] ?? 0;
      });
    }
    setPedidos(orderList);
    setCategories(cats ?? []);
    setPaymentOpts(payOpts ?? []);
    setShippingOpts(shipOpts ?? []);
    setReps(repData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (pedidoId: string, newStatus: string) => {
    const { error } = await supabase.from("pedidos").update({ status: newStatus as any }).eq("id", pedidoId);
    if (error) {
      toast.error("Error updating status");
      return;
    }
    setPedidos((prev) => prev.map((p) => p.id === pedidoId ? { ...p, status: newStatus } : p));
    toast.success("Status updated");
  };

  const fmt = (v: number) => `$ ${Number(v).toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

  const setFilter = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const clearFilters = () => setFilters({ ...emptyFilters });

  const filtered = pedidos.filter((p) => {
    const f = filters;
    if (f.id && !String(p.numero).includes(f.id)) return false;
    if (f.company && !(p.clientes?.empresa ?? "").toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.fullName && !(p.clientes?.nome ?? "").toLowerCase().includes(f.fullName.toLowerCase())) return false;
    if (f.phone && !(p.clientes?.telefone ?? "").includes(f.phone)) return false;
    if (f.email && !(p.clientes?.email ?? "").toLowerCase().includes(f.email.toLowerCase())) return false;
    if (f.purchaseOrder && !(p.po_number ?? "").toLowerCase().includes(f.purchaseOrder.toLowerCase())) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.fromDate && new Date(p.created_at) < new Date(f.fromDate)) return false;
    if (f.toDate && new Date(p.created_at) > new Date(f.toDate + "T23:59:59")) return false;
    if (f.fromDeliveryDate && (!p.delivery_date || new Date(p.delivery_date) < new Date(f.fromDeliveryDate))) return false;
    if (f.toDeliveryDate && (!p.delivery_date || new Date(p.delivery_date) > new Date(f.toDeliveryDate + "T23:59:59"))) return false;
    if (f.shippingOption && p.shipping_option_id !== f.shippingOption) return false;
    if (f.paymentOption && p.payment_option_id !== f.paymentOption) return false;
    if (f.state && !(p.clientes?.estado ?? "").toLowerCase().includes(f.state.toLowerCase())) return false;
    if (f.country && f.country !== "__all__" && !(p.clientes?.pais ?? "").toLowerCase().includes(f.country.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map((p) => p.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusLabel = (status: string) => statusOptions.find((s) => s.value === status)?.label ?? status;

  return (
    <AdminLayout>
      <h2 className="font-display text-2xl font-semibold mb-4">Orders</h2>

      <Card className="mb-4 p-4 bg-card/80 backdrop-blur-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <div><Label className="text-xs text-primary">From delivery date</Label><Input type="date" value={filters.fromDeliveryDate} onChange={(e) => setFilter("fromDeliveryDate", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">To delivery date</Label><Input type="date" value={filters.toDeliveryDate} onChange={(e) => setFilter("toDeliveryDate", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">From Date</Label><Input type="date" value={filters.fromDate} onChange={(e) => setFilter("fromDate", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">To Date</Label><Input type="date" value={filters.toDate} onChange={(e) => setFilter("toDate", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">Status</Label>
            <Select value={filters.status || "__all__"} onValueChange={(v) => setFilter("status", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs text-primary">Contains product SKU</Label><Input value={filters.containsProductSku} onChange={(e) => setFilter("containsProductSku", e.target.value)} className="h-8" /></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm mt-3">
          <div>
            <Label className="text-xs text-primary">Category</Label>
            <Select value={filters.category || "__all__"} onValueChange={(v) => setFilter("category", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose category</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Payment option</Label>
            <Select value={filters.paymentOption || "__all__"} onValueChange={(v) => setFilter("paymentOption", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {paymentOpts.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Is paid?</Label>
            <Select value={filters.isPaid || "__all__"} onValueChange={(v) => setFilter("isPaid", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Shipping option</Label>
            <Select value={filters.shippingOption || "__all__"} onValueChange={(v) => setFilter("shippingOption", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {shippingOpts.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 text-sm mt-3">
          <div><Label className="text-xs text-primary">Id</Label><Input value={filters.id} onChange={(e) => setFilter("id", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Company</Label><Input value={filters.company} onChange={(e) => setFilter("company", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Full Name</Label><Input value={filters.fullName} onChange={(e) => setFilter("fullName", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Phone</Label><Input value={filters.phone} onChange={(e) => setFilter("phone", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Email</Label><Input value={filters.email} onChange={(e) => setFilter("email", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">Country</Label>
            <Select value={filters.country || "__all__"} onValueChange={(v) => setFilter("country", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">Please select...</SelectItem><SelectItem value="United States">United States</SelectItem><SelectItem value="Canada">Canada</SelectItem><SelectItem value="Brazil">Brazil</SelectItem></SelectContent>
            </Select>
          </div>
          <div />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 text-sm mt-3">
          <div><Label className="text-xs text-primary">State</Label><Input value={filters.state} onChange={(e) => setFilter("state", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Purchase order</Label><Input value={filters.purchaseOrder} onChange={(e) => setFilter("purchaseOrder", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">Has Invoice?</Label>
            <Select value={filters.hasInvoice || "__all__"} onValueChange={(v) => setFilter("hasInvoice", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Sales Rep</Label>
            <Select value={filters.salesRep || "__all__"} onValueChange={(v) => setFilter("salesRep", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs text-primary">Submitted By</Label><Input value={filters.submittedBy} onChange={(e) => setFilter("submittedBy", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">With backordered items</Label>
            <Select value={filters.withBackorderedItems || "__all__"} onValueChange={(v) => setFilter("withBackorderedItems", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
          <div />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 text-sm mt-3">
          <div><Label className="text-xs text-primary">Product SKU</Label><Input value={filters.productSku} onChange={(e) => setFilter("productSku", e.target.value)} className="h-8" /></div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1"><X className="h-3 w-3" /> Clear</Button>
        </div>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <Button onClick={() => navigate("/admin/orders/new")} className="gap-1 bg-green-600 hover:bg-green-700"><Plus className="h-4 w-4" /> Create Order</Button>
        <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
          {Array.from({ length: Math.min(totalPages, 9) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 9) pageNum = i + 1;
            else if (i < 7) pageNum = i + 1;
            else if (i === 7) pageNum = totalPages - 1;
            else pageNum = totalPages;
            return <Button key={i} variant={page === pageNum ? "default" : "outline"} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(pageNum)}>{i === 7 && totalPages > 9 && pageNum !== 8 ? "..." : pageNum}</Button>;
          })}
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3 w-3" /></Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <Card className="bg-card/80 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={paginated.length > 0 && selected.size === paginated.length} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Id</TableHead>
                <TableHead>Date ▼</TableHead>
                <TableHead>Delivery date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Total Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/orders/${p.id}`)}>
                  <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} /></TableCell>
                  <TableCell className="font-medium">{p.numero}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(p.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{p.delivery_date ? fmtDate(p.delivery_date) : ""}</TableCell>
                  <TableCell>{p.clientes?.empresa || p.clientes?.nome || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.po_number || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.clientes?.email || ""}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.clientes?.telefone || ""}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(p.total || p.subtotal || 0)}</TableCell>
                  <TableCell className="text-right">{p._real_qty || p.quantidade_total || 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select value={p.status} onValueChange={(val) => handleStatusChange(p.id, val)}>
                      <SelectTrigger className={`h-7 w-[150px] border-0 text-xs ${statusClasses[p.status] || "bg-muted text-foreground"}`}>
                        <SelectValue>{getStatusLabel(p.status)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/admin/orders/${p.id}`)} title="Edit order"><Pencil className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {paginated.length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No orders found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default AdminPedidos;
