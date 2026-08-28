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
import { statusLabel, statusBadge } from "@/lib/orderStatuses";
import { formatOpcao } from "@/lib/variants";
// Uma definicao so para as tres telas do historico — ver `Pedidos.tsx`.
import { escoparPelaRls } from "./Pedidos";

const PedidoDetalhe = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role, impersonatedCustomer } = useAuth();
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
      const { data: clienteData, error: clienteErr } = await clienteQuery;
      if (clienteErr) {
        console.error(clienteErr);
        toast.error("Could not load your account. Please try again.");
        navigate("/portal/pedidos");
        return;
      }
      setCliente(clienteData);

      // Quem pode LER este pedido e a RLS que decide. `Sub-customer reads parent
      // history` e `Parent reads sub-customer orders` ja entregam o pedido do pai
      // e o do funcionario; comparar `p.cliente_id` com a MINHA ficha derrubava
      // exatamente esses dois casos, e ainda se desligava sozinha quando
      // `clienteData` vinha nulo (`clienteData &&` na guarda antiga).
      const { data: p, error: pedidoErr } = await supabase.from("pedidos").select("*").eq("id", id).maybeSingle();
      // Falha de rede virava "Order not found" — dizia que o pedido nao existe
      // sem saber disso.
      if (pedidoErr) {
        console.error(pedidoErr);
        toast.error("Could not load the order. Please try again.");
        navigate("/portal/pedidos");
        return;
      }
      // FORA da conta de cliente comum a comparacao continua sendo a unica cerca:
      // staff (admin/manager/warehouse) le TODOS os pedidos, e `/portal/pedidos/:id`
      // nao exige papel nenhum em App.tsx. Falha fechado — papel desconhecido, ou
      // ficha do cliente ausente, dao `""`, que nao casa com nenhum `cliente_id`.
      const donoEsperado = impersonatedCustomer?.id ?? clienteData?.id ?? "";
      if (!p || (!escoparPelaRls(role, impersonatedCustomer?.id) && p.cliente_id !== donoEsperado)) {
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
  }, [id, user, role, impersonatedCustomer]);

  const handleAddToOrder = async (item: any) => {
    // Mesma regra do re-order da lista: a variante vem de `pedido_itens.variante_id`.
    // Sem ela, repetir a linha mandava o produto-pai (tamanho/cor errados).
    const [{ data: prod }, { data: v }] = await Promise.all([
      supabase.from("produtos")
        .select("id, preco, estoque_total, estoque_reservado, quantidade_minima, unidade_venda, imagem_url")
        .eq("id", item.produto_id).maybeSingle(),
      item.variante_id
        ? supabase.from("produto_variantes")
            .select("id, codigo, quantidade, imagem_url, valores_opcao, ativo")
            .eq("id", item.variante_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    if (!prod) { toast.error("Product not available"); return; }
    if (item.variante_id && (!v || v.ativo === false)) {
      toast.error("That option is no longer available.");
      return;
    }
    // Pedido IMPORTADO do B2BWave nao guarda `variante_id`. Se o produto tem
    // variante hoje, repetir a linha "sem variante" manda o produto-pai, com o
    // preco do pai. Este e o caminho mais natural para repetir um pedido
    // importado — e era o unico sem a guarda. 1 produto por clique, entao uma
    // consulta simples resolve.
    if (!item.variante_id) {
      const { data: temVar, error: varErr } = await supabase
        .from("produto_variantes").select("id")
        .eq("produto_id", item.produto_id).eq("ativo", true).limit(1);
      // Falha NAO pode virar "nao tem variante": seria o pedido errado.
      if (varErr) { console.error(varErr); toast.error("Could not check product options. Please try again."); return; }
      if ((temVar ?? []).length > 0) {
        toast.error("This product now has options — please pick one on the product page.");
        return;
      }
    }
    const dispProduto = (prod.estoque_total ?? 0) - (prod.estoque_reservado ?? 0);
    const disponivel = v ? Math.min(dispProduto, v.quantidade ?? 0) : dispProduto;
    addItem({
      produto_id: item.produto_id,
      variante_id: item.variante_id ?? null,
      variante_label: v ? formatOpcao(v.valores_opcao) || v.codigo : null,
      nome: item.nome_produto,
      sku: v?.codigo || item.sku || "",
      preco: prod.preco ?? item.preco_unitario,
      quantidade: Math.min(item.quantidade, Math.max(disponivel, 1)),
      unidade_venda: prod.unidade_venda ?? "UN",
      quantidade_minima: prod.quantidade_minima ?? 1,
      estoque_disponivel: disponivel,   // estoque REAL (antes era Math.max(...,99) -> oversell)
      imagem_url: v?.imagem_url || prod.imagem_url || null,
    });
    toast.success(`${item.nome_produto} added to cart`);
  };

  const handleExport = () => {
    if (!pedido) return;
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Order", "SKU", "Product", "Quantity", "Unit Price", "Subtotal"],
      ...itens.map((it) => [
        pedido.numero, it.sku, it.nome_produto, it.quantidade,
        Number(it.preco_unitario).toFixed(2), Number(it.subtotal).toFixed(2),
      ]),
      [], ["", "", "", "", "Total", Number(pedido.total ?? 0).toFixed(2)],
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `order-${pedido.numero}.csv`;
    a.click();
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

  // O bloco de endereco caia para o cadastro de QUEM ESTA OLHANDO quando o
  // pedido nao trazia `endereco_entrega_id` (pedido importado do B2BWave, por
  // exemplo). Enquanto esta tela so abria o pedido do proprio cliente isso era um
  // palpite plausivel. Agora que o pai abre o pedido do funcionario — e o
  // sub-usuario com `can_view_full_history` abre o do pai — o mesmo palpite
  // carimbaria o endereco, o telefone e o e-mail do LEITOR no pedido do outro.
  // Fora do pedido proprio, so o que veio do pedido.
  const perfil = cliente && pedido.cliente_id === cliente.id ? cliente : null;

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
        <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
          <Download className="h-4 w-4" /> EXPORT
        </Button>
      </div>

      <div className="space-y-6">
        {/* Address section */}
        <div className="bg-card rounded-lg border p-5">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Address" value={endereco?.logradouro ?? perfil?.endereco} />
            <Field label="City" value={endereco?.cidade ?? perfil?.cidade} />
            <Field label="Phone" value={perfil?.telefone} />
            <Field label="Address 2" value={endereco?.complemento} />
            <Field label="Email" value={perfil?.email} />
            <Field label="Last Update" value={fmtDate(pedido.updated_at ?? pedido.created_at)} />
            <Field label="Postal Code" value={endereco?.cep ?? perfil?.cep} />
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
              <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${statusBadge(pedido.status)}`}>
                {statusLabel(pedido.status).toUpperCase()}
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
