import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
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
import { Pencil, Trash2, Plus, Save, Printer, FileText, Search, X as XIcon, Send } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useAuth } from "@/contexts/AuthContext";
import { categoryPath } from "@/lib/categoryTree";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getProductPrice } from "@/lib/pricing";
import { toast } from "sonner";
import { ORDER_STATUSES, statusLabel, canonicalStatus } from "@/lib/orderStatuses";

// Os 7 status do B2BWave (fonte única em lib/orderStatuses).
const statusOptions = ORDER_STATUSES;

const OrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const { role } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [cliente, setCliente] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Resend da confirmação do pedido (modal)
  const [resendOpen, setResendOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [adminEmails, setAdminEmails] = useState("");
  const [resend, setResend] = useState({ customer: false, admin: false, other: false, otherEmail: "" });
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);
  // Criação de pedido pelo admin (isNew): lista de clientes + cliente selecionado.
  const [allClientes, setAllClientes] = useState<any[]>([]);
  const [selectedClienteId, setSelectedClienteId] = useState("");

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
  const [categorias, setCategorias] = useState<any[]>([]);

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
    // Categorias p/ mostrar o caminho (localização › categoria) no modal de produtos.
    const { data: cats } = await supabase.from("categorias").select("id, nome, parent_id");
    setCategorias(cats ?? []);
    // Destinatários admin — mostrados no modal de Resend (igual ao B2BWave).
    const { data: cfg } = await supabase.from("configuracoes")
      .select("email_new_orders, email_contato").limit(1).maybeSingle();
    setAdminEmails(cfg?.email_new_orders || cfg?.email_contato || "");
    // Para criar pedido pelo admin precisamos da lista de clientes.
    if (isNew) {
      const { data: cls } = await supabase
        .from("clientes")
        .select("id, nome, empresa, email, telefone, tabela_preco_id")
        .order("empresa");
      setAllClientes(cls ?? []);
      // Pré-seleciona o cliente quando aberto via "Create Order" do cadastro (?customer=ID).
      const customerParam = searchParams.get("customer");
      if (customerParam && (cls ?? []).some((c) => c.id === customerParam)) {
        setSelectedClienteId(customerParam);
      }
    }
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
      status: canonicalStatus(data.status),
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
    // Sem checar o erro, um UPDATE recusado (RLS/rede) ainda mostrava "Status
    // updated" e MANDAVA o email ao cliente ("seu pedido foi enviado") com o
    // pedido parado no status antigo. Agora falha reverte a tela e não notifica.
    const { error: stErr } = await supabase.from("pedidos").update({ status: newStatus as any }).eq("id", order.id);
    if (stErr) {
      setForm(f => ({ ...f, status: order.status }));
      toast.error("Failed to update status: " + stErr.message);
      return;
    }
    setOrder({ ...order, status: newStatus });
    toast.success("Status updated");
    log("updated", "order", order.id, `Order #${order.numero || order.id}`, { status: newStatus });
    // Email do cliente (send-email, tem sessão do admin). O SMS/notify-dispatch
    // do order_status agora sai por TRIGGER no banco (trg_order_status_notify) —
    // confiável e independe do frontend. NÃO chamar notify-dispatch aqui (dup).
    if (cliente?.email) {
      supabase.functions.invoke("send-email", {
        body: { type: "order_status_change", order: { ...order, status: newStatus }, customer: cliente, newStatus },
      }).catch(() => {});
    }
  };

  // ── Resend da confirmação do pedido (cliente / admin / email avulso) ──
  const handleResend = async () => {
    if (!order) return;
    const custom = resend.otherEmail.trim();
    if (resend.other && (!custom || !custom.includes("@"))) {
      toast.error("Enter a valid email address."); return;
    }
    if (!resend.customer && !resend.admin && !resend.other) {
      toast.error("Select at least one recipient."); return;
    }
    setResending(true);
    const emailCustomer = cliente
      ? { id: cliente.id, email: cliente.email, nome: cliente.nome, empresa: (cliente as any).empresa }
      : {};
    const emailItems = items.map((i) => ({
      sku: i.sku, nome_produto: i.nome_produto, preco_unitario: i.preco_unitario,
      quantidade: i.quantidade, subtotal: i.subtotal ?? i.preco_unitario * i.quantidade,
    }));
    const calls: Promise<any>[] = [];
    // force: reenvio é ação MANUAL do admin — sai mesmo se a notificação
    // automática estiver desligada (senão o botão não funcionaria).
    if (resend.customer && cliente?.email) {
      calls.push(supabase.functions.invoke("send-email", {
        body: { type: "new_order_customer", order, customer: emailCustomer, items: emailItems, force: true },
      }));
    }
    if (resend.admin) {
      calls.push(supabase.functions.invoke("send-email", {
        body: { type: "new_order_admin", order, customer: emailCustomer, items: emailItems, force: true },
      }));
    }
    if (resend.other) {
      calls.push(supabase.functions.invoke("send-email", {
        body: { type: "new_order_customer", order, customer: emailCustomer, items: emailItems, force: true, toOverride: custom },
      }));
    }
    const results = await Promise.allSettled(calls);
    setResending(false);
    const failed = results.filter((r) => r.status === "rejected" || (r as any).value?.error || (r as any).value?.data?.error);
    if (failed.length) {
      const msg = (failed[0] as any)?.value?.data?.error || (failed[0] as any)?.value?.error?.message || "unknown error";
      toast.error(`Some emails failed: ${msg}`);
    } else {
      toast.success("Order confirmation re-sent.");
      setResendOpen(false);
    }
    log("updated", "order", order.id, `Resent order #${order.numero || order.id} confirmation`);
  };

  const handleSave = async (goBack = false) => {
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
      shipping_costs: Number.isFinite(parseFloat(form.shipping_costs)) ? parseFloat(form.shipping_costs) : null,
      is_paid: form.is_paid,
    };
    // Mudanças que INTERESSAM ao cliente/admin (tracking, envio, data de entrega)
    // precisam notificar ao SALVAR — antes só o dropdown de status notificava, e
    // adicionar rastreio e salvar não avisava ninguém.
    // Normaliza data (input = "YYYY-MM-DD"; banco pode vir "...T00:00:00") antes de
    // comparar — senão o notifiable dava true a cada Save e spamava email/SMS.
    const dOnly = (v: any) => (v ? String(v).split("T")[0] : "");
    const notifiable =
      (update.tracking_number || "") !== (((order as any).tracking_number) || "") ||
      dOnly(update.delivery_date) !== dOnly((order as any).delivery_date) ||
      (update.delivery_mode || "") !== (((order as any).delivery_mode) || "");

    const { error } = await supabase.from("pedidos").update(update).eq("id", order.id);
    setSaving(false);
    if (error) { toast.error("Error saving"); return; }
    toast.success("Order saved");
    log("updated", "order", order.id, `Order #${order.numero || order.id}`);
    setOrder({ ...order, ...update });

    if (notifiable) {
      const updated = { ...order, ...update };
      if (cliente?.email) {
        supabase.functions.invoke("send-email", {
          body: { type: "order_status_change", order: updated, customer: cliente, newStatus: (order as any).status },
        }).catch(() => {});
      }
      supabase.functions.invoke("notify-dispatch", { body: { event: "order_status", vars: {
        order_id: (order as any).numero ?? order.id, status: (order as any).status ?? "",
        total: (order as any).total ?? "",
        customer_name: cliente?.nome ?? "", customer_company: cliente?.empresa ?? "",
        customer_email: cliente?.email ?? "", customer_phone: (cliente as any)?.telefone ?? "",
      }, customer: { email: cliente?.email, phone: (cliente as any)?.telefone, whatsapp: (cliente as any)?.telefone } } }).catch(() => {});
    }

    if (goBack) navigate("/admin/orders");
  };

  const searchProducts = async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) { setProducts([]); return; }
    const { data } = await supabase
      .from("produtos")
      .select("id, nome, sku, preco, estoque_total, estoque_reservado, imagem_url, categoria_id")
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
      sku: product.sku ?? "",
      preco_unitario: product.preco,
      quantidade: qty,
      subtotal: product.preco * qty,
    });
    if (error) { toast.error("Error adding product"); return; }
    // Os triggers recomputam preço do item, subtotal e total no banco (incl. desconto/
    // imposto/frete). Não calcula nada no client — só recarrega o valor autoritativo.
    setAddProductOpen(false);
    setProductSearch("");
    setProducts([]);
    toast.success(`${product.nome} added`);
    loadOrder();
  };

  const handleDeleteItem = async (itemId: string, _itemSubtotal?: number) => {
    if (!order || !confirm("Remove this item?")) return;
    const { error } = await supabase.from("pedido_itens").delete().eq("id", itemId);
    if (error) { toast.error("Error removing item"); return; }
    // Triggers recomputam subtotal/total e devolvem a reserva de estoque; recarrega.
    toast.success("Item removed");
    loadOrder();
  };

  // ===== Criação de pedido pelo admin (isNew) — itens ficam em rascunho na memória =====
  const handleAddProductDraft = async (product: any) => {
    if (!selectedClienteId) { toast.error("Select a customer first"); return; }
    let price = Number(product.preco) || 0;
    try {
      const r = await getProductPrice({ productId: product.id, customerId: selectedClienteId, quantity: 1 });
      if (r?.price != null) price = r.price; // preço da tabela do cliente
    } catch { /* mantém preço base */ }
    setItems((prev) => {
      const ex = prev.find((i) => i.produto_id === product.id);
      if (ex) {
        return prev.map((i) => i.produto_id === product.id
          ? { ...i, quantidade: i.quantidade + 1, subtotal: (i.quantidade + 1) * i.preco_unitario }
          : i);
      }
      return [...prev, {
        id: `draft-${product.id}-${prev.length}`, produto_id: product.id,
        nome_produto: product.nome, sku: product.sku,
        preco_unitario: price, quantidade: 1, subtotal: price,
      }];
    });
    setAddProductOpen(false); setProductSearch(""); setProducts([]);
    toast.success(`${product.nome} added`);
  };

  const handleSetDraftQty = (produtoId: string, qty: number) => {
    const q = Math.max(1, qty || 1);
    setItems((prev) => prev.map((i) => i.produto_id === produtoId
      ? { ...i, quantidade: q, subtotal: q * i.preco_unitario } : i));
  };

  const handleRemoveDraftItem = (produtoId: string) => {
    setItems((prev) => prev.filter((i) => i.produto_id !== produtoId));
  };

  const handleCreateOrder = async () => {
    if (!selectedClienteId) { toast.error("Select a customer"); return; }
    if (items.length === 0) { toast.error("Add at least one product"); return; }
    setSaving(true);
    const subtotal = items.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
    const quantidade = items.reduce((s, i) => s + i.quantidade, 0);
    // numero NÃO é setado de propósito — o banco gera (serial), igual ao Checkout do portal.
    const { data: pedido, error } = await supabase.from("pedidos").insert({
      cliente_id: selectedClienteId,
      status: "submitted",
      subtotal, total: subtotal,
      quantidade_total: quantidade,
      po_number: form.po_number || null,
      delivery_date: form.delivery_date || null,
      observacoes: form.observacoes || null,
      admin_notes: form.admin_notes || null,
    } as any).select().single();
    if (error || !pedido) { toast.error("Error creating order: " + (error?.message ?? "")); setSaving(false); return; }
    // Inserir itens dispara o trigger de reserva de estoque (estoque_reservado), igual ao portal.
    const itens = items.map((i) => ({
      pedido_id: pedido.id, produto_id: i.produto_id, nome_produto: i.nome_produto,
      sku: i.sku, preco_unitario: i.preco_unitario, quantidade: i.quantidade,
      subtotal: i.preco_unitario * i.quantidade,
    }));
    const { error: itErr } = await supabase.from("pedido_itens").insert(itens);
    setSaving(false);
    if (itErr) { toast.error("Order created but items failed: " + itErr.message); }
    log("created", "order", pedido.id, `Order #${pedido.numero || pedido.id}`);
    // Notifica igual ao checkout do portal (respeita a config do evento new_order).
    const cli = allClientes.find((c) => c.id === selectedClienteId);
    if (cli) {
      const emailCustomer = { id: cli.id, email: cli.email, nome: cli.nome, empresa: cli.empresa };
      const emailItems = items.map((i) => ({ sku: i.sku, nome_produto: i.nome_produto, preco_unitario: i.preco_unitario, quantidade: i.quantidade, subtotal: i.preco_unitario * i.quantidade }));
      supabase.functions.invoke("send-email", { body: { type: "new_order_customer", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});
      supabase.functions.invoke("send-email", { body: { type: "new_order_admin", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});
      supabase.functions.invoke("notify-dispatch", { body: { event: "new_order", vars: {
        order_id: (pedido as any).numero ?? pedido.id, total: subtotal, date: new Date().toLocaleString("pt-BR"),
        items: items.map((i) => `• ${i.quantidade}x ${i.nome_produto} — ${i.preco_unitario}`).join("\n"),
        customer_name: cli.nome ?? "", customer_company: cli.empresa ?? "", customer_email: cli.email ?? "", customer_phone: (cli as any).telefone ?? "",
      }, customer: { email: cli.email, phone: (cli as any).telefone, whatsapp: (cli as any).telefone } } }).catch(() => {});
    }
    toast.success(`Order #${pedido.numero ?? ""} created`);
    navigate(`/admin/orders/${pedido.id}`);
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
      // Abre o PDF REAL (o MESMO que vai anexado no email) numa nova aba.
      if (data?.pdf_base64) {
        const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        toast.error("PDF not generated.");
      }
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

  // ===== CRIAR PEDIDO (admin) — tela dedicada, grava de verdade em pedidos+pedido_itens =====
  if (isNew) {
    const draftSubtotal = items.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
    const draftQty = items.reduce((s, i) => s + i.quantidade, 0);
    return (
      <AdminLayout>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Order</h2>
          <Button onClick={handleCreateOrder} disabled={saving || !selectedClienteId || items.length === 0} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Creating..." : "Create Order"}
          </Button>
        </div>

        <Card className="mb-6 p-5 space-y-4">
          <div>
            <Label>Customer *</Label>
            <Select value={selectedClienteId} onValueChange={setSelectedClienteId}>
              <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
              <SelectContent>
                {allClientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.empresa || c.nome}{c.email ? ` (${c.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedClienteId && (
              <p className="text-xs text-muted-foreground mt-1">Prices use the customer's price list automatically.</p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Purchase order</Label>
              <Input value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} />
            </div>
            <div>
              <Label>Delivery date</Label>
              <Input type="date" value={form.delivery_date} onChange={(e) => setForm((f) => ({ ...f, delivery_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Comments</Label>
            <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} />
          </div>
        </Card>

        <Card className="mb-6 p-0 overflow-hidden">
          <div className="bg-muted/30 px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm text-primary">Products</h3>
            <Button size="sm" variant="outline" className="gap-1" disabled={!selectedClienteId} onClick={() => setAddProductOpen(true)}>
              <Plus className="h-4 w-4" /> Add product
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Price</TableHead>
                <TableHead>Qty</TableHead><TableHead>Total</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    {selectedClienteId ? 'No products yet — click "Add product".' : "Select a customer first."}
                  </TableCell>
                </TableRow>
              ) : items.map((i) => (
                <TableRow key={i.produto_id}>
                  <TableCell>{i.sku}</TableCell>
                  <TableCell>{i.nome_produto}</TableCell>
                  <TableCell>{fmt(i.preco_unitario)}</TableCell>
                  <TableCell>
                    <Input type="number" min={1} value={i.quantidade}
                      onChange={(e) => handleSetDraftQty(i.produto_id, parseInt(e.target.value))} className="w-20" />
                  </TableCell>
                  <TableCell>{fmt(i.preco_unitario * i.quantidade)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => handleRemoveDraftItem(i.produto_id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-5 py-3 border-t border-border text-right text-sm space-y-1">
            <div>Total Quantity: <b>{draftQty}</b></div>
            <div>Total: <b>{fmt(draftSubtotal)}</b></div>
          </div>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => navigate("/admin/orders")}>Back</Button>
          <Button onClick={handleCreateOrder} disabled={saving || !selectedClienteId || items.length === 0} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Creating..." : "Create Order"}
          </Button>
        </div>

        <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search by name or SKU..." value={productSearch}
                onChange={(e) => searchProducts(e.target.value)} />
            </div>
            <div className="max-h-72 overflow-auto divide-y">
              {products.map((p) => (
                <button key={p.id} className="w-full text-left px-2 py-2 hover:bg-muted/50 flex justify-between gap-2"
                  onClick={() => handleAddProductDraft(p)}>
                  <span className="min-w-0">
                    <span className="block truncate">{p.nome}{p.sku && <span className="text-xs text-muted-foreground"> ({p.sku})</span>}</span>
                    {categoryPath(categorias, p.categoria_id) && (
                      <span className="block text-xs text-muted-foreground truncate">{categoryPath(categorias, p.categoria_id)}</span>
                    )}
                  </span>
                  <span className="text-sm whitespace-nowrap">{fmt(Number(p.preco) || 0)}</span>
                </button>
              ))}
              {productSearch.length >= 2 && products.length === 0 && (
                <p className="text-sm text-muted-foreground px-2 py-3">No products found.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
                <TableCell className="text-center">
                  <Checkbox
                    checked={item.backorder ?? false}
                    onCheckedChange={(v) => {
                      const b = v === true;
                      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, backorder: b } : it));
                      supabase.from("pedido_itens").update({ backorder: b } as any).eq("id", item.id);
                    }}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Input
                    type="number" min={0} max={item.quantidade}
                    className="h-8 w-16 mx-auto text-center"
                    value={item.quantidade_enviada ?? 0}
                    onChange={(e) => {
                      const q = parseInt(e.target.value) || 0;
                      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, quantidade_enviada: q } : it));
                      supabase.from("pedido_itens").update({ quantidade_enviada: q } as any).eq("id", item.id);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.status_linha ?? ""}
                    onValueChange={(v) => {
                      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status_linha: v } : it));
                      supabase.from("pedido_itens").update({ status_linha: v } as any).eq("id", item.id);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue placeholder={order?.status ? statusLabel(order.status) : "Status"} />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
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
              <span className="text-right text-muted-foreground">Discount:</span>
              <span className="text-right">{order?.desconto ? fmt(Number(order.desconto)) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2 border-t pt-2 mt-1">
              <span className="text-right font-semibold">Total after discount:</span>
              <span className="text-right">{order ? fmt(Math.max(0, Number(order.subtotal || 0) - Number(order.desconto || 0))) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2">
              <span className="text-right font-semibold">Sales Tax:</span>
              <span className="text-right">{order ? fmt(Number(order.sales_tax || 0)) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2">
              <span className="text-right font-semibold">Shipping:</span>
              <span className="text-right">{order ? fmt(Number(order.shipping_costs || 0)) : "$ 0.00"}</span>
            </div>
            <div className="grid grid-cols-[200px_100px] gap-2 border-t pt-2 mt-1">
              <span className="text-right font-bold text-base">Gross total:</span>
              <span className="text-right font-bold text-base">{order ? fmt(order.total) : "$ 0.00"}</span>
            </div>
          </div>
        </div>

        {/* Delete order */}
        <div className="border-t border-border p-5 flex items-center justify-between">
          {role === "admin" ? (
            <Button variant="destructive" size="sm" className="gap-1" onClick={handleDeleteOrder}>
              <Trash2 className="h-4 w-4" /> Delete order
            </Button>
          ) : <span />}
        </div>
      </Card>

      {/* Files / Messages (B2BWave tem; aqui NÃO há nada implementado por trás — sem tabela,
          sem upload, sem mensagens). Ocultados no go-live (2026-07-03) a pedido do dono para
          não exibir seção "coming soon" vazia em produção. Para reativar quando implementar,
          descomente os dois <Card> abaixo.
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Files</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground italic">File attachments for orders — coming soon.</p>
        </div>
      </Card>
      <Card className="mb-6 p-0 overflow-hidden bg-card/80 backdrop-blur-sm">
        <div className="bg-muted/30 px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Messages</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground italic">Order messaging — coming soon.</p>
        </div>
      </Card>
      */}

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-8">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/orders")}>
            Back
          </Button>
          <Button variant="default" size="sm" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleSave(false)} disabled={saving}>
            Save and stay on page
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setResendOpen(true)}>
            <Send className="h-4 w-4" /> Resend
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleGeneratePdf}>
            <Printer className="h-4 w-4" /> Invoice
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleGeneratePdf}>
            <FileText className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Resend order confirmation (igual ao B2BWave: cliente / admin / email avulso) */}
      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Resend order</DialogTitle></DialogHeader>
          <p className="text-sm text-primary">Re-send order confirmation email</p>
          <div className="space-y-3 py-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={resend.customer} disabled={!cliente?.email}
                onCheckedChange={(v) => setResend((r) => ({ ...r, customer: v === true }))} />
              To customer {cliente?.email ? `(${cliente.email})` : "(no email on file)"}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={resend.admin}
                onCheckedChange={(v) => setResend((r) => ({ ...r, admin: v === true }))} />
              To admin {adminEmails ? `(${adminEmails})` : ""}
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
                <Checkbox checked={resend.other}
                  onCheckedChange={(v) => setResend((r) => ({ ...r, other: v === true }))} />
                To email
              </label>
              <Input type="email" className="h-8" placeholder="name@company.com"
                value={resend.otherEmail}
                onChange={(e) => setResend((r) => ({ ...r, other: true, otherEmail: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setResendOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleResend} disabled={resending}>
              {resending ? "Sending..." : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
                      <p className="text-xs text-muted-foreground">
                        {categoryPath(categorias, p.categoria_id) && <>{categoryPath(categorias, p.categoria_id)} · </>}
                        {p.sku ? `${p.sku} · ` : ""}Stock: {(p.estoque_total ?? 0) - (p.estoque_reservado ?? 0)}
                      </p>
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
