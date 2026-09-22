import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Package, UserPlus, Pencil, RefreshCw } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { FancyButton } from "@/components/ui/fancy-button";
import { canonicalStatus, statusLabel as orderStatusLabel } from "@/lib/orderStatuses";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  periodoAtual, periodoAnterior, periodoUsavel, limitesDoPeriodo, resumoVendas, variacao,
  topProdutos, topClientes, estoqueCritico,
} from "@/lib/dashboardMetrics";

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

const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REFRESH_MS = 60_000;
const ESPERA_DIGITACAO_MS = 400;

type DadosPainel = {
  atual: ReturnType<typeof resumoVendas>;
  varReceita: number | null;
  varPedidos: number | null;
  produtos: ReturnType<typeof topProdutos>;
  clientes: { cliente_id: string; receita: number; pedidos: number; nome: string }[];
  estoque: ReturnType<typeof estoqueCritico>;
  pendentes: number;
};

/**
 * Painel ao vivo — SO admin (`role === "admin"`, nao `hasPermission`).
 *
 * Aqui estao receita total, ranking de clientes e ticket medio: numero de dono,
 * nao de operacao. `hasPermission("orders")` libera o manager para TRABALHAR os
 * pedidos, e liberar isso junto entregaria o faturamento da empresa de brinde.
 * `Clientes.tsx` usa o mesmo criterio para o "View as".
 *
 * As contas moram em `@/lib/dashboardMetrics` (testadas sem banco); o que esta
 * aqui e leitura, refresh e desenho.
 */
