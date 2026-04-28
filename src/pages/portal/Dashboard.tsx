import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Package, ClipboardList, User, TrendingUp, Clock } from "lucide-react";

type RecentOrder = {
  id: string;
  numero: number;
  created_at: string;
  total: number;
  status: string;
};

const statusLabel: Record<string, string> = {
  recebido: "Submitted",
  concluido: "Complete",
  cancelado: "Cancelled",
};

const statusColor: Record<string, string> = {
  recebido: "text-amber-400",
  concluido: "text-green-400",
  cancelado: "text-destructive",
};

const PortalDashboard = () => {
  const { user, impersonatedCustomer } = useAuth();
  const [clienteNome, setClienteNome] = useState("");
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [openOrders, setOpenOrders] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;

      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id, nome, empresa").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id, nome, empresa").eq("user_id", user!.id).maybeSingle();

      const { data: cliente } = await clienteQuery;
      if (!cliente) { setLoading(false); return; }

      setClienteNome(cliente.empresa || cliente.nome || "");

      const { data: pedidos } = await supabase
        .from("pedidos")
        .select("id, numero, created_at, total, status")
        .eq("cliente_id", cliente.id)
        .order("created_at", { ascending: false });

      const all = pedidos ?? [];
      setRecentOrders(all.slice(0, 5));
      setTotalSpent(all.reduce((sum, p) => sum + (Number(p.total) || 0), 0));
      setOpenOrders(all.filter((p) => p.status === "recebido").length);
      setLoading(false);
    };
    fetch();
  }, [user, impersonatedCustomer]);

  return (
    <PortalLayout>
      {/* Welcome */}
      {clienteNome && (
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Welcome, {clienteNome}</h2>
          <p className="text-sm text-muted-foreground">Here's a summary of your account.</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spent</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalSpent.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
            <ClipboardList className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{recentOrders.length > 0 ? (recentOrders.length >= 5 ? "5+" : recentOrders.length) : 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Orders</CardTitle>
            <Clock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{openOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Account</CardTitle>
            <User className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <Link to="/portal/conta" className="text-sm text-accent hover:underline">View profile</Link>
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
                <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                  <div>
                    <span className="font-medium">Order #{order.numero}</span>
                    <span className="ml-3 text-muted-foreground text-xs">
                      {new Date(order.created_at).toLocaleDateString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-medium ${statusColor[order.status] ?? ""}`}>
                      {statusLabel[order.status] ?? order.status}
                    </span>
                    <span className="font-bold">${Number(order.total).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PortalLayout>
  );
};

export default PortalDashboard;
