import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { DollarSign, Package, ShoppingCart, TrendingUp } from "lucide-react";

const COLORS = ["hsl(28,90%,52%)", "hsl(220,65%,28%)", "hsl(152,60%,40%)", "hsl(38,92%,50%)", "hsl(210,80%,52%)"];
const fmt = (v: number) => `$ ${v.toFixed(2)}`;

const AdminRelatorios = () => {
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [itens, setItens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const [pRes, prRes, iRes] = await Promise.all([
        supabase.from("pedidos").select("*, clientes(nome, empresa)").order("created_at", { ascending: false }),
        supabase.from("produtos").select("id, nome, sku, preco, estoque_total, estoque_reservado, quantidade_minima"),
        supabase.from("pedido_itens").select("produto_id, nome_produto, quantidade, subtotal"),
      ]);
      setPedidos(pRes.data ?? []);
      setProdutos(prRes.data ?? []);
      setItens(iRes.data ?? []);
      setLoading(false);
    };
    fetch();
  }, []);

  // Sales by month
  const salesByMonth = pedidos.reduce((acc: Record<string, number>, p) => {
    if (p.status === "cancelado") return acc;
    const month = new Date(p.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short" });
    acc[month] = (acc[month] ?? 0) + Number(p.total);
    return acc;
  }, {});
  const salesData = Object.entries(salesByMonth).map(([month, total]) => ({ month, total })).slice(-12);

  // Orders by status
  const statusCounts = pedidos.reduce((acc: Record<string, number>, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  // Top products by quantity sold
  const productSales = itens.reduce((acc: Record<string, { name: string; qty: number; revenue: number }>, i) => {
    if (!acc[i.produto_id]) acc[i.produto_id] = { name: i.nome_produto, qty: 0, revenue: 0 };
    acc[i.produto_id].qty += i.quantidade;
    acc[i.produto_id].revenue += Number(i.subtotal);
    return acc;
  }, {});
  const topProducts = (Object.values(productSales) as { name: string; qty: number; revenue: number }[]).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Low stock
  const lowStock = produtos.filter((p) => (p.estoque_total - p.estoque_reservado) <= p.quantidade_minima);

  // Summary stats
  const totalRevenue = pedidos.filter((p) => p.status !== "cancelado").reduce((sum, p) => sum + Number(p.total), 0);
  const totalOrders = pedidos.filter((p) => p.status !== "cancelado").length;
  const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <h2 className="mb-6 font-display text-2xl font-semibold">Reports</h2>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(totalRevenue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{totalOrders}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Order Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(avgOrder)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Items</CardTitle>
            <Package className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent><p className="text-2xl font-bold text-destructive">{lowStock.length}</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Monthly Sales</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Bar dataKey="total" fill="hsl(28,90%,52%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Orders by Status</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                        {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader><CardTitle className="text-base">Top Products by Revenue</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Product</TableHead><TableHead className="text-center">Qty Sold</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {topProducts.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-center">{p.qty}</TableCell>
                      <TableCell className="text-right">{fmt(p.revenue)}</TableCell>
                    </TableRow>
                  ))}
                  {topProducts.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No sales data yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <CardHeader><CardTitle className="text-base">Low Stock Alert</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead className="text-center">Available</TableHead><TableHead className="text-center">Min Required</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="text-center text-destructive font-bold">{p.estoque_total - p.estoque_reservado}</TableCell>
                      <TableCell className="text-center">{p.quantidade_minima}</TableCell>
                    </TableRow>
                  ))}
                  {lowStock.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">All items are well-stocked</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default AdminRelatorios;
