import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import { toast } from "sonner";

const statusLabel: Record<string, string> = {
  recebido: "SUBMITTED", em_processamento: "PROCESSING",
  enviado: "SHIPPED", concluido: "COMPLETE", cancelado: "CANCELLED",
};

const PedidoDetalhe = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, impersonatedCustomer } = useAuth();
  const { addItem } = useCart();
  const [pedido, setPedido] = useState<any>(null);
  const [itens, setItens] = useState<any[]>([]);
  const [endereco, setEndereco] = useState<any>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [shippingOption, setShippingOption] = useState<any>(null);
  const [paymentOption, setPaymentOption] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);

      // Load cliente
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("*").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("*").eq("user_id", user!.id).maybeSingle();
      const { data: clienteData } = await clienteQuery;
      setCliente(clienteData);

      // Load order — ensure it belongs to this customer
      const { data: p } = await supabase.from("pedidos").select("*").eq("id", id).maybeSingle();
      if (!p || (clienteData && p.cliente_id !== clienteData.id)) {
        toast.error("Order not found");
        navigate("/portal/pedidos");
        return;
      }
      setPedido(p);

      // Load items, address, shipping, payment in parallel
      const [{ data: items }, { data: addr }, { data: ship }, { data: pay }] = await Promise.all([
        supabase.from("pedido_itens").select("*").eq("pedido_id", id),
        p.endereco_entrega_id
          ? supabase.from("enderecos").select("*").eq("id", p.endereco_entrega_id).maybeSingle()
          : Promise.resolve({ data: null }),
        p.shipping_option_id
          ? supabase.from("shipping_options").select("nome").eq("id", p.shipping_option_id).maybeSingle()
          : Promise.resolve({ data: null }),
        p.payment_option_id
          ? supabase.from("payment_options").select("nome").eq("id", p.payment_option_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setItens(items ?? []);
      setEndereco(addr);
      setShippingOption(ship);
      setPaymentOption(pay);
      setLoading(false);
    };
    fetch();
  }, [id, user, impersonatedCustomer]);

  const handleAddToOrder = async (item: any) => {
    const { data: prod } = await supabase.from("produtos")
      .select("id, preco, estoque_total, estoque_reservado, quantidade_minima, unidade_venda, imagem_url")
      .eq("id", item.produto_id).maybeSingle();
    if (!prod) { toast.error("Product not available"); return; }
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
    toast.success(`${item.nome_produto} added to cart`);
  };

  const Field = ({ label, value }: { label: string; value?: string | null }) => (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <Input value={value ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
    </div>
  );

  if (loading) return (
    <PortalLayout>
      <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
    </PortalLayout>
  );

  if (!pedido) return null;

  const hasTax = Number(pedido.sales_tax ?? 0) > 0;

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground border-b pb-3">
        <button onClick={() => navigate("/portal")} className="hover:text-primary">Home</button>
        <span>|</span>
        <span className="text-foreground font-medium">Order #{pedido.numero}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Order #{pedido.numero}</h2>
        <Button variant="outline" size="sm" className="gap-1">
          <Download className="h-4 w-4" /> EXPORT
        </Button>
      </div>

      <div className="space-y-6">
        {/* Address section */}
        <div className="bg-card rounded-lg border p-5">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Address" value={endereco?.logradouro ?? cliente?.endereco} />
            <Field label="City" value={endereco?.cidade ?? cliente?.cidade} />
            <Field label="Phone" value={cliente?.telefone} />
            <Field label="Address 2" value={endereco?.complemento} />
            <Field label="Email" value={cliente?.email} />
            <Field label="Last Update" value={fmtDate(pedido.updated_at ?? pedido.created_at)} />
            <Field label="Postal Code" value={endereco?.cep ?? cliente?.cep} />
            <Field label="Country" value="US" />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Sales Tax</p>
              <Input
                value={hasTax ? "Sales Tax applies" : "Tax exempt"}
                readOnly
                className="bg-muted/30 text-sm h-8"
              />
            </div>
          </div>
        </div>

        {/* Information section */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-lg font-bold mb-4">Information</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Purchase Order" value={pedido.po_number} />
            <div className="col-span-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Comments for your order</p>
              <Input value={pedido.observacoes ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
            </div>
            <div />
            <div />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${
                pedido.status === "concluido" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                pedido.status === "cancelado" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                "bg-blue-500/20 text-blue-400 border-blue-500/30"
              }`}>
                {statusLabel[pedido.status] ?? pedido.status?.toUpperCase()}
              </span>
            </div>
            <Field label="Payment Option" value={paymentOption?.nome} />
            <Field label="Shipping Option" value={shippingOption?.nome} />
            <Field label="Shipping Costs" value={`$${Number(pedido.shipping_costs ?? 0).toFixed(2)}`} />
            <Field label="Tracking Number" value={pedido.tracking_number} />
          </div>
        </div>

        {/* Customer Information section */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-lg font-bold mb-4">Customer Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Comments for your order</p>
              <Input value={pedido.observacoes ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
            </div>
            <Field label="Delivery Date" value={fmtDateShort(pedido.delivery_date ?? "")} />
          </div>
        </div>

        {/* Products table */}
        <div className="bg-card rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                <th className="px-4 py-3 w-12" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Discount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="h-10 w-10 rounded bg-muted overflow-hidden">
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                        {item.nome_produto?.charAt(0)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.sku}</td>
                  <td className="px-4 py-3 font-medium">{item.nome_produto}</td>
                  <td className="px-4 py-3">${Number(item.preco_unitario).toFixed(2)}</td>
                  <td className="px-4 py-3">{item.quantidade}</td>
                  <td className="px-4 py-3 text-muted-foreground">-</td>
                  <td className="px-4 py-3 text-right font-medium">${Number(item.subtotal).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                      onClick={() => handleAddToOrder(item)}
                    >
                      ADD TO ORDER
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals footer */}
          <div className="flex justify-end gap-8 px-6 py-4 border-t border-border bg-muted/20">
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Total</p>
              <p className="text-base font-bold">${Number(pedido.subtotal ?? 0).toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Gross Total</p>
              <p className="text-base font-bold text-primary">${Number(pedido.total ?? 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/portal/pedidos")}>← Back to Orders</Button>
        </div>
      </div>
    </PortalLayout>
  );
};

export default PedidoDetalhe;