const PainelAoVivo = () => {
  const [{ from, to }, setPeriodo] = useState(periodoAtual);
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  // GUARDA DE VOO: o refresh e de 60s, mas uma leitura lenta (ou a aba voltando
  // do background com varios ticks acumulados) empilharia requisicoes que
  // terminam fora de ordem — a tela passaria a mostrar o resultado da leitura
  // ANTIGA por cima da nova. `useRef` e nao `useState` porque o valor precisa
  // valer no mesmo tick, sem esperar re-render.
  const emVoo = useRef(false);
  // GERACAO: a guarda de voo sozinha DESCARTAVA a troca de periodo — o usuario
  // mudava From/To durante uma leitura lenta e o painel mostrava os numeros do
  // periodo ANTIGO sob as datas novas, com "Last updated" de agora, ate o tick
  // seguinte (60s). Agora toda chamada entra; quem chega atrasado (geracao
  // diferente da atual) nao escreve nada na tela.
  const geracao = useRef(0);
  // Periodo ESCOLHIDO a mao: enquanto for automatico, o painel rola sozinho para
  // incluir o dia de hoje (aba aberta atravessando a meia-noite parava de contar
  // o dia novo e continuava carimbando "Last updated").
  const periodoManual = useRef(false);
  const primeiraCarga = useRef(true);

  const carregar = useCallback(async () => {
    // A GERACAO SOBE ANTES DA GUARDA: com o periodo invalidado no meio de uma
    // leitura, a leitura em voo continuava sendo "a vigente" e escrevia os
    // numeros do periodo ANTIGO sob as datas NOVAS, carimbando hora nova.
    const minha = ++geracao.current;
    const atualizada = () => minha === geracao.current;
    if (!periodoUsavel(from, to)) {
      emVoo.current = false;
      setCarregando(false);
      return;
    }
    emVoo.current = true;
    try {
      const { ini, fim } = limitesDoPeriodo(from, to);
      const ant = periodoAnterior(from, to);
      const iniAnterior = ant.from ? limitesDoPeriodo(ant.from, ant.to).ini : ini;

      const [pedidos, itens, produtos, pendentes] = await Promise.all([
        // UMA leitura cobrindo periodo anterior + atual, dividida em memoria
        // pelo MESMO corte que o servidor usou. Duas leituras separadas custam
        // o dobro de round-trips e podem discordar na fronteira.
        fetchAllRows<any>((f, t) => supabase.from("pedidos")
          .select("id,total,status,cliente_id,created_at")
          .gte("created_at", iniAnterior).lte("created_at", fim)
          .order("id", { ascending: true }).range(f, t)),
        // Filtrado NO SERVIDOR pelo pedido (`!inner` + filtro no embed):
        // `pedido_itens` e a maior tabela do sistema e ler inteira para somar um
        // mes seria varrer anos de historico a cada 60 segundos.
        fetchAllRows<any>((f, t) => supabase.from("pedido_itens")
          .select("id,produto_id,nome_produto,quantidade,subtotal,pedidos!inner(created_at,status)")
          .gte("pedidos.created_at", ini).lte("pedidos.created_at", fim)
          .order("id", { ascending: true }).range(f, t)),
        fetchAllRows<any>((f, t) => supabase.from("produtos")
          .select("id,ativo,rastrear_estoque,quantidade_minima,estoque_total,estoque_reservado")
          .eq("ativo", true).eq("rastrear_estoque", true)
          .order("id", { ascending: true }).range(f, t)),
        supabase.from("clientes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
      ]);
      if (pendentes.error) throw pendentes.error;

      const corte = Date.parse(ini);
      const doPeriodo = pedidos.filter((p) => Date.parse(p.created_at) >= corte);
      const doAnterior = pedidos.filter((p) => Date.parse(p.created_at) < corte);
      const atual = resumoVendas(doPeriodo);
      const anterior = resumoVendas(doAnterior);

      const ranking = topClientes(doPeriodo, 10);
      // <= 10 ids, entao um `.in()` basta.
      // ponytail: um bloco so; se o top virar 200 clientes, fatiar em 100.
      let nomes: Record<string, string> = {};
      if (ranking.length > 0) {
        const { data, error } = await supabase.from("clientes").select("id,nome,empresa").in("id", ranking.map((c) => c.cliente_id));
        if (error) throw error;
        nomes = Object.fromEntries((data ?? []).map((c: any) => [c.id, c.empresa || c.nome || "—"]));
      }

      if (!atualizada()) return;
      setDados({
        atual,
        varReceita: variacao(atual.receita, anterior.receita),
        varPedidos: variacao(atual.pedidos, anterior.pedidos),
        produtos: topProdutos(itens, 10),
        clientes: ranking.map((c) => ({ ...c, nome: nomes[c.cliente_id] ?? "—" })),
        estoque: estoqueCritico(produtos),
        pendentes: pendentes.count ?? 0,
      });
      setErro(false);
      setAtualizadoEm(new Date());
    } catch (e) {
      // NAO limpa `dados`: uma falha de rede no refresh de 60s nao pode apagar
      // numeros bons da tela e escrever zero no lugar. E uma LINHA de erro, nao
      // um toast — senao um backend fora do ar vira 60 toasts por hora.
      console.error(e);
      if (atualizada()) setErro(true);
    } finally {
      // Só a leitura vigente libera a guarda e tira o "loading": uma resposta
      // atrasada nao pode dizer que a leitura nova terminou.
      if (atualizada()) {
        emVoo.current = false;
        setCarregando(false);
      }
    }
  }, [from, to]);

  useEffect(() => {
    setCarregando(true);
    // ESPERA antes de ler: digitar o ano num `input type="date"` emite uma data
    // completa POR TECLA ("0009-09-22", "0092-09-22"...). Sem isso cada tecla
    // abria uma leva de leituras — e as intermediarias, com ano absurdo, varrem
    // `pedido_itens` inteira. `fetchAllRows` nao tem abort, entao a unica defesa
    // e nao disparar. A primeira carga nao espera.
    const espera = primeiraCarga.current ? 0 : ESPERA_DIGITACAO_MS;
    primeiraCarga.current = false;
    const atraso = setTimeout(carregar, espera);
    const id = setInterval(() => {
      // Aba escondida nao le: navegador em background nao mostra nada e a
      // leitura paga banda e quota do mesmo jeito.
      if (emVoo.current || document.visibilityState !== "visible") return;
      if (!periodoManual.current) {
        const hoje = periodoAtual();
        // Virou o dia: reaponta o periodo (o proprio efeito recarrega).
        if (hoje.from !== from || hoje.to !== to) { setPeriodo(hoje); return; }
      }
      carregar();
    }, REFRESH_MS);
    return () => { clearTimeout(atraso); clearInterval(id); };
  }, [carregar, from, to]);

  const pct = (v: number | null) =>
    v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const corPct = (v: number | null) =>
    v === null ? "text-muted-foreground" : v >= 0 ? "text-emerald-500" : "text-red-500";
  const linkPedidos = `/admin/orders?from=${from}&to=${to}`;

  return (
    <section className="mb-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">▸</span>
          <h3 className="text-sm font-semibold">Live panel</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            From
            <input type="date" value={from} max={to}
              onChange={(e) => { periodoManual.current = true; setPeriodo((p) => ({ ...p, from: e.target.value })); }}
              className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <input type="date" value={to} min={from}
              onChange={(e) => { periodoManual.current = true; setPeriodo((p) => ({ ...p, to: e.target.value })); }}
              className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
          </label>
          <span className="text-xs text-muted-foreground">
            {atualizadoEm ? `Last updated ${atualizadoEm.toLocaleTimeString("en-US", { hour12: false })}` : "Loading…"}
          </span>
          {/* O botao respeita a guarda de voo: clicar 5x numa rede lenta nao pode
              abrir 5 levas. Trocar o periodo, sim, sempre recarrega (`carregar`). */}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={carregando} onClick={() => { if (!emVoo.current) carregar(); }}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {erro && (
        <p className="text-xs text-red-500">
          Could not refresh{dados ? " — showing the last loaded numbers." : "."}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            <Link to={linkPedidos} className="text-xs text-muted-foreground hover:underline">Revenue in period</Link>
            <p className="text-2xl font-semibold text-primary">{dados ? fmt(dados.atual.receita) : carregando ? "…" : "—"}</p>
            <p className="text-xs">
              <span className={corPct(dados?.varReceita ?? null)}>{dados ? pct(dados.varReceita) : "—"}</span>
              <span className="text-muted-foreground"> vs previous period</span>
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            {/* O link abre a lista pelo MESMO periodo, mas a lista mostra todos os
                status (ela filtra por UM status, nao por "exceto cancelado"), entao
                pode ter mais linhas que este numero. O rotulo diz isso. */}
            <Link to={linkPedidos} className="text-xs text-muted-foreground hover:underline">Orders in period</Link>
            <p className="text-2xl font-semibold text-primary">{dados ? dados.atual.pedidos : carregando ? "…" : "—"}</p>
            <p className="text-xs">
              <span className={corPct(dados?.varPedidos ?? null)}>{dados ? pct(dados.varPedidos) : "—"}</span>
              <span className="text-muted-foreground"> vs previous period</span>
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            <p className="text-xs text-muted-foreground">Average ticket</p>
            <p className="text-2xl font-semibold text-primary">{dados ? fmt(dados.atual.ticketMedio) : carregando ? "…" : "—"}</p>
            <p className="text-xs text-muted-foreground">Gross, cancelled orders excluded (the orders list also shows cancelled ones)</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            <Link to="/admin/products" className="text-xs text-muted-foreground hover:underline">Below minimum stock</Link>
            <p className="text-2xl font-semibold text-primary">{dados ? dados.estoque.abaixoDoMinimo : carregando ? "…" : "—"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            <Link to="/admin/products" className="text-xs text-muted-foreground hover:underline">Negative pre-order</Link>
            <p className="text-2xl font-semibold text-primary">{dados ? dados.estoque.preVendaNegativa : carregando ? "…" : "—"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardContent className="space-y-1 pt-4">
            <Link to="/admin/customers?status=pendente" className="text-xs text-muted-foreground hover:underline">Pending registrations</Link>
            <p className="text-2xl font-semibold text-primary">{dados ? dados.pendentes : carregando ? "…" : "—"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="overflow-x-auto bg-card/80 backdrop-blur-sm">
          <CardContent className="pt-4">
            <h4 className="mb-2 text-xs font-semibold">Top 10 products</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!dados?.produtos.length ? (
                  <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    {carregando ? "Loading…" : erro && !dados ? "Could not load." : "No sales in this period"}
                  </TableCell></TableRow>
                ) : dados.produtos.map((p) => (
                  <TableRow key={p.produto_id || p.nome}>
                    <TableCell className="text-sm">{p.nome}</TableCell>
                    <TableCell className="text-right text-sm">{p.quantidade}</TableCell>
                    <TableCell className="text-right text-sm text-primary">{fmt(p.receita)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="overflow-x-auto bg-card/80 backdrop-blur-sm">
          <CardContent className="pt-4">
            <h4 className="mb-2 text-xs font-semibold">Top 10 customers</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!dados?.clientes.length ? (
                  <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    {carregando ? "Loading…" : erro && !dados ? "Could not load." : "No sales in this period"}
                  </TableCell></TableRow>
                ) : dados.clientes.map((c) => (
                  <TableRow key={c.cliente_id}>
                    <TableCell className="text-sm">
                      <Link to="/admin/customers" className="text-primary hover:underline">{c.nome}</Link>
                    </TableCell>
                    <TableCell className="text-right text-sm">{c.pedidos}</TableCell>
                    <TableCell className="text-right text-sm text-primary">{fmt(c.receita)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

const AdminDashboard = () => {
  const { role } = useAuth();
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
      {role === "admin" && <PainelAoVivo />}

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
