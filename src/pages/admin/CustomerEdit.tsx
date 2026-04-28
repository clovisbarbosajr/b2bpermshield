import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";

const activityOptions = ["Other", "Contractor", "Retailer", "Wholesaler", "Distributor", "Manufacturer"];

const CustomerEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cliente, setCliente] = useState<any>(null);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [clientePrivacyGroups, setClientePrivacyGroups] = useState<string[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [selectedPaymentOptions, setSelectedPaymentOptions] = useState<string[]>([]);
  const [selectedShippingOptions, setSelectedShippingOptions] = useState<string[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactForm, setContactForm] = useState({ nome: "", email: "", role: "buyer", ativo: true });
  const [addingContact, setAddingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [pedidos, setPedidos] = useState<any[]>([]);

  const [form, setForm] = useState({
    empresa: "", nome: "", email: "", telefone: "", activity: "", language: "English (US)",
    is_active: true, disable_ordering: false, discount: 0, minimum_order_value: "",
    admin_comments: "", tabela_preco_id: "", tax_customer_group_id: "",
    representante_id: "", parent_customer_id: "",
    endereco: "", endereco2: "", cidade: "", estado: "", pais: "United States", cep: "",
    website: "", company_number: "", customer_reference_code: "",
    billing_same_as_contact: true,
  });

  useEffect(() => { loadData(); }, [id]);

  const loadData = async () => {
    const [
      { data: c },
      { data: tp },
      { data: tg },
      { data: pg },
      { data: r },
      { data: allClients },
      { data: so },
      { data: po },
    ] = await Promise.all([
      id ? supabase.from("clientes").select("*").eq("id", id).maybeSingle() : { data: null },
      supabase.from("tabelas_preco").select("*").eq("ativo", true).order("nome"),
      supabase.from("tax_customer_groups").select("*").order("nome"),
      supabase.from("privacy_groups").select("*").eq("ativo", true).order("nome"),
      supabase.from("representantes").select("*").eq("ativo", true).order("nome"),
      supabase.from("clientes").select("id, empresa, nome, email").order("empresa"),
      supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem"),
      supabase.from("payment_options").select("*").eq("ativo", true).order("ordem"),
    ]);

    setTabelasPreco(tp ?? []);
    setTaxGroups(tg ?? []);
    setPrivacyGroups(pg ?? []);
    setReps(r ?? []);
    setClientes((allClients ?? []).filter((cl: any) => cl.id !== id));
    setShippingOptions(so ?? []);
    setPaymentOptions(po ?? []);

    if (c) {
      setCliente(c);
      setForm({
        empresa: c.empresa || "", nome: c.nome || "", email: c.email || "",
        telefone: c.telefone || "", activity: c.activity || "",
        language: c.language || "English (US)", is_active: c.is_active ?? true,
        disable_ordering: c.disable_ordering ?? false, discount: c.discount ?? 0,
        minimum_order_value: c.minimum_order_value?.toString() || "",
        admin_comments: c.admin_comments || "", tabela_preco_id: c.tabela_preco_id || "",
        tax_customer_group_id: c.tax_customer_group_id || "",
        representante_id: c.representante_id || "", parent_customer_id: c.parent_customer_id || "",
        endereco: c.endereco || "", endereco2: c.endereco2 || "", cidade: c.cidade || "",
        estado: c.estado || "", pais: c.pais || "United States", cep: c.cep || "",
        website: c.website || "", company_number: c.company_number || "",
        customer_reference_code: c.customer_reference_code || "",
        billing_same_as_contact: c.billing_same_as_contact ?? true,
      });

      // Load privacy groups
      const { data: cpg } = await supabase.from("cliente_privacy_groups").select("privacy_group_id").eq("cliente_id", id!);
      setClientePrivacyGroups((cpg ?? []).map((x: any) => x.privacy_group_id));

      // Load addresses
      const { data: addrs } = await supabase.from("enderecos").select("*").eq("cliente_id", id!).order("created_at");
      setEnderecos(addrs ?? []);

      // Load selected payment/shipping options for this customer
      const [{ data: cpo }, { data: cso }] = await Promise.all([
        supabase.from("cliente_payment_options").select("payment_option_id").eq("cliente_id", id!),
        supabase.from("cliente_shipping_options").select("shipping_option_id").eq("cliente_id", id!),
      ]);
      setSelectedPaymentOptions((cpo ?? []).map((x: any) => x.payment_option_id));
      setSelectedShippingOptions((cso ?? []).map((x: any) => x.shipping_option_id));

      // Load contacts
      const { data: cts } = await supabase.from("company_contacts").select("*").eq("cliente_id", id!).order("created_at");
      setContacts(cts ?? []);

      // Load orders
      const { data: orders } = await supabase.from("pedidos").select("*").eq("cliente_id", id!).order("created_at", { ascending: false }).limit(20);
      setPedidos(orders ?? []);
    }

    setLoading(false);
  };

  const handleSave = async (goBack = false) => {
    setSaving(true);

    let userId = cliente?.user_id;

    // New customer: create auth user first, then insert cliente
    if (!cliente?.id) {
      if (!form.email) {
        toast.error("Email is required to create a customer");
        setSaving(false);
        return;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: form.email,
          nome: form.nome || form.empresa || "",
          empresa: form.empresa || "",
        },
      });

      if (fnError || fnData?.error) {
        toast.error(fnData?.error || fnError?.message || "Error creating auth user");
        setSaving(false);
        return;
      }

      userId = fnData.user_id;

      // Trigger no longer creates clientes — insert directly
      const payload = buildPayload(userId);
      const { data: newCliente, error: insertError } = await supabase
        .from("clientes")
        .insert({ ...payload, status: "ativo", is_active: true })
        .select("id")
        .single();

      if (insertError || !newCliente) {
        toast.error(insertError?.message || "Error creating customer record");
        setSaving(false);
        return;
      }

      // Assign 'cliente' role so user can log in to portal immediately
      await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: "cliente" }, { onConflict: "user_id" });

      await syncPrivacyGroups(newCliente.id);
      await syncPaymentOptions(newCliente.id);
      await syncShippingOptions(newCliente.id);
      setSaving(false);
      toast.success("Customer created with login access");
      log("created", "customer", newCliente.id, form.empresa || form.nome);
      navigate(`/admin/customers/${newCliente.id}`);
      return;
    }

    // Existing customer: update
    const payload = buildPayload(userId!);
    const { error } = await supabase.from("clientes").update(payload).eq("id", cliente.id);
    if (error) { toast.error("Error saving"); setSaving(false); return; }

    await syncPrivacyGroups(cliente.id);
    await syncPaymentOptions(cliente.id);
    await syncShippingOptions(cliente.id);
    setSaving(false);
    toast.success("Customer saved");
    log("updated", "customer", cliente.id, form.empresa || form.nome);
    if (goBack) navigate("/admin/customers");
  };

  const buildPayload = (userId: string) => ({
    empresa: form.empresa || "",
    nome: form.nome || "",
    email: form.email || "",
    telefone: form.telefone || null,
    activity: form.activity || null,
    language: form.language,
    is_active: form.is_active,
    disable_ordering: form.disable_ordering,
    discount: form.discount,
    minimum_order_value: form.minimum_order_value ? parseFloat(form.minimum_order_value) : null,
    admin_comments: form.admin_comments || null,
    tabela_preco_id: form.tabela_preco_id && form.tabela_preco_id !== '__none__' ? form.tabela_preco_id : null,
    tax_customer_group_id: form.tax_customer_group_id && form.tax_customer_group_id !== '__none__' ? form.tax_customer_group_id : null,
    representante_id: form.representante_id && form.representante_id !== '__none__' ? form.representante_id : null,
    parent_customer_id: form.parent_customer_id && form.parent_customer_id !== '__none__' ? form.parent_customer_id : null,
    endereco: form.endereco || null,
    endereco2: form.endereco2 || null,
    cidade: form.cidade || null,
    estado: form.estado || null,
    pais: form.pais || null,
    cep: form.cep || null,
    website: form.website || null,
    company_number: form.company_number || null,
    customer_reference_code: form.customer_reference_code || null,
    billing_same_as_contact: form.billing_same_as_contact,
    user_id: userId,
  });

  const syncPrivacyGroups = async (customerId: string) => {
    await supabase.from("cliente_privacy_groups").delete().eq("cliente_id", customerId);
    if (clientePrivacyGroups.length > 0) {
      await supabase.from("cliente_privacy_groups").insert(
        clientePrivacyGroups.map(pgId => ({ cliente_id: customerId, privacy_group_id: pgId }))
      );
    }
  };

  const syncPaymentOptions = async (customerId: string) => {
    await supabase.from("cliente_payment_options").delete().eq("cliente_id", customerId);
    if (selectedPaymentOptions.length > 0) {
      await supabase.from("cliente_payment_options").insert(
        selectedPaymentOptions.map(optId => ({ cliente_id: customerId, payment_option_id: optId }))
      );
    }
  };

  const syncShippingOptions = async (customerId: string) => {
    await supabase.from("cliente_shipping_options").delete().eq("cliente_id", customerId);
    if (selectedShippingOptions.length > 0) {
      await supabase.from("cliente_shipping_options").insert(
        selectedShippingOptions.map(optId => ({ cliente_id: customerId, shipping_option_id: optId }))
      );
    }
  };

  const togglePrivacyGroup = (pgId: string) => {
    setClientePrivacyGroups(prev =>
      prev.includes(pgId) ? prev.filter(x => x !== pgId) : [...prev, pgId]
    );
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

  if (!cliente && id && id !== "new") {
    return (
      <AdminLayout>
        <div className="py-20 text-center">
          <h2 className="text-xl font-semibold">Customer not found</h2>
          <Button variant="link" onClick={() => navigate("/admin/customers")}>Back to Customers</Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Header */}
      {cliente?.id && (
        <div className="mb-4 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded bg-primary/20 px-3 py-1 text-xs font-medium text-primary">
            {cliente.empresa || cliente.nome} ✕
          </span>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{cliente?.id ? `Editing customer: ${cliente.empresa || cliente.nome}` : "Create customer"}</h2>
        {cliente?.id && (
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/customers/${cliente.id}`)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit all
          </Button>
        )}
      </div>

      <Tabs defaultValue="details" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="details">Customer details</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="addresses">Addresses</TabsTrigger>
          <TabsTrigger value="sales-rep">Sales Rep</TabsTrigger>
          <TabsTrigger value="email-settings">Email Settings</TabsTrigger>
          <TabsTrigger value="homepage-products">Customer homepage products</TabsTrigger>
          <TabsTrigger value="payment-options">Payment options</TabsTrigger>
          <TabsTrigger value="shipping-options">Customer shipping options</TabsTrigger>
          <TabsTrigger value="admin-fields">Admin fields</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        {/* Customer Details Tab */}
        <TabsContent value="details">
          <Card className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div><Label>Company name</Label><Input value={form.empresa} onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))} /></div>
                <div><Label>Full Name</Label><Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Activity</Label>
                    <Select value={form.activity} onValueChange={v => setForm(f => ({ ...f, activity: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {activityOptions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Specify activity</Label><Input /></div>
                </div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div className="flex gap-2">
                  <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" type="button"
                    disabled={!cliente?.id}
                    onClick={async () => {
                      if (!form.email) { toast.error("No email"); return; }
                      const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) toast.error(error.message);
                      else toast.success(`Reset password link sent to ${form.email}`);
                    }}>🔒 Send reset password link</Button>
                  <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" type="button"
                    disabled={!cliente?.id}
                    onClick={async () => {
                      if (!form.email) { toast.error("No email"); return; }
                      const { data, error } = await supabase.auth.signInWithOtp({ email: form.email });
                      if (error) toast.error(error.message);
                      else toast.success(`One-time login link sent to ${form.email}`);
                    }}>🔑 Send one-time login link</Button>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: !!v }))} /> Is active
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.disable_ordering} onCheckedChange={v => setForm(f => ({ ...f, disable_ordering: !!v }))} /> Disable Ordering
                  </label>
                </div>
                <div>
                  <Label>Language</Label>
                  <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="English (US)">English (US)</SelectItem>
                      <SelectItem value="Spanish">Spanish</SelectItem>
                      <SelectItem value="Portuguese">Portuguese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sales Tax group *</Label>
                  <Select value={form.tax_customer_group_id} onValueChange={v => setForm(f => ({ ...f, tax_customer_group_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="No Sales Tax" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No Sales Tax</SelectItem>
                      {taxGroups.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Price List</Label>
                  <Select value={form.tabela_preco_id} onValueChange={v => setForm(f => ({ ...f, tabela_preco_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {tabelasPreco.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Discount</Label>
                  <div className="flex items-center gap-1">
                    <Input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} className="max-w-[100px]" />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <div><Label>Minimum order value</Label><Input value={form.minimum_order_value} onChange={e => setForm(f => ({ ...f, minimum_order_value: e.target.value }))} /></div>
                <div><Label>Phone</Label><Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} /></div>
                <div><Label>Admin comments</Label><Textarea value={form.admin_comments} onChange={e => setForm(f => ({ ...f, admin_comments: e.target.value }))} rows={3} /></div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div><Label>Address</Label><Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} /></div>
                <div><Label>Address Line 2</Label><Input value={form.endereco2} onChange={e => setForm(f => ({ ...f, endereco2: e.target.value }))} /></div>
                <div><Label>City</Label><Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} /></div>
                <div><Label>State</Label><Input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} /></div>
                <div>
                  <Label>Country</Label>
                  <Select value={form.pais} onValueChange={v => setForm(f => ({ ...f, pais: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="United States">United States</SelectItem>
                      <SelectItem value="Canada">Canada</SelectItem>
                      <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                      <SelectItem value="Brazil">Brazil</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Postal code</Label><Input value={form.cep} onChange={e => setForm(f => ({ ...f, cep: e.target.value }))} /></div>
                <div><Label>Website</Label><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
                <div><Label>Company number</Label><Input value={form.company_number} onChange={e => setForm(f => ({ ...f, company_number: e.target.value }))} /></div>
                <div><Label>Customer reference code</Label><Input value={form.customer_reference_code} onChange={e => setForm(f => ({ ...f, customer_reference_code: e.target.value }))} /></div>
                <div>
                  <Label>Parent customer</Label>
                  <Select value={form.parent_customer_id} onValueChange={v => setForm(f => ({ ...f, parent_customer_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Please select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {clientes.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.empresa} {c.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Privacy groups</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {clientePrivacyGroups.map(pgId => {
                      const pg = privacyGroups.find(g => g.id === pgId);
                      return pg ? (
                        <Badge key={pgId} variant="secondary" className="gap-1 cursor-pointer" onClick={() => togglePrivacyGroup(pgId)}>
                          ✕ {pg.nome}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                  <Select onValueChange={v => { if (v && !clientePrivacyGroups.includes(v)) togglePrivacyGroup(v); }}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder="Add group..." /></SelectTrigger>
                    <SelectContent>
                      {privacyGroups.filter(g => !clientePrivacyGroups.includes(g.id)).map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing">
          <Card className="p-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.billing_same_as_contact} onCheckedChange={v => setForm(f => ({ ...f, billing_same_as_contact: !!v }))} />
              Same as contact details
            </label>
          </Card>
        </TabsContent>

        {/* Addresses Tab */}
        <TabsContent value="addresses">
          <Card className="p-6">
            <div className="mb-4">
              <Label className="text-sm">Allow ordering from countries</Label>
              <div className="border rounded p-2 h-24 overflow-y-auto text-sm text-muted-foreground mt-1">
                United Kingdom<br />United States<br />Canada<br />Australia<br />Brazil
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>City / State</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Postal code</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {enderecos.map(addr => (
                  <TableRow key={addr.id}>
                    <TableCell>
                      <Input defaultValue={addr.logradouro} className="mb-1" />
                      <Input defaultValue={addr.complemento || ""} placeholder="Address line 2" />
                    </TableCell>
                    <TableCell>
                      <Input defaultValue={addr.cidade} className="mb-1" />
                      <Input defaultValue={addr.estado} />
                    </TableCell>
                    <TableCell>
                      <Select defaultValue="United States">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="United States">United States</SelectItem>
                          <SelectItem value="Canada">Canada</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input defaultValue={addr.cep} /></TableCell>
                    <TableCell><Checkbox defaultChecked={addr.principal} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                        await supabase.from("enderecos").delete().eq("id", addr.id);
                        setEnderecos(prev => prev.filter(a => a.id !== addr.id));
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1" onClick={async () => {
              const { data } = await supabase.from("enderecos").insert({
                cliente_id: cliente.id, logradouro: "", cidade: "", estado: "", cep: ""
              }).select().single();
              if (data) setEnderecos(prev => [...prev, data]);
            }}>
              <Plus className="h-4 w-4" /> Add Address
            </Button>
          </Card>
        </TabsContent>

        {/* Sales Rep Tab */}
        <TabsContent value="sales-rep">
          <Card className="p-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sales Rep</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.representante_id && reps.find(r => r.id === form.representante_id) && (
                  <TableRow>
                    <TableCell>{reps.find(r => r.id === form.representante_id)?.nome}</TableCell>
                    <TableCell>{reps.find(r => r.id === form.representante_id)?.comissao_percentual}%</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setForm(f => ({ ...f, representante_id: "" }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="mt-3 flex gap-2">
              <Select value="" onValueChange={v => setForm(f => ({ ...f, representante_id: v }))}>
                <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add Sales Rep..." /></SelectTrigger>
                <SelectContent>
                  {reps.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </TabsContent>

        {/* Email Settings Tab */}
        <TabsContent value="email-settings">
          <Card className="p-6 space-y-5">
            <p className="text-sm text-muted-foreground">Email notification settings for this customer. Configurations are inherited from the global settings.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div><Label>Attach new order cc .xls file</Label><Input placeholder="" className="mt-1" /></div>
              <div><Label>Attach new order cc .txt file</Label><Input placeholder="" className="mt-1" /></div>
              <div><Label>Email for new order notification</Label><Input placeholder="" className="mt-1" /></div>
              <div>
                <Label>Add multiple emails split with commas</Label>
                <Input placeholder="e.g. joe.darling@belocore.com,info@belocore.com" className="mt-1" />
              </div>
              <div><Label>Email file location</Label><Input placeholder="" className="mt-1" /></div>
            </div>
            <div className="space-y-3 pt-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox /> Receive email notifications
              </label>
              <div>
                <Label className="text-sm">Bcc outgoing emails to customers</Label>
                <Input placeholder="" className="mt-1" />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Customer homepage products */}
        <TabsContent value="homepage-products">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Configure products that appear on this customer's homepage. Select a product from the list and/or enter a free text query.</p>
            <div className="mb-4">
              <Label className="text-sm">Only show</Label>
              <Input className="mt-1 max-w-[200px]" placeholder="" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-4">No products configured</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1 bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4" /> Add a product
            </Button>
          </Card>
        </TabsContent>

        {/* Payment options */}
        <TabsContent value="payment-options">
          <Card className="p-6">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 mb-4">
              <p className="text-sm text-amber-200">Select the payment options available to this customer. If none are selected, the customer will have access to all active payment options configured in your global settings.</p>
            </div>
            <div className="space-y-3">
              {paymentOptions.map(po => (
                <div key={po.id} className="space-y-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedPaymentOptions.includes(po.id)}
                      onCheckedChange={v => setSelectedPaymentOptions(prev =>
                        v ? [...prev, po.id] : prev.filter(id => id !== po.id)
                      )}
                    />
                    {po.nome}
                  </label>
                </div>
              ))}
              {paymentOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">No payment options configured. Add them in Settings → Payment Options.</p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Shipping options */}
        <TabsContent value="shipping-options">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Configure available shipping options for this customer.</p>
            <div className="space-y-3">
              {shippingOptions.map(so => (
                <label key={so.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedShippingOptions.includes(so.id)}
                    onCheckedChange={v => setSelectedShippingOptions(prev =>
                      v ? [...prev, so.id] : prev.filter(id => id !== so.id)
                    )}
                  />
                  {so.nome}
                </label>
              ))}
              {shippingOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">No shipping options configured. Add them in Settings → Shipping Options.</p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Admin fields */}
        <TabsContent value="admin-fields">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Custom admin fields for this customer.</p>
            <div className="space-y-4">
              <div>
                <Label>CERTIFIED B2 EXPERT</Label>
                <Select>
                  <SelectTrigger className="mt-1 max-w-[200px]"><SelectValue placeholder="No" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Contacts Tab */}
        <TabsContent value="contacts">
          <Card className="p-6">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Company contacts are additional users who can log in to the portal on behalf of this company. Each contact has their own email/password and a role.
              </p>
            </div>

            {contacts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map(ct => (
                    <TableRow key={ct.id}>
                      <TableCell>{ct.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{ct.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">{ct.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ct.ativo ? "default" : "secondary"} className="cursor-pointer"
                          onClick={async () => {
                            await supabase.from("company_contacts").update({ ativo: !ct.ativo }).eq("id", ct.id);
                            setContacts(prev => prev.map(c => c.id === ct.id ? { ...c, ativo: !c.ativo } : c));
                          }}>
                          {ct.ativo ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Send reset password"
                            onClick={async () => {
                              const { error } = await supabase.auth.resetPasswordForEmail(ct.email, { redirectTo: `${window.location.origin}/reset-password` });
                              if (error) toast.error(error.message);
                              else toast.success(`Reset link sent to ${ct.email}`);
                            }}>
                            🔒
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            onClick={async () => {
                              if (!confirm(`Remove contact ${ct.nome}?`)) return;
                              await supabase.from("company_contacts").delete().eq("id", ct.id);
                              setContacts(prev => prev.filter(c => c.id !== ct.id));
                              toast.success("Contact removed");
                            }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {addingContact ? (
              <div className="mt-4 rounded-lg border p-4 space-y-3">
                <h4 className="text-sm font-semibold">New Contact</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={contactForm.nome} onChange={e => setContactForm(f => ({ ...f, nome: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <Select value={contactForm.role} onValueChange={v => setContactForm(f => ({ ...f, role: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buyer">Buyer — can browse and place orders</SelectItem>
                        <SelectItem value="viewer">Viewer — can browse only (no orders)</SelectItem>
                        <SelectItem value="manager">Manager — buyer + sees all company orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={savingContact} onClick={async () => {
                    if (!contactForm.nome || !contactForm.email) { toast.error("Name and email required"); return; }
                    if (!cliente?.id) { toast.error("Save the customer first"); return; }
                    setSavingContact(true);
                    // Create auth user
                    const { data: fnData, error: fnErr } = await supabase.functions.invoke("admin-create-user", {
                      body: { email: contactForm.email, nome: contactForm.nome, empresa: cliente.empresa || "" },
                    });
                    if (fnErr || fnData?.error) { toast.error(fnData?.error || fnErr?.message); setSavingContact(false); return; }
                    // Insert contact record
                    const { data: ct, error: ctErr } = await supabase.from("company_contacts").insert({
                      cliente_id: cliente.id, user_id: fnData.user_id,
                      nome: contactForm.nome, email: contactForm.email, role: contactForm.role, ativo: true,
                    }).select().single();
                    if (ctErr) { toast.error(ctErr.message); setSavingContact(false); return; }
                    // Also give them a 'cliente' role in user_roles
                    await supabase.from("user_roles").upsert({ user_id: fnData.user_id, role: "cliente" }, { onConflict: "user_id" });
                    setContacts(prev => [...prev, ct]);
                    setContactForm({ nome: "", email: "", role: "buyer", ativo: true });
                    setAddingContact(false);
                    setSavingContact(false);
                    toast.success(`Contact ${contactForm.nome} created. A setup email was sent to ${contactForm.email}.`);
                  }}>
                    {savingContact ? "Creating..." : "Create Contact"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingContact(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" className="mt-4 gap-1" disabled={!cliente?.id}
                onClick={() => setAddingContact(true)}>
                <Plus className="h-4 w-4" /> Add Contact
              </Button>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bottom action bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleSave(true)}>Back</Button>
          <Button size="sm" className="bg-primary" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSave(false)} disabled={saving}>
            Save and stay on page
          </Button>
        </div>
        {cliente?.id && (
          <div className="flex gap-2 flex-wrap">
            {cliente?.status === "pendente" && (
              <>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={async () => {
                  await supabase.from("clientes").update({ status: "ativo", is_active: true } as any).eq("id", cliente.id);
                  // Ensure user can log in to portal — add cliente role if not already set
                  if (cliente.user_id) {
                    await (supabase.from("user_roles") as any).upsert(
                      { user_id: cliente.user_id, role: "cliente" },
                      { onConflict: "user_id" }
                    );
                  }
                  setCliente({ ...cliente, status: "ativo", is_active: true });
                  toast.success("Customer approved!");
                  log("updated", "customer", cliente.id, cliente.empresa || cliente.nome, { action: "approved" });
                  supabase.functions.invoke("send-email", {
                    body: {
                      type: "approval",
                      customerEmail: cliente.email,
                      customerName: cliente.nome || cliente.empresa || "",
                      loginUrl: `${window.location.origin}/customers-login`,
                    },
                  }).catch(() => {});
                }}>
                  ✓ Approve Customer
                </Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  if (!confirm("Reject this customer? They will receive a rejection email.")) return;
                  await supabase.from("clientes").update({ status: "rejeitado", is_active: false } as any).eq("id", cliente.id);
                  setCliente({ ...cliente, status: "rejeitado", is_active: false });
                  toast.info("Customer rejected");
                  supabase.functions.invoke("send-email", {
                    body: {
                      type: "rejection",
                      customerEmail: cliente.email,
                      customerName: cliente.nome || cliente.empresa || "",
                    },
                  }).catch(() => {});
                }}>
                  ✗ Reject
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => navigate(`/admin/orders/new?customer=${cliente.id}`)}>
              Create Order
            </Button>
            <Button variant="outline" size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
              navigate(`/admin/orders?customer=${cliente.id}`);
            }}>
              View all orders
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default CustomerEdit;
