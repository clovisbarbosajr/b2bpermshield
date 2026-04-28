import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Download } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "", label: "Please select..." },
  { value: "recebido", label: "Submitted" },
  { value: "em_processamento", label: "Processing" },
  { value: "enviado", label: "Shipped" },
  { value: "concluido", label: "Complete" },
  { value: "cancelado", label: "Cancelled" },
];

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    recebido: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    em_processamento: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    enviado: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    concluido: "bg-green-500/20 text-green-400 border-green-500/30",
    cancelado: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const label: Record<string, string> = {
    recebido: "SUBMITTED", em_processamento: "PROCESSING",
    enviado: "SHIPPED", concluido: "COMPLETE", cancelado: "CANCELLED",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {label[status] ?? status.toUpperCase()}
    </span>
  );
};

const PAGE_SIZE = 10;

const Pedidos = () => {
  const { user, impersonatedCustomer } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [reordering, setReordering] = useState<string | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reference, setReference] = useState("");
  const [applied, setApplied] = useState({ fromDate: "", toDate: "", status: "", reference: "" });

  const fmtDate = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  };
  const fmtDateShort = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  // Load cliente ID once
  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;
      const q = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id").eq("user_id", user!.id).maybeSingle();
      const { data } = await q;
      setClienteId(data?.id ?? null);
    };
    fetch();
  }, [user, impersonatedCustomer]);

  // Load orders
  useEffect(() => {
    if (!clienteId) { setLoading(false); return; }
    const fetchOrders = async () => {
      setLoading(true);
      let q = supabase.from("pedidos").select("*", { count: "exact" })
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (applied.fromDate) q = q.gte("created_at", applied.fromDate);
      if (applied.toDate) q = q.lte("created_at", applied.toDate + "T23:59:59");
      if (applied.status && applied.status !== "_all") q = q.eq("status", applied.status);
      if (applied.reference) q = q.ilike("po_number", `%${applied.reference}%`);

      const { data, count } = await q;
      setPedidos(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    };
    fetchOrders();
  }, [clienteId, page, applied]);

  const handleSearch = () => {
    setPage(1);
    setApplied({ fromDate, toDate, status: statusFilter, reference });
  };

  const handleClear = () => {
    setFromDate(""); setToDate(""); setStatusFilter(""); setReference("");
    setPage(1);
    setApplied({ fromDate: "", toDate: "", status: "", reference: "" });
  };

  const handleReorder = async (pedidoId: string) => {
    setReordering(pedidoId);
    const { data: itens } = await supabase.from("pedido_itens").select("*").eq("pedido_id", pedidoId);
    if (!itens || itens.length === 0) { toast.error("No items found"); setReordering(null); return; }
    const productIds = itens.map((i: any) => i.produto_id);
    const { data: prods } = await supabase.from("produtos")
      .select("id, preco, estoque_total, estoque_reservado, quantidade_minima, unidade_venda, imagem_url")
      .in("id", productIds);
    const prodMap = new Map((prods ?? []).map((p: any) => [p.id, p]));
    let added = 0;
    for (const item of itens) {
      const prod = prodMap.get(item.produto_id);
      if (!prod) continue;
      const disponivel = (prod.estoque_total ?? 0) - (prod.estoque_reservado ?? 0);
      addItem({
        produto_id: item.produto_id,
        nome: item.nome_produto,
        sku: item.sku ?? "",
        preco: prod.preco ?? item.preco_unitario,
        quantidade: Math.min(item.quantidade, Math.max(disponivel, 1)),
        unidade_venda: prod.unidade_venda ?? "UN",
        quantidade_minima: prod.quantidade_minima ?? 1,
        estoque_disponivel: Math.max(disponivel, 99),
        imagem_url: prod.imagem_url ?? null,
      });
      added++;
    }
    toast.success(`${added} item(s) added to cart`);
    navigate("/portal/carrinho");
    setReordering(null);
  };

  const handleExport = () => {
    const rows = [
      ["ID", "Date", "Delivery Date", "Total", "Quantity", "Status"],
      ...pedidos.map(p => [
        p.numero, fmtDate(p.created_at), fmtDateShort(p.delivery_date ?? ""),
        Number(p.total).toFixed(2), p.quantidade_total ?? "", p.status,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = "order-history.csv";
    a.click();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1, 2, 3, 4, 5, 6, 7);
      if (totalPages > 8) pages.push("...", totalPages - 1, totalPages);
    }
    return pages;
  };

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground border-b pb-3">
        <button onClick={() => navigate("/portal")} className="hover:text-primary">Home</button>
        <span>|</span>
        <span className="text-foreground font-medium">Order history</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Order History</h2>
        <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
          <Download className="h-4 w-4" /> EXPORT
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-card rounded-lg border">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">From Date</p>
          <Input type="date" className="h-8 w-36 text-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">To Date</p>
          <Input type="date" className="h-8 w-36 text-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Status</p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="Please select..." /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value || "_all"}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Reference</p>
          <Input className="h-8 w-32 text-sm" placeholder="#" value={reference} onChange={e => setReference(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()} />
        </div>
        <button onClick={handleClear} className="text-sm text-muted-foreground hover:text-foreground underline">CLEAR</button>
        <Button size="sm" onClick={handleSearch}>SEARCH</Button>
      </div>

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">‹</button>
          {pageNumbers().map((n, i) =>
            n === "..." ? (
              <span key={i} className="px-2 py-1 text-sm text-muted-foreground">...</span>
            ) : (
              <button
                key={i}
                onClick={() => setPage(Number(n))}
                className={`px-2.5 py-1 text-sm rounded ${page === n ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >{n}</button>
            )
          )}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">›</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center py-16">
          <ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No orders found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                {["ID", "DATE", "DELIVERY DATE", "TOTAL", "QUANTITY", "STATUS", "LAST UPDATE", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pedidos.map(p => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{p.numero}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(p.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDateShort(p.delivery_date ?? "")}</td>
                  <td className="px-4 py-3 font-medium">${Number(p.total).toFixed(2)}</td>
                  <td className="px-4 py-3">{p.quantidade_total ?? "-"}</td>
                  <td className="px-4 py-3">{statusBadge(p.status)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(p.updated_at ?? p.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/portal/pedidos/${p.id}`)}>
                        VIEW
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                        disabled={reordering === p.id}
                        onClick={() => handleReorder(p.id)}
                      >
                        {reordering === p.id ? "..." : "RE-ORDER"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 mt-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">‹</button>
          {pageNumbers().map((n, i) =>
            n === "..." ? (
              <span key={i} className="px-2 py-1 text-sm text-muted-foreground">...</span>
            ) : (
              <button
                key={i}
                onClick={() => setPage(Number(n))}
                className={`px-2.5 py-1 text-sm rounded ${page === n ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >{n}</button>
            )
          )}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">›</button>
        </div>
      )}
    </PortalLayout>
  );
};

export default Pedidos;
