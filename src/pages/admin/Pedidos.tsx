import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { paginasVisiveis } from "@/lib/paginacao";
import { escaparCelulaCSV } from "@/lib/export-csv";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { descendantIds } from "@/lib/categoryTree";
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
import { ORDER_STATUSES, statusLabel, statusBadge, canonicalStatus } from "@/lib/orderStatuses";
import { categoryTreeOptions } from "@/lib/categoryTree";

// Os 7 status do B2BWave (fonte única).
const statusOptions = ORDER_STATUSES;

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
  // produto_id -> categoria_id, pro filtro de categoria (que inclui subcategorias).
  const [prodCategoria, setProdCategoria] = useState<Record<string, string | null>>({});

  const fetchData = useCallback(async () => {
    try {
      // `fetchAllRows` (já usado nos 13 relatórios): o PostgREST corta em 1000
      // linhas SEM erro. Como a paginação desta tela é toda no navegador, acima
      // de 1000 pedidos os MAIS ANTIGOS sumiam da lista, da busca, do contador de
      // páginas e do Export — sem nenhum aviso. A base já tem ~884 pedidos.
      const [orderList, cats, payOpts, shipOpts, repData] = await Promise.all([
        fetchAllRows((f, t) => supabase.from("pedidos")
          .select("*, clientes(nome, empresa, email, telefone)")
          .order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("nome").order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("payment_options").select("id, nome").eq("ativo", true).order("ordem").order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("shipping_options").select("id, nome").eq("ativo", true).order("ordem").order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("representantes").select("id, nome").eq("ativo", true).order("nome").order("id", { ascending: true }).range(f, t)),
      ]);

      // Quantidade e SKUs reais por pedido. Antes o lote era de 200 pedidos com a
      // query SEM paginar: 200 pedidos × 6 itens estoura as 1000 linhas e o
      // "Total Quantity" saía menor que o real. Agora pagina de verdade, e de
      // quebra traz `sku`/`backorder` pros filtros que não funcionavam.
      if (orderList.length > 0) {
        const ids = orderList.map((o: any) => o.id);
        const qtyMap: Record<string, number> = {};
        const skuMap: Record<string, string[]> = {};
        const prodMap: Record<string, string[]> = {};
        const backorderIds = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const batch = ids.slice(i, i + 200);
          const items = await fetchAllRows<any>((f, t) => supabase
            .from("pedido_itens")
            .select("pedido_id, produto_id, quantidade, sku, backorder")
            .in("pedido_id", batch).order("id", { ascending: true }).range(f, t) as any);
          items.forEach((it: any) => {
            qtyMap[it.pedido_id] = (qtyMap[it.pedido_id] ?? 0) + (it.quantidade ?? 0);
            if (it.sku) (skuMap[it.pedido_id] ??= []).push(String(it.sku).toLowerCase());
            if (it.produto_id) (prodMap[it.pedido_id] ??= []).push(it.produto_id);
            if (it.backorder) backorderIds.add(it.pedido_id);
          });
        }
        orderList.forEach((o: any) => {
          o._real_qty = qtyMap[o.id] ?? 0;
          o._skus = skuMap[o.id] ?? [];
          o._produtos = prodMap[o.id] ?? [];
          o._has_backorder = backorderIds.has(o.id);
        });
      }

      // Categoria de cada produto, pro filtro por categoria (que inclui as
      // subcategorias, igual ao portal).
      const prods = await fetchAllRows<any>((f, t) =>
        supabase.from("produtos").select("id, categoria_id").order("id", { ascending: true }).range(f, t) as any);
      setProdCategoria(Object.fromEntries(prods.map((p: any) => [p.id, p.categoria_id])));

      setPedidos(orderList);
      setCategories(cats as any[]);
      setPaymentOpts(payOpts as any[]);
      setShippingOpts(shipOpts as any[]);
      setReps(repData as any[]);
    } catch (e: any) {
      // Antes o erro era ignorado: a tela mostrava "No orders found" com cara de
      // banco vazio, sem nada no console pro dono ver.
      console.error(e);
      toast.error("Could not load orders. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (pedidoId: string, newStatus: string) => {
    // Concluir/desconcluir MEXE NO ESTOQUE (trigger fn_adjust_stock_on_order_status).
    // Este select fica dentro da LINHA da tabela, então é fácil errar de pedido —
    // e a baixa é imediata. Confirma antes.
    const atual = pedidos.find((p) => p.id === pedidoId);
    const virandoDone = canonicalStatus(newStatus) === "complete";
    const saindoDeDone = canonicalStatus(atual?.status ?? "") === "complete";
    if (virandoDone || saindoDeDone) {
      const numero = atual?.numero ?? "";
      const msg = virandoDone
        ? `Mark order #${numero} as Complete? This deducts the ordered quantities from stock.`
        : `Move order #${numero} out of Complete? This puts the ordered quantities back into stock.`;
      if (!confirm(msg)) return;
    }
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

  const handleExport = () => {
    // `escaparCelulaCSV`: aspas resolvem virgula, NAO resolvem formula — o Excel
    // tira as aspas e avalia a celula. Campos gravaveis pelo cliente saem aqui.
    const esc = escaparCelulaCSV;
    const rows = [
      ["Order", "Company", "Name", "Email", "PO", "Status", "Total", "Created"],
      ...filtered.map((p) => [
        p.numero, p.clientes?.empresa, p.clientes?.nome, p.clientes?.email,
        p.po_number, p.status, Number(p.total ?? 0).toFixed(2), fmtDate(p.created_at),
      ]),
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "orders.csv";
    a.click();
  };

  const filtered = pedidos.filter((p) => {
    const f = filters;
    if (f.id && !String(p.numero).includes(f.id)) return false;
    if (f.company && !(p.clientes?.empresa ?? "").toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.fullName && !(p.clientes?.nome ?? "").toLowerCase().includes(f.fullName.toLowerCase())) return false;
    if (f.phone && !(p.clientes?.telefone ?? "").includes(f.phone)) return false;
    if (f.email && !(p.clientes?.email ?? "").toLowerCase().includes(f.email.toLowerCase())) return false;
    if (f.purchaseOrder && !(p.po_number ?? "").toLowerCase().includes(f.purchaseOrder.toLowerCase())) return false;
    if (f.status && canonicalStatus(p.status) !== f.status) return false;
    if (f.fromDate && new Date(p.created_at) < new Date(f.fromDate)) return false;
    if (f.toDate && new Date(p.created_at) > new Date(f.toDate + "T23:59:59")) return false;
    if (f.fromDeliveryDate && (!p.delivery_date || new Date(p.delivery_date) < new Date(f.fromDeliveryDate))) return false;
    if (f.toDeliveryDate && (!p.delivery_date || new Date(p.delivery_date) > new Date(f.toDeliveryDate + "T23:59:59"))) return false;
    if (f.shippingOption && p.shipping_option_id !== f.shippingOption) return false;
    if (f.paymentOption && p.payment_option_id !== f.paymentOption) return false;
    if (f.state && !(p.clientes?.estado ?? "").toLowerCase().includes(f.state.toLowerCase())) return false;
    if (f.country && f.country !== "__all__" && !(p.clientes?.pais ?? "").toLowerCase().includes(f.country.toLowerCase())) return false;

    // ===== FILTROS QUE APARECIAM NA TELA E NÃO FILTRAVAM NADA =====
    // Estavam renderizados mas não entravam neste `filtered`. Pior que não existir:
    // o admin selecionava "Is paid? No", via a lista igual e tirava conclusão
    // errada — e o Export come este mesmo `filtered`, então o CSV saía junto.
    if (f.isPaid === "yes" && !p.is_paid) return false;
    if (f.isPaid === "no" && p.is_paid) return false;
    if (f.withBackorderedItems === "yes" && !p._has_backorder) return false;
    if (f.withBackorderedItems === "no" && p._has_backorder) return false;
    const skus: string[] = p._skus ?? [];
    if (f.productSku && !skus.some((s) => s === f.productSku.trim().toLowerCase())) return false;
    if (f.containsProductSku && !skus.some((s) => s.includes(f.containsProductSku.trim().toLowerCase()))) return false;
    if (f.category) {
      // Inclui as SUBCATEGORIAS, igual ao portal (`Catalogo.tsx` usa `descendantIds`).
      // Sem isso, escolher a categoria-pai devolvia quase nada.
      const alvo = new Set(descendantIds(categories as any, f.category));
      const temNaCategoria = (p._produtos ?? []).some((pid: string) => {
        const cat = prodCategoria[pid];
        return cat && alvo.has(cat);
      });
      if (!temNaCategoria) return false;
    }
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

  const getStatusLabel = (status: string) => statusLabel(status);

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
                {categoryTreeOptions(categories).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
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

        {/* 8 campos em grid de 4 colunas = 2 fileiras cheias (sem buracos — os filtros
            Phone/Email/Country/Sales Rep/Submitted By foram removidos a pedido). */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm mt-3">
          <div><Label className="text-xs text-primary">Id</Label><Input value={filters.id} onChange={(e) => setFilter("id", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Company</Label><Input value={filters.company} onChange={(e) => setFilter("company", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Full Name</Label><Input value={filters.fullName} onChange={(e) => setFilter("fullName", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">State</Label><Input value={filters.state} onChange={(e) => setFilter("state", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Purchase order</Label><Input value={filters.purchaseOrder} onChange={(e) => setFilter("purchaseOrder", e.target.value)} className="h-8" /></div>
          {/* "Has Invoice?" REMOVIDO: não existe dado de nota por pedido. O único
              campo de invoice é `configuracoes.enable_invoice`, que é global do
              sistema. O controle estava na tela sem nunca filtrar nada — não era
              filtro esquecido, era filtro impossível. Se um dia existir
              `pedidos.invoice_*`, é aqui que ele volta. */}
          <div>
            <Label className="text-xs text-primary">With backordered items</Label>
            <Select value={filters.withBackorderedItems || "__all__"} onValueChange={(v) => setFilter("withBackorderedItems", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs text-primary">Product SKU</Label><Input value={filters.productSku} onChange={(e) => setFilter("productSku", e.target.value)} className="h-8" /></div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1"><X className="h-3 w-3" /> Clear</Button>
        </div>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <Button onClick={() => navigate("/admin/orders/new")} className="gap-1 bg-green-600 hover:bg-green-700"><Plus className="h-4 w-4" /> Create Order</Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}><Download className="h-4 w-4" /> Export</Button>
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
          {/* `paginasVisiveis` no lugar da janela fixa. A antiga mostrava sempre
              `1..7` mais as duas ultimas: com 20 paginas, as paginas 8 a 18 nao
              tinham botao. E o item rotulado `...` era um Button que levava para
              `totalPages - 1` — clicar nas reticencias jogava o admin na
              penultima pagina sem avisar. Agora `...` e texto. */}
          {paginasVisiveis(page, totalPages).map((n, i) =>
            n === "..." ? (
              <span key={`e${i}`} className="px-1 text-xs text-muted-foreground select-none">...</span>
            ) : (
              <Button key={n} variant={page === n ? "default" : "outline"} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(n)}>{n}</Button>
            ),
          )}
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
                    <Select value={canonicalStatus(p.status)} onValueChange={(val) => handleStatusChange(p.id, val)}>
                      <SelectTrigger className={`h-7 w-[150px] border-0 text-xs ${statusBadge(p.status)}`}>
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
