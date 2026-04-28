import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, Save, Printer, FileText, Search, X as XIcon } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const statusOptions = [
  { value: "recebido",     label: "Submitted" },
  { value: "processando",  label: "Processing" },
  { value: "em_separacao", label: "Picking / Packing" },
  { value: "enviado",      label: "Shipped" },
  { value: "concluido",    label: "Complete" },
  { value: "cancelado",    label: "Cancelled" },
];

const OrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [cliente, setCliente] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);

  const [form, setForm] = useState({
    status: "",
    po_number: "",
    delivery_date: "",
    delivery_mode: "",
    tracking_number: "",
    admin_notes: "",
    observacoes: "",
    shipping_option_id: "",
    payment_option_id: "",
    shipping_costs: "",
    is_paid: false,
  });
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<any[]>([]);

  const isNew = id === "new";

  useEffect(() => {
    if (!id) return;
    loadOrder();
    loadOptions();
  }, [id]);

  const loadOptions = async () => {
    const [{ data: ship }, { data: pay }, { data: tabelas }, { data: taxG }] = await Promise.all([
      supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem"),
      supabase.from("payment_options").select("*").eq("ativo", true).order("ordem"),
      supabase.from("tabelas_preco").select("*").eq("ativo", true),
      supabase.from("tax_customer_groups").select("*"),
    ]);
    setShippingOptions(ship ?? []);
    setPaymentOptions(pay ?? []);
    setTabelasPreco(tabelas ?? []);
    setTaxGroups(taxG ?? []);
  };

  const loadOrder = async () => {
    if (isNew) { setLoading(false); return; }

    let { data } = await supabase.from("pedidos").select("*, clientes(*, representantes(*))").eq("id", id!).maybeSingle();
    if (!data) {
      const { data: byNumero } = await supabase.from("pedidos").select("*, clientes(*, representantes(*))").eq("numero", parseInt(id!)).maybeSingle();
      data = byNumero;
    }
    if (!data) { setLoading(false); return; }

    setOrder(data);
    setCliente(data.clientes);
    setRep(data.clientes?.representantes);
    setForm({
      status: data.status || "recebido",
      po_number: data.po_number || "",
      delivery_date: data.delivery_date ? data.delivery_date.split("T")[0] : "",
      delivery_mode: data.delivery_mode || "",
      tracking_number: data.tracking_number || "",
      admin_notes: data.admin_notes || "",
      observacoes: data.observacoes || "",
      shipping_option_id: data.shipping_option_id || "",
      payment_option_id: data.payment_option_id || "",
      shipping_costs: data.shipping_costs ? String(data.shipping_costs) : "",
      is_paid: data.is_paid ?? false,
    });

    const { data: orderItems } = await supabase.from("pedido_itens").select("*").eq("pedido_id", data.id).order("created_at");
    setItems(orderItems ?? []);
    setLoading(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    setForm(f => ({ ...f, status: newStatus }));
    if (!order) return;
    await supabase.from("pedidos").update({ status: newStatus as any }).eq("id", order.id);
    setOrder({ ...order, status: newStatus });
    toast.success("Status updated");
    log("updated", "order", order.id, `Order #${order.numero || order.id}`, { status: newStatus });
    // Fire-and-forget email to customer on status change
    if (cliente?.email) {
      supabase.functions.invoke("send-email", {
        body: { type: "order_status_change", order: { ...order, status: newStatus }, customer: cliente, newStatus },
      }).catch(() => {});
    }
  };

  const handleSave = async () => {
    if (!order) return;
    setSaving(true);
    const update: any = {
      po_number: form.po_number || null,
      delivery_date: form.delivery_date || null,
      delivery_mode: form.delivery_mode || null,
      tracking_number: form.tracking_number || null,
      admin_notes: form.admin_notes || null,
      observacoes: form.observacoes || null,
      shipping_option_id: form.shipping_option_id && form.shipping_option_id !== '__none__' ? form.shipping_option_id : null,
      payment_option_id: form.payment_option_id && form.payment_option_id !== '__none__' ? form.payment_option_id : null,
      shipping_costs: form.shipping_costs ? parseFloat(form.shipping_costs) : null,
      is_paid: form.is_paid,
    };
    const { error } = await supabase.from("pedidos").update(update).eq("id", order.id);
    setSaving(false);
    if (error) { toast.error("Error saving"); return; }
    toast.success("Order saved");
    log("updated", "order", order.id, `Order #${order.numero || order.id}`);
    setOrder({ ...order, ...update });
  };

  const searchProducts = async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) { setProducts([]); return; }
    const { data } = await supabase
      .from("produtos")
      .select("id, nome, sku, preco, estoque_total, estoque_reservado, imagem_url")
      .or(`nome.ilike.%${q}%,sku.ilike.%${q}%`)
      .eq("ativo", true)
      .limit(20);
    setProducts(data ?? []);
  };

  const handleAddProduct = async (product: any) => {
    if (!order) return;
    const qty = 1;
    const { error } = await supabase.from("pedido_itens").insert({
      pedido_id: order.id,
      produto_id: product.id,
      nome_produto: product.nome,
      sku: product.sku,
      preco_unitario: product.preco,
      quantidade: qty,
      subtotal: product.preco * qty,
    });
    if (error) { toast.error("Error adding product"); return; }
    // Update order subtotal
    const newSubtotal = items.reduce((s, i) => s + i.subtotal, 0) + product.preco * qty;
    await supabase.from("pedidos").update({ subtotal: newSubtotal, total: newSubtotal }).eq("id", order.id);
    setAddProductOpen(false);
    setProductSearch("");
    setProducts([]);
    toast.success(`${product.nome} added`);
    loadOrder();
  };

  const handleDeleteItem = async (itemId: string, itemSubtotal: number) => {
    if (!order || !confirm("Remove this item?")) return;
    await supabase.from("pedido_itens").delete().eq("id", itemId);
    const newSubtotal = Math.max(0, (order.subtotal ?? 0) - itemSubtotal);
    await supabase.from("pedidos").update({ subtotal: newSubtotal, total: newSubtotal }).eq("id", order.id);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setOrder({ ...order, subtotal: newSubtotal, total: newSubtotal });
    toast.success("Item removed");
  };

  const handleDeleteOrder = async () => {
    if (!order) return;
    if (!confirm("Are you sure you want to delete this order? This cannot be undone.")) return;
    await supabase.from("pedido_itens").delete().eq("pedido_id", order.id);
    await supabase.from("pedidos").delete().eq("id", order.id);
    toast.success("Order deleted");
    log("deleted", "order", order.id, `Order #${order.numero || order.id}`);
    navigate("/admin/orders");
  };

  const handleGeneratePdf = async () => {
    if (!order) return;
    try {
      const { data, error } = await supabase.functions.invoke("generate-pdf", { body: { pedido_id: order.id } });
      if (error) throw error;
      const win = window.open("", "_blank");
      if (win) { win.document.write(data.html); win.document.close(); setTimeout(() => win.print(), 500); }
    } catch (err: any) {
      toast.error("Error generating PDF: " + (err.message ?? ""));
    }
  };

  const fmt = (v: number) => `$ ${Number(v).toFixed(2)}`;
  const totalQty = items.reduce((s, i) => s + i.quantidade, 0);
  const fmtDateTime = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) + " " +
      dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const getPaymentName = (id: string | null) => {
    if (!id) return "";
    const found = paymentOptions.find(p => p.id === id);
    return found ? found.nome : "";
  };

  const getShippingName = (id: string | null) => {
    if (!id) return "";
    const found = shippingOptions.find(s => s.id === id);
    return found ? found.nome : "";
  };

  const getPriceListName = () => {
    if (!cliente?.tabela_preco_id) return "";
    const found = tabelasPreco.find(t => t.id === cliente.tabela_preco_id);
    return found ? found.nome : "";
  };

  const getTaxGroupName = () => {
    if (!cliente?.tax_customer_group_id) return "";
    const found = taxGroups.find(t => t.id === cliente.tax_customer_group_id);
    return found ? found.nome : "No Sales Tax";
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  if (!order && !isNew) {
    return (
      <AdminLayout>
        <div className="py-20 text-center">
          <h2 className="text-xl font-semibold">Order not found</h2>
          <Button variant="link" onClick={() => navigate("/admin/orders")}>Back to Orders</Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          Order #{order?.numero} – {order ? new Date(order.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : ""}{" "}
          {cliente && (
            <span className="text-muted-foreground font-normal">{cliente.empresa || cliente.nome}</span>
          )}
        </h2>
      </div>

      {/* CUSTOMER SECTION */}
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm text-primary">Customer</h3>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Company name</td>
                <td className="px-4 py-2">
                  {cliente ? (
                    <Link to={`/admin/customers/${cliente.id}`} className="text-primary hover:underline">
                      {cliente.empresa || cliente.nome}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Company activities</td>
                <td className="px-4 py-2">{cliente?.activity || ""}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20">
                  Address
                  <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 text-primary" onClick={() => cliente && navigate(`/admin/customers/${cliente.id}`)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </td>
                <td className="px-4 py-2">{cliente?.endereco || ""}</td>
                <td className="px-4 py-2 font-semibold bg-muted/20">City</td>
                <td className="px-4 py-2">{cliente?.cidade || ""}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 bg-muted/20" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2 font-semibold bg-muted/20">Country</td>
                <td className="px-4 py-2">{cliente?.pais || "United States"}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 bg-muted/20" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2 font-semibold bg-muted/20">State</td>
                <td className="px-4 py-2">{cliente?.estado || ""}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 bg-muted/20" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2 font-semibold bg-muted/20">Postal code</td>
                <td className="px-4 py-2">{cliente?.cep || ""}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20">E-mail</td>
                <td className="px-4 py-2">{cliente?.email || ""}</td>
                <td className="px-4 py-2 font-semibold bg-muted/20">Phone</td>
                <td className="px-4 py-2">{cliente?.telefone || ""}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20">Sales Tax</td>
                <td className="px-4 py-2">{getTaxGroupName() || "No Sales Tax"}</td>
                <td className="px-4 py-2 font-semibold bg-muted/20">Price List</td>
                <td className="px-4 py-2">{getPriceListName() || "Retail"}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-semibold bg-muted/20">Company number</td>
                <td className="px-4 py-2">{cliente?.company_number || ""}</td>
                <td className="px-4 py-2 bg-muted/20" />
                <td className="px-4 py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* CUSTOMER NOTES SECTION */}
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm text-primary">Customer notes</h3>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Customer Name</td>
                <td className="px-4 py-2">{cliente?.empresa || cliente?.nome || ""}</td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-border">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border">
                  <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Comments</td>
                  <td className="px-4 py-2">
                    <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="h-8" />
                  </td>
                  <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Purchase order</td>
                  <td className="px-4 py-2">
                    <Input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} className="h-8" />
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <td className="px-4 py-2 font-semibold bg-muted/20">Delivery date</td>
                  <td className="px-4 py-2" colSpan={3}>
                    <Input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className="h-8 w-48" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="border-t border-border">
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Payment option</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <Select value={form.payment_option_id || "__none__"} onValueChange={v => setForm(f => ({ ...f, payment_option_id: v }))}>
                        <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {paymentOptions.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <Checkbox
                          checked={form.is_paid}
                          onCheckedChange={(v) => setForm(f => ({ ...f, is_paid: !!v }))}
                        /> Is paid?
                      </label>
                    </div>
                  </td>
                  <td className="px-4 py-2 font-semibold bg-muted/20 w-32">Submitted</td>
                  <td className="px-4 py-2 text-xs">
                    {order ? fmtDateTime(order.created_at) : ""}
                  </td>
                  <td className="px-4 py-2 font-semibold bg-muted/20 w-32">Last Update</td>
                  <td className="px-4 py-2 text-xs">
                    {order ? fmtDateTime(order.updated_at) : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* SALES REP DETAILS */}
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm text-primary">Sales Rep Details</h3>
        </div>
        <div className="px-5 py-3 text-sm">
          {rep ? `${rep.nome} ${rep.comissao_percentual}%` : "No sales rep assigned"}
        </div>
      </Card>

      {/* ORDER SECTION */}
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Order</h3>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20 w-40">Delivery date</td>
                <td className="px-4 py-2">
                  <Input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className="h-8 w-48" />
                </td>
                <td className="px-4 py-2 font-semibold bg-muted/20 w-48">Comments for customer</td>
                <td className="px-4 py-2">
                  <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="h-8" />
                </td>
                <td className="px-4 py-2 font-semibold bg-muted/20 w-32">Shipping costs</td>
                <td className="px-4 py-2">
                  <Input value={form.shipping_costs} onChange={e => setForm(f => ({ ...f, shipping_costs: e.target.value }))} className="h-8 w-24" placeholder="0.0" />
                </td>
                <td className="px-4 py-2 font-semibold bg-muted/20 w-32">Order status</td>
                <td className="px-4 py-2">
                  <Select value={form.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button className="text-xs text-primary hover:underline mt-1 block">show history</button>
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-4 py-2 font-semibold bg-muted/20">Shipping option</td>
                <td className="px-4 py-2">
                  <Select value={form.shipping_option_id || "__none__"} onValueChange={v => setForm(f => ({ ...f, shipping_option_id: v }))}>
                    <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {shippingOptions.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-2 font-semibold bg-muted/20">Tracking #</td>
                <td className="px-4 py-2" colSpan={5}>
                  <Input value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))} className="h-8 w-56" />
                </td>
              </tr>
            </tbody>
          </table>

          {/* Admin notes */}
          <div className="border-t border-border p-4">
            <Label className="text-sm font-semibold text-primary">Admin notes</Label>
            <Textarea value={form.admin_notes} onChange={e => setForm(f => ({ ...f, admin_notes: e.target.value }))} placeholder="Not shown to the customer" rows={3} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1 italic">Not shown to the customer</p>
          </div>
        </div>
      </Card>

      {/* Products */}
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">Products</h3>
          <Button variant="default" size="sm" className="gap-1" onClick={() => setAddProductOpen(true)}>
            <Plus className="h-4 w-4" /> Add product to order
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16" />
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-center">Quantity</TableHead>
              <TableHead className="text-center">Backorder</TableHead>
              <TableHead className="text-center">Quantity shipped</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="h-10 w-10 rounded bg-muted" />
                </TableCell>
                <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                <TableCell className="font-medium text-primary">{item.nome_produto}</TableCell>
                <TableCell className="text-right">{fmt(item.preco_unitario)}</TableCell>
                <TableCell className="text-center">{item.quantidade}</TableCell>
                <TableCell className="text-center">—</TableCell>
                <TableCell className="text-center">—</TableCell>
                <TableCell>{statusOptions.find((s) => s.value === order?.status)?.label ?? order?.status ?? "—"}</TableCell>
                <TableCell>—</TableCell>
                <TableCell className="text-right font-medium">{fmt(item.subtotal)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDeleteItem(item.id, item.subtotal)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">No items</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Totals */}
        <div className="border-t border-border px-5 py-4">
          <div className="flex justify-center text-sm text-muted-foreground mb-4">
            Total Quantity: {totalQty}
          </div>
          <div className="flex flex-col items-end gap-1 text-sm">
            <div className="grid grid-cols-[200px_100px] gap-2">
              <span className="text-right font-semibold">Total:</span>
              <span className="text-right">{order ? fmt(order.subtotal) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2">
              <span className="text-right text-primary cursor-pointer hover:underline">Discount: Add discount</span>
              <span className="text-right" />
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2 border-t pt-2 mt-1">
              <span className="text-right font-semibold">Total after discount:</span>
              <span className="text-right">{order ? fmt(order.subtotal) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2">
              <span className="text-right font-semibold">Sales Tax:</span>
              <span className="text-right">$ 0.00</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2 border-t pt-2 mt-1">
              <span className="text-right font-bold text-base">Gross total:</span>
              <span className="text-right font-bold text-base">{order ? fmt(order.total) : "$ 0.00"}</span>
            </div>
          </div>
        </div>

        {/* Delete order */}
        <div className="border-t border-border p-5 flex items-center justify-between">
          <Button variant="destructive" size="sm" className="gap-1" onClick={handleDeleteOrder}>
            <Trash2 className="h-4 w-4" /> Delete order
          </Button>
          <Button variant="default" size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700">
            <Save className="h-4 w-4" /> Packed
          </Button>
        </div>
      </Card>

      {/* Files */}
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Files</h3>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Add file for order:</Label>
            <Input type="file" className="max-w-xs" />
          </div>
        </div>
      </Card>

      {/* Messages */}
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Messages</h3>
        </div>
        <div className="p-5">
          <Textarea placeholder="Send a message about this order" rows={4} />
          <Button variant="default" size="sm" className="mt-3 gap-1 bg-green-600 hover:bg-green-700">
            <Save className="h-4 w-4" /> Send
          </Button>
        </div>
      </Card>

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-8">
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => { handleSave().then(() => navigate("/admin/orders")); }}>
            Back
          </Button>
          <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleSave()} disabled={saving}>
            Save and stay on page
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={handleGeneratePdf}>
            <Printer className="h-4 w-4" /> Invoice
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleGeneratePdf}>
            <FileText className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>
      {/* Add Product Dialog */}
      <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Product to Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name or SKU..."
                value={productSearch}
                onChange={(e) => searchProducts(e.target.value)}
              />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {products.length === 0 && productSearch.length >= 2 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No products found</p>
              )}
              {products.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/40 px-2 rounded"
                  onClick={() => handleAddProduct(p)}
                >
                  <div className="flex items-center gap-3">
                    {p.imagem_url ? (
                      <img src={p.imagem_url} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">{p.nome?.charAt(0)}</div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{p.nome}</p>
                      <p className="text-xs text-muted-foreground">{p.sku} · Stock: {(p.estoque_total ?? 0) - (p.estoque_reservado ?? 0)}</p>
                    </div>
                  </div>
                  <div className="text-sm font-bold">${Number(p.preco).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default OrderDetail;
