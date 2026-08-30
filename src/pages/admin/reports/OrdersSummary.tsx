import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";
import { canonicalStatus, statusBadge, statusLabel } from "@/lib/orderStatuses";

const STATUSES = ["submitted", "ready_for_pickup", "partial", "on_hold", "sent", "complete", "cancelled"];
const PAGE_SIZE = 25;

const OrdersSummary = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [itemsCount, setItemsCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      // Paginado (fetchAllRows): o PostgREST corta em 1000 linhas SEM erro.
      const [ord, cli, its] = await Promise.all([
        fetchAllRows((f, t) => supabase.from("pedidos").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("clientes").select("id, nome, empresa").order("id", { ascending: true }).range(f, t)),
        fetchAllRows<{ pedido_id: string }>((f, t) => supabase.from("pedido_itens").select("id, pedido_id").order("id", { ascending: true }).range(f, t) as any),
      ]);
      setOrders(ord);
      setCustomers(cli);
      const counts: Record<string, number> = {};
      its.forEach((i) => { counts[i.pedido_id] = (counts[i.pedido_id] || 0) + 1; });
      setItemsCount(counts);
      setLoading(false);
    };
    fetch().catch((e) => {
      // fetchAllRows LANCA em erro (antes o `.data ?? []` engolia). Sem este catch
      // o setLoading(false) nunca rodava: spinner eterno + unhandled rejection.
      console.error(e);
      toast.error("Could not load this report. Try again.");
      setLoading(false);
    });
  }, []);

  const custMap = useMemo(() => {
    const m: Record<string, { nome: string; empresa: string }> = {};
    customers.forEach((c) => (m[c.id] = { nome: c.nome, empresa: c.empresa }));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && canonicalStatus(o.status) !== statusFilter) return false;
      // Date-only e parseado como UTC; date-time sem offset, como LOCAL. Sem o
      // "T00:00:00" as duas pontas do filtro ficavam em fusos diferentes e o
      // "From" trazia horas do dia ANTERIOR.
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom + "T00:00:00")) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59.999")) return false;
      return true;
    });
  }, [orders, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(filtered.map((o) => {
      const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
      // `statusLabel`, e nao o status CRU. `orderStatuses.ts` se declara fonte
      // unica e mapeia os legados PT->EN (`recebido` -> Submitted); esta tela ja
      // usa `canonicalStatus` no filtro e `statusLabel` na grade, e o export era
      // o unico ponto que furava. O admin filtrava "Submitted", via "Submitted",
      // e recebia um CSV com `recebido` misturado a `submitted` — quem filtrasse
      // a planilha por "Submitted" nao achava os pedidos antigos.
      return { numero: o.numero, customer: c.nome, company: c.empresa, status: statusLabel(o.status), items: itemsCount[o.id] || 0, subtotal: o.subtotal, total: o.total, date: new Date(o.created_at).toLocaleDateString() };
    }), "orders_summary", [
      { key: "numero", label: "Order #" },
      { key: "customer", label: "Customer" },
      { key: "company", label: "Company" },
      { key: "status", label: "Status" },
      { key: "items", label: "Items" },
      { key: "subtotal", label: "Subtotal" },
      { key: "total", label: "Total" },
      { key: "date", label: "Date" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Orders Summary</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">From</label><Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">To</label><Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} /></div>
      </div>
      {/* Summary cards — SO depois de carregar.
          Estavam FORA do ramo de `loading`, entao durante a carga inteira a tela
          mostrava cinco cards com `0` e `$0.00` como se fossem o resultado, com o
          spinner logo abaixo. Zero durante a carga e indistinguivel de zero de
          verdade, e isso acontecia em TODA abertura, nao so quando falhava. */}
      {!loading && (
      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.map((s) => {
          const count = filtered.filter((o) => canonicalStatus(o.status) === s).length;
          const total = filtered.filter((o) => canonicalStatus(o.status) === s).reduce((a, o) => a + o.total, 0);
          return (
            <div key={s} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground capitalize">{s.replace(/_/g, " ")}</p>
              <p className="text-lg font-bold">{count}</p>
              <p className="text-xs text-muted-foreground">{formatCurrency(total)}</p>
            </div>
          );
        })}
      </div>
      )}
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No orders.</TableCell></TableRow>
              ) : paginated.map((o) => {
                const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-primary font-mono">#{o.numero}</TableCell>
                    <TableCell>{c.nome}</TableCell>
                    <TableCell>{c.empresa}</TableCell>
                    <TableCell><Badge className={statusBadge(o.status)}>{statusLabel(o.status)}</Badge></TableCell>
                    <TableCell className="text-right">{itemsCount[o.id] || 0}</TableCell>
                    <TableCell className="text-right">{formatCurrency(o.total)}</TableCell>
                    <TableCell>{new Date(o.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default OrdersSummary;
