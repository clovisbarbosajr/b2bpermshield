import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import { canonicalStatus } from "@/lib/orderStatuses";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download } from "lucide-react";
import { exportToCSV, formatCurrency, formatNumber } from "@/lib/export-csv";

const PAGE_SIZE = 25;

const PaymentActivity = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      // Paginado (fetchAllRows): o PostgREST corta em 1000 linhas SEM erro.
      const [ord, cli] = await Promise.all([
        fetchAllRows((f, t) => supabase.from("pedidos").select("id, numero, cliente_id, status, total, created_at, is_paid").order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
        fetchAllRows((f, t) => supabase.from("clientes").select("id, nome, empresa").order("id", { ascending: true }).range(f, t)),
      ]);
      setOrders(ord);
      setCustomers(cli);
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
      // `new Date("2026-08-01")` (so data) e parseado como UTC; com hora e
      // parseado como LOCAL. Sem o "T00:00:00" as duas pontas do filtro usavam
      // fusos diferentes e o "From" puxava horas do dia ANTERIOR.
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom + "T00:00:00")) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59.999")) return false;
      return true;
    });
  }, [orders, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // PAGAMENTO vem de `is_paid`, NAO do status do pedido.
  //
  // Antes este relatorio chamava de "Paid" tudo que estava com status
  // `complete` — ou seja, contava como recebido um pedido ENTREGUE e nao pago.
  // `is_paid` e o campo real: o admin marca em Order Detail, da pra filtrar por
  // ele na tela de Pedidos, e o checkout o define. Entregar e receber sao coisas
  // diferentes, e este e o relatorio de dinheiro.
  //
  // `cancelled` continua vindo do status: pedido cancelado sai da conta
  // independente de ter sido pago (se foi pago e cancelado, e estorno, nao
  // receita — e nao ha campo de estorno aqui).
  const pago = (o: any) => o.is_paid === true;
  const cancelado = (o: any) => canonicalStatus(o.status) === "cancelled";

  const totals = useMemo(() => {
    const paid = filtered.filter((o) => !cancelado(o) && pago(o)).reduce((a, o) => a + o.total, 0);
    const pending = filtered.filter((o) => !cancelado(o) && !pago(o)).reduce((a, o) => a + o.total, 0);
    const cancelled = filtered.filter(cancelado).reduce((a, o) => a + o.total, 0);
    return { paid, pending, cancelled, total: paid + pending };
  }, [filtered]);

  const paymentStatus = (o: any) => {
    if (cancelado(o)) return { label: "Cancelled", className: "bg-red-500/20 text-red-400" };
    if (pago(o)) return { label: "Paid", className: "bg-green-500/20 text-green-400" };
    return { label: "Pending", className: "bg-yellow-500/20 text-yellow-400" };
  };

  const handleExport = () => {
    exportToCSV(filtered.map((o) => {
      const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
      const ps = paymentStatus(o);
      return { numero: o.numero, customer: c.nome, company: c.empresa, payment_status: ps.label, total: o.total, date: new Date(o.created_at).toLocaleDateString() };
    }), "payment_activity", [
      { key: "numero", label: "Order #" },
      { key: "customer", label: "Customer" },
      { key: "company", label: "Company" },
      { key: "payment_status", label: "Payment Status" },
      { key: "total", label: "Amount" },
      { key: "date", label: "Date" },
    ]);
  };

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Payment Activity</h2>
        <Button onClick={handleExport} size="sm" className="gap-1"><Download className="h-4 w-4" /> Export</Button>
      </div>
      <div className="mb-4 flex gap-3 items-end">
        <div><label className="mb-1 block text-xs text-muted-foreground">From</label><Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">To</label><Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} /></div>
      </div>
      {/* Summary — SO depois de carregar.
          Estava FORA do ramo de `loading`: durante a carga inteira a tela exibia
          "Total Revenue $0.00" como se fosse o numero final. Zero durante a carga
          e indistinguivel de zero de verdade. */}
      {!loading && (
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-lg font-bold">{formatCurrency(totals.total)}</p></div>
        <div className="rounded-md border p-3"><p className="text-xs text-green-400">Paid</p><p className="text-lg font-bold text-green-400">{formatCurrency(totals.paid)}</p></div>
        <div className="rounded-md border p-3"><p className="text-xs text-yellow-400">Pending</p><p className="text-lg font-bold text-yellow-400">{formatCurrency(totals.pending)}</p></div>
        <div className="rounded-md border p-3"><p className="text-xs text-red-400">Cancelled</p><p className="text-lg font-bold text-red-400">{formatCurrency(totals.cancelled)}</p></div>
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
                <TableHead>Payment Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No orders.</TableCell></TableRow>
              ) : paginated.map((o) => {
                const c = custMap[o.cliente_id] || { nome: "—", empresa: "—" };
                const ps = paymentStatus(o);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-primary font-mono">#{o.numero}</TableCell>
                    <TableCell>{c.nome}</TableCell>
                    <TableCell>{c.empresa}</TableCell>
                    <TableCell><Badge className={ps.className}>{ps.label}</Badge></TableCell>
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

export default PaymentActivity;
