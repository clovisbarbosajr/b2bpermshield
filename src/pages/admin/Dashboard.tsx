import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Package, UserPlus, Pencil } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { FancyButton } from "@/components/ui/fancy-button";
import { canonicalStatus, statusLabel as orderStatusLabel } from "@/lib/orderStatuses";
import { cn } from "@/lib/utils";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ymToDate = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

const formatYmShort = (ym: string) => {
  const d = ymToDate(ym);
  return `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
};

const shiftYmByMonths = (ym: string, delta: number) => {
  const d = ymToDate(ym);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const buildPeriod = (anchorYm: string) => {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    months.push(shiftYmByMonths(anchorYm, -i));
  }
  return months;
};

// `delivery_date` e timestamptz guardando uma DATA de calendario: o admin digita
// num <input type="date">, o Postgres grava meia-noite UTC, e formatar esse
// instante no fuso LOCAL a oeste de Greenwich devolve o DIA ANTERIOR — a entrega
// de 27/ago aparecia como 26/ago. O mesmo vale para o literal "YYYY-MM-DD" do
// fallback em `observacoes`, que o JS tambem parseia como meia-noite UTC. Ler em
// UTC devolve exatamente o dia que foi digitado, em qualquer fuso do navegador.
export const formatDeliveryDate = (v: string) =>
  new Date(v).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "UTC" });

// `created_at` e um INSTANTE, e aqui vale o contrario: `toISOString()` mostrava
// esse instante em UTC enquanto o grafico de vendas abaixo agrupa por mes LOCAL
// (`d.getMonth()`). Um pedido feito as 21h de 27/ago em UTC-3 saia listado como
// "2026-08-28" e contava em agosto no grafico — a mesma tela em dois fusos.
export const formatOrderDateTime = (v: string) => {
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const AdminDashboard = () => {
  const [stats, setStats] = useState({ produtos: 0, clientes: 0 });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<Record<string, number>>({});
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [anchorMonth, setAnchorMonth] = useState("");
  const [showCurrent, setShowCurrent] = useState(true);
  const [showPrevious, setShowPrevious] = useState(true);
  // Sem isto a tela afirmava o que nao sabia: leitura que falhava caia em
  // `?? []` / `?? 0` e virava "No orders yet", "No sales data yet" e "(0)".
  const [estado, setEstado] = useState<"loading" | "ok" | "erro">("loading");

  useEffect(() => {
    const fetchAll = async () => {
      const [pr, cl, orders, allOrders] = await Promise.all([
        supabase.from("produtos").select("id", { count: "exact", head: true }),
        supabase.from("clientes").select("id", { count: "exact", head: true }),
        supabase.from("pedidos").select("*, clientes(nome, empresa, email, telefone)").order("created_at", { ascending: false }).limit(5),
        // PAGINADO (fetchAllRows). O `.limit(5000)` daqui era mentira: o
        // PostgREST corta em `db-max-rows` (1000 no Supabase) SEM erro, e
        // `pedidos` tem 2784 linhas e cresce a cada pedido novo. O grafico
        // "Total per month", os botoes de mes e a comparacao com o ano anterior
        // saiam todos de um recorte de 1000 linhas — e, sem `.order()`, de um
        // recorte ARBITRARIO: a mesma tela recarregada dava outro numero, e
        // nenhum dos dois estava certo. `.order("id")` porque paginar por
        // OFFSET exige ordem estavel.
        fetchAllRows((f, t) => supabase.from("pedidos").select("id, created_at, total, subtotal, status").order("id", { ascending: true }).range(f, t)),
      ]);
      // `error` ignorado devolvia 0 produtos / 0 clientes como se fosse o numero real.
      if (pr.error) throw pr.error;
      if (cl.error) throw cl.error;
      if (orders.error) throw orders.error;

      setStats({ produtos: pr.count ?? 0, clientes: cl.count ?? 0 });

      // Fetch real item quantities for recent orders
      const recentData = orders.data ?? [];
      if (recentData.length > 0) {
        const ids = recentData.map((o: any) => o.id);
        const { data: items, error: itemsError } = await supabase
          .from("pedido_itens")
          .select("pedido_id, quantidade")
          .in("pedido_id", ids);
        if (itemsError) throw itemsError;
        const qtyMap: Record<string, number> = {};
        (items ?? []).forEach((i: any) => {
          qtyMap[i.pedido_id] = (qtyMap[i.pedido_id] ?? 0) + (i.quantidade ?? 0);
        });
        recentData.forEach((o: any) => {
          o._real_qty = qtyMap[o.id] ?? 0;
        });
      }
      setRecentOrders(recentData);

      const byMonthYear: Record<string, number> = {};
      allOrders.forEach((o: any) => {
        if (canonicalStatus(o.status) === "cancelled") return;
        const d = new Date(o.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        byMonthYear[key] = (byMonthYear[key] ?? 0) + Number(o.subtotal || o.total || 0);
      });

      const sortedMonths = Object.keys(byMonthYear).sort();
      setMonthlyTotals(byMonthYear);
      setAvailableMonths(sortedMonths);
      setAnchorMonth((prev) => prev || sortedMonths[sortedMonths.length - 1] || "");
      setEstado("ok");
    };

    // `fetchAllRows` LANCA em erro. Sem catch isso seria rejeicao nao tratada e a
    // tela ficaria em "loading" para sempre.
    fetchAll().catch((e) => {
      console.error(e);
      setEstado("erro");
      toast.error("Could not load the dashboard. Try again.");
    });
  }, []);

  const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const anchorOptions = useMemo(() => availableMonths.slice(-12).reverse(), [availableMonths]);

  const { chartData, currentPeriodLabel, previousPeriodLabel } = useMemo(() => {
    if (!anchorMonth) return { chartData: [], currentPeriodLabel: "Current", previousPeriodLabel: "Previous" };

    const period = buildPeriod(anchorMonth);
    const currentStart = period[0];
    const currentEnd = period[period.length - 1];
    const previousStart = shiftYmByMonths(currentStart, -12);
    const previousEnd = shiftYmByMonths(currentEnd, -12);

    const data = period.map((ym) => {
      const d = ymToDate(ym);
      const prevYm = `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return {
        month: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`,
        current: monthlyTotals[ym] ?? 0,
        previous: monthlyTotals[prevYm] ?? 0,
      };
    });

    return {
      chartData: data,
      currentPeriodLabel: `${formatYmShort(currentStart)} - ${formatYmShort(currentEnd)}`,
      previousPeriodLabel: `${formatYmShort(previousStart)} - ${formatYmShort(previousEnd)}`,
    };
  }, [anchorMonth, monthlyTotals]);

  const statusLabel = (s: string) => {
    const variant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      complete: "default", sent: "default", submitted: "secondary",
      cancelled: "destructive", on_hold: "outline", ready_for_pickup: "outline", partial: "outline",
    };
    return { label: orderStatusLabel(s), variant: variant[canonicalStatus(s)] ?? ("outline" as const) };
  };

  const getDeliveryDate = (o: any) => {
    if (o.delivery_date) return formatDeliveryDate(o.delivery_date);
    if (o.observacoes) {
      const match = o.observacoes.match(/Delivery:\s*(\d{4}-\d{2}-\d{2})/);
      if (match) return formatDeliveryDate(match[1]);
    }
    return "—";
  };

  const getOrderRef = (o: any) => {
    if (o.po_number) return o.po_number;
    if (!o.observacoes) return null;
    const match = o.observacoes.match(/PO:\s*([^|]+)/);
    return match ? match[1].trim() : null;
  };

  return (
    <AdminLayout>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Link to="/admin/products/new">
          <FancyButton label={estado === "ok" ? `ADD PRODUCT (${stats.produtos})` : "ADD PRODUCT"} icon={<Package className="h-4 w-4" />} />
        </Link>
        <Link to="/admin/customers/new">
          <FancyButton label={estado === "ok" ? `ADD CUSTOMER (${stats.clientes})` : "ADD CUSTOMER"} icon={<UserPlus className="h-4 w-4" />} />
        </Link>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">▸</span>
        <h3 className="text-sm font-semibold">Latest orders</h3>
      </div>
      <Card className="mb-6 overflow-x-auto bg-card/80 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">id</TableHead>
              <TableHead>Order #</TableHead>
              <TableHead>Delivery date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Total<br /><span className="text-xs text-muted-foreground">Total Quantity</span></TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentOrders.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                {estado === "erro" ? "Could not load orders." : estado === "loading" ? "Loading…" : "No orders yet"}
              </TableCell></TableRow>
            ) : recentOrders.map((o) => {
              const st = statusLabel(o.status);
              const poRef = getOrderRef(o);
              return (
                <TableRow key={o.id}>
                  <TableCell className="text-primary font-medium">{o.numero}</TableCell>
                  <TableCell>
                    <Link to={`/admin/orders/${o.id}`} className="text-primary hover:underline text-xs">
                      {formatOrderDateTime(o.created_at)}
                    </Link>
                    {poRef && <div className="text-xs text-muted-foreground">PO: {poRef}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{getDeliveryDate(o)}</TableCell>
                  <TableCell className="text-primary">{(o.clientes as any)?.empresa || (o.clientes as any)?.nome || "—"}</TableCell>
                  <TableCell className="text-primary text-xs">{(o.clientes as any)?.email || "—"}</TableCell>
                  <TableCell className="text-sm">{(o.clientes as any)?.telefone || "—"}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-primary font-medium">{fmt(Number(o.total || o.subtotal || 0))}</span>
                    <div className="text-xs text-muted-foreground">{o._real_qty || o.quantidade_total || 0}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={st.variant} className="text-xs whitespace-nowrap">{st.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link to={`/admin/orders/${o.id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-primary">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <h3 className="text-sm font-semibold mb-3">Total per month without Sales Tax</h3>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {anchorOptions.map((ym) => (
              <button
                key={ym}
                onClick={() => setAnchorMonth(ym)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
                  anchorMonth === ym
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:text-foreground"
                )}
              >
                {formatYmShort(ym)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCurrent((v) => !v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
                showCurrent
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              {currentPeriodLabel}
            </button>
            <button
              onClick={() => setShowPrevious((v) => !v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
                showPrevious
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              {previousPeriodLabel}
            </button>
          </div>

          <div className="h-72">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
                          <p className="font-semibold text-sm mb-1">{label}</p>
                          {payload.map((entry: any, i: number) => (
                            <p key={i} style={{ color: entry.stroke }} className="text-sm">
                              {entry.name} : {fmt(entry.value)}
                            </p>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {showCurrent && (
                    <Line
                      type="monotone"
                      dataKey="current"
                      name={currentPeriodLabel}
                      stroke="hsl(210, 80%, 55%)"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "hsl(210, 80%, 55%)" }}
                      activeDot={{ r: 6 }}
                      connectNulls
                    />
                  )}
                  {showPrevious && (
                    <Line
                      type="monotone"
                      dataKey="previous"
                      name={previousPeriodLabel}
                      stroke="hsl(210, 30%, 70%)"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={{ r: 3, fill: "hsl(210, 30%, 70%)" }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {estado === "erro" ? "Could not load sales data." : estado === "loading" ? "Loading…" : "No sales data yet"}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default AdminDashboard;
