import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { canonicalStatus, statusLabel, statusBadge } from "@/lib/orderStatuses";
import { fetchAllRows } from "@/lib/fetchAllRows";
// Uma definicao so para as tres telas do historico. Duplicar a condicao foi o que
// deixou lista, detalhe e resumo discordando entre si. (App.tsx importa todas as
// paginas do portal estaticamente — nao ha custo de bundle em cruzar o import.)
import { escoparPelaRls } from "./Pedidos";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Package, ClipboardList, User, TrendingUp, Clock, Plus } from "lucide-react";

type RecentOrder = {
  id: string;
  numero: number;
  created_at: string;
  total: number;
  status: string;
};

const PortalDashboard = () => {
  const { user, role, impersonatedCustomer } = useAuth();
  const rlsEscopa = escoparPelaRls(role, impersonatedCustomer?.id);
  const [clienteNome, setClienteNome] = useState("");
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [openOrders, setOpenOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  // Leitura FALHOU — diferente de "nao comprou nada". Sem isso os cartoes
  // mostravam $0.00 / 0 pedidos, afirmando o que o codigo nao sabe.
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;

      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id, nome, empresa").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id, nome, empresa").eq("user_id", user!.id).maybeSingle();

      const { data: cliente, error: clienteErr } = await clienteQuery;
      if (clienteErr) { console.error(clienteErr); setErro(true); setLoading(false); return; }
      if (!cliente) { setLoading(false); return; }

      setClienteNome(cliente.empresa || cliente.nome || "");

      let all: RecentOrder[];
      try {
        // PAGINADO. Sem isso o PostgREST cortava em 1000 linhas SEM erro e o
        // "Total Spent" saia plausivel e errado. E `fetchAllRows` LANCA em erro:
        // melhor a tela dizer que nao sabe do que exibir $0.00.
        //
        // Escopo: a RLS decide (pedido proprio + do pai com
        // `can_view_full_history` + do sub-usuario para o dono da conta), igual a
        // tela de historico. Na impersonacao o filtro fica, porque staff le tudo.
        all = await fetchAllRows<RecentOrder>((from, to) => {
          let q = supabase.from("pedidos")
            .select("id, numero, created_at, total, status")
            // `order` por coluna UNICA e exigencia do paginador: OFFSET sem ordem
            // estavel repete/pula linha entre paginas.
            .order("id", { ascending: true })
            .range(from, to);
          if (!rlsEscopa) q = q.eq("cliente_id", cliente.id);
          return q;
        });
      } catch (e) {
        console.error(e);
        setErro(true);
        setLoading(false);
        return;
      }
      setErro(false);

      // A ordem que a TELA usa e por data — o `order("id")` acima serve so ao
      // paginador.
      setRecentOrders([...all].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5));
      setTotalOrders(all.length);
      // Total Spent = só do ANO corrente (pedido do dono) e SEM cancelados
      // (pedido cancelado não é dinheiro gasto).
      const thisYear = new Date().getFullYear();
      setTotalSpent(all
        .filter((p) => new Date(p.created_at).getFullYear() === thisYear
          && canonicalStatus(p.status) !== "cancelled")
        .reduce((sum, p) => sum + (Number(p.total) || 0), 0));
      setOpenOrders(all.filter((p) => { const s = canonicalStatus(p.status); return s !== "complete" && s !== "cancelled"; }).length);
      setLoading(false);
    };
    fetch();
  }, [user, impersonatedCustomer, rlsEscopa]);

  return (
    <PortalLayout>
      {/* Welcome + atalho pra iniciar um pedido (vai pro catálogo) */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {clienteNome && <h2 className="text-2xl font-bold">Welcome, {clienteNome}</h2>}
          <p className="text-sm text-muted-foreground">Here's a summary of your account.</p>
        </div>
        <Button asChild className="gap-1 shrink-0">
          <Link to="/portal/catalogo"><Plus className="h-4 w-4" /> New order</Link>
        </Button>
      </div>

      {/* Stats */}
      {erro && (
        <p className="mb-4 text-sm text-destructive">
          Could not load your account summary. Please refresh the page.
        </p>
      )}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spent ({new Date().getFullYear()})</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{erro ? "—" : `$${totalSpent.toFixed(2)}`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
            <ClipboardList className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{erro ? "—" : totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Orders</CardTitle>
            <Clock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{erro ? "—" : openOrders}</p>
          </CardContent>
        </Card>
      </div>

      {/* Navigation cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Link to="/portal/catalogo">
          <Card className="transition-all hover:shadow-md hover:border-accent/40 h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2"><Package className="h-5 w-5 text-accent" /></div>
              <CardTitle className="text-sm sm:text-base">Catalog</CardTitle>
            </CardHeader>
            <CardContent><p className="text-xs sm:text-sm text-muted-foreground">Browse available products</p></CardContent>
          </Card>
        </Link>
        <Link to="/portal/carrinho">
          <Card className="transition-all hover:shadow-md hover:border-accent/40 h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2"><ShoppingCart className="h-5 w-5 text-accent" /></div>
              <CardTitle className="text-sm sm:text-base">Cart</CardTitle>
            </CardHeader>
            <CardContent><p className="text-xs sm:text-sm text-muted-foreground">Your selected items</p></CardContent>
          </Card>
        </Link>
        <Link to="/portal/pedidos">
          <Card className="transition-all hover:shadow-md hover:border-accent/40 h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2"><ClipboardList className="h-5 w-5 text-accent" /></div>
              <CardTitle className="text-sm sm:text-base">Orders</CardTitle>
            </CardHeader>
            <CardContent><p className="text-xs sm:text-sm text-muted-foreground">Order history</p></CardContent>
          </Card>
        </Link>
        <Link to="/portal/conta">
          <Card className="transition-all hover:shadow-md hover:border-accent/40 h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2"><User className="h-5 w-5 text-accent" /></div>
              <CardTitle className="text-sm sm:text-base">My Account</CardTitle>
            </CardHeader>
            <CardContent><p className="text-xs sm:text-sm text-muted-foreground">Profile & addresses</p></CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Orders */}
      {!loading && recentOrders.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Recent Orders</CardTitle>
            <Link to="/portal/pedidos" className="text-xs text-accent hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentOrders.map((order) => (
                <Link key={order.id} to={`/portal/pedidos/${order.id}`}
                  className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0 -mx-2 px-2 rounded hover:bg-muted/50 transition-colors">
                  <div>
                    <span className="font-medium">Order #{order.numero}</span>
                    <span className="ml-3 text-muted-foreground text-xs">
                      {new Date(order.created_at).toLocaleDateString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${statusBadge(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                    <span className="font-bold">${Number(order.total).toFixed(2)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PortalLayout>
  );
};

export default PortalDashboard;
