import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Trash2, Eye, EyeOff } from "lucide-react";

type GatewayType = "none" | "sola" | "paypal" | "stripe" | "square" | "authorize_net" | "paynote";

const GATEWAY_OPTIONS: { value: GatewayType; label: string }[] = [
  { value: "none", label: "No gateway (manual)" },
  { value: "sola", label: "Credit Card payments with Sola" },
  { value: "paypal", label: "Paypal" },
  { value: "stripe", label: "Credit Card (with Stripe)" },
  { value: "square", label: "Credit Card (with Square)" },
  { value: "authorize_net", label: "Credit Card (with Authorize.Net)" },
  { value: "paynote", label: "ACH Payments with Paynote" },
];

const PaymentOptions = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [listView, setListView] = useState(true);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const defaultForm = {
    nome: "", descricao: "", instrucoes: "", ativo: true, ordem: 0,
    privado: false, taxa_percentual: 0, taxa_valor: 0, cobrar_checkout: false,
    due_in_days: "", gateway_type: "none" as GatewayType, gateway_config: {} as Record<string, any>,
  };
  const [form, setForm] = useState(defaultForm);

  const fetchData = async () => {
    const { data, error } = await supabase.from("payment_options").select("*").order("ordem");
    // Erro calado deixava a lista vazia — parecia "nao ha forma de pagamento
    // configurada", e o admin cadastrava a segunda por cima da primeira.
    if (error) toast.error("Could not load payment options: " + error.message);
    setItems(data ?? []); setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm(defaultForm); setShowSecrets({}); setListView(false); };
  const openEdit = (r: any) => {
    setEditing(r);
    const gc = typeof r.gateway_config === "object" && r.gateway_config ? r.gateway_config : {};
    setForm({
      nome: r.nome, descricao: r.descricao ?? "", instrucoes: r.instrucoes ?? "",
      ativo: r.ativo ?? true, ordem: r.ordem ?? 0,
      privado: r.privado ?? false, taxa_percentual: Number(r.taxa_percentual ?? 0),
      taxa_valor: Number(r.taxa_valor ?? 0), cobrar_checkout: r.cobrar_checkout ?? false,
      due_in_days: r.due_in_days ?? "",
      gateway_type: (r.gateway_type ?? "none") as GatewayType,
      gateway_config: gc,
    });
    setShowSecrets({});
    setListView(false);
  };

  const updateConfig = (key: string, value: any) => {
    setForm(prev => ({ ...prev, gateway_config: { ...prev.gateway_config, [key]: value } }));
  };

  const handleSave = async () => {
    // Mesma guarda do PrivacyGroups: `nome` NOT NULL aceita string vazia, e a
    // opcao sem nome aparece como um radio EM BRANCO no checkout do cliente.
    const nome = form.nome.trim();
    if (!nome) { toast.error("Name is required."); return; }
    setSaving(true);
    const payload: any = {
      nome,
      descricao: form.descricao || null,
      instrucoes: form.instrucoes || null,
      ativo: form.ativo,
      ordem: form.ordem,
      privado: form.privado,
      taxa_percentual: form.taxa_percentual,
      taxa_valor: form.taxa_valor,
      cobrar_checkout: form.cobrar_checkout,
      due_in_days: form.due_in_days === "" ? null : Number(form.due_in_days),
      gateway_type: form.gateway_type === "none" ? null : form.gateway_type,
      gateway_config: form.gateway_config,
    };
    const { error } = editing
      ? await supabase.from("payment_options").update(payload).eq("id", editing.id)
      : await supabase.from("payment_options").insert(payload);
    setSaving(false);
    if (error) { toast.error("Could not save: " + error.message); return; }
    toast.success(editing ? "Updated" : "Created");
    setListView(true); fetchData();
  };

  const handleDelete = async (id: string, nome: string) => {
    // `cliente_payment_options.payment_option_id` e ON DELETE CASCADE
    // (20260407000000:25, 20260408160833:20): apagar a opcao apaga junto TODA
    // atribuicao de cliente, sem volta, e recriar a opcao nao traz nenhuma de
    // volta. O confirm dizia so "Delete this payment option?".
    //
    // Opcao ja usada em pedido nao chega aqui — `pedidos.payment_option_id` e NO
    // ACTION e o banco recusa. O caso vivo e a opcao SEM pedido nenhum: a que o
    // admin apaga justamente para limpar cadastro.
    //
    // Mesmo padrao do `PrivacyGroups.handleDelete`: contar antes, e RECUSAR se a
    // contagem falhar — nao da para avisar de um estrago que nao se conseguiu
    // medir.
    const { count, error: contaErr } = await supabase
      .from("cliente_payment_options")
      .select("payment_option_id", { count: "exact", head: true })
      .eq("payment_option_id", id);
    if (contaErr) {
      toast.error("Could not check which customers use this option — nothing was deleted: " + contaErr.message);
      return;
    }
    if (!confirm(
      `Delete "${nome}"?\n\n` +
      `This permanently deletes, together with the option:\n` +
      `• ${count ?? 0} customer assignment(s)\n\n` +
      `Those customers lose this payment option at checkout. This cannot be undone.`
    )) return;
    const { error } = await supabase.from("payment_options").delete().eq("id", id);
    if (error) { toast.error("Could not delete: " + error.message); return; }
    toast.success("Deleted");
    fetchData();
  };

  const toggleSecret = (field: string) => setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));

  // Era um COMPONENTE declarado DENTRO do render. A cada tecla o `updateConfig`
  // chama `setForm`, o componente pai re-renderiza e `SecretInput` ganha uma
  // identidade nova — pro React e outro tipo de componente, entao ele DESMONTA e
  // remonta o <input>. O campo perdia o foco a cada caractere: dava pra digitar
  // exatamente uma letra por clique. Chave de gateway (Stripe secret, token do
  // Square) so entrava colada, e qualquer correcao depois era impossivel.
  // Como funcao que devolve JSX nao ha fronteira de componente e o input fica.
  const secretInput = (field: string, label: string, required?: boolean) => (
    <div key={field}>
      <Label>{label}{required && " *"}</Label>
      <div className="relative">
        <Input
          type={showSecrets[field] ? "text" : "password"}
          value={form.gateway_config[field] ?? ""}
          onChange={e => updateConfig(field, e.target.value)}
        />
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => toggleSecret(field)}>
          {showSecrets[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  const renderGatewayFields = () => {
    switch (form.gateway_type) {
      case "sola":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Sola Configuration</h4>
            <p className="text-xs text-muted-foreground">Obtain your API Key from the Sola dashboard under <strong>Gateway Settings → Key Management</strong></p>
            {secretInput("api_key", "API Key", true)}
          </Card>
        );
      case "paypal":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Paypal configuration</h4>
            <p className="text-xs text-muted-foreground">
              Paypal authentication uses Paypal API Signature for authentication. Please consult the information in the following link in order to obtain your Paypal API Credentials for the Signature method:{" "}
              <a href="https://developer.paypal.com/docs/nvp-soap-api/apiCredentials/#api-signatures" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                https://developer.paypal.com/docs/nvp-soap-api/apiCredentials/#api-signatures
              </a>
            </p>
            {secretInput("api_login", "API Login", true)}
            {secretInput("api_password", "API Password", true)}
            {secretInput("api_signature", "API Signature", true)}
            <div>
              <Label>Mode *</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gateway_config.mode ?? "production"} onChange={e => updateConfig("mode", e.target.value)}>
                <option value="production">production</option>
                <option value="sandbox">sandbox</option>
              </select>
            </div>
            <div>
              <Label>Capture Amount *</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gateway_config.capture_amount ?? ""} onChange={e => updateConfig("capture_amount", e.target.value)}>
                <option value="">Select...</option>
                <option value="immediately">Immediately</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </Card>
        );
      case "stripe":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Stripe Configuration</h4>
            <div className="flex gap-4 border-b border-border pb-2 mb-2">
              <button type="button" className={`text-sm pb-1 ${!form.gateway_config.use_keys ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`} onClick={() => updateConfig("use_keys", false)}>Stripe Connect</button>
              <button type="button" className={`text-sm pb-1 ${form.gateway_config.use_keys ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`} onClick={() => updateConfig("use_keys", true)}>Advanced (Stripe keys)</button>
            </div>
            {form.gateway_config.use_keys ? (
              <>
                {secretInput("publishable_key", "Publishable Key", true)}
                {secretInput("secret_key", "Secret Key", true)}
              </>
            ) : (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm text-amber-200">
                  Stripe Connect (OAuth) is not enabled yet. Use the{" "}
                  <button type="button" className="underline font-medium" onClick={() => updateConfig("use_keys", true)}>
                    Advanced (Stripe keys)
                  </button>{" "}
                  tab and paste your Publishable + Secret keys to enable card payments.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.gateway_config.save_cards ?? false} onChange={e => updateConfig("save_cards", e.target.checked)} /> Allow saving of card details for reuse</label>
          </Card>
        );
      case "square":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Square configuration</h4>
            {secretInput("application_id", "Application ID", true)}
            {secretInput("location_id", "Location ID", true)}
            {secretInput("access_token", "Access Token", true)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.gateway_config.save_cards ?? false} onChange={e => updateConfig("save_cards", e.target.checked)} /> Allow saving of card details for reuse</label>
          </Card>
        );
      case "authorize_net":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Authorize.Net Configuration</h4>
            <p className="text-xs text-muted-foreground">Sign up with Authorize.Net to accept Credit Card payments.</p>
            {secretInput("api_login_id", "API Login ID", true)}
            {secretInput("transaction_key", "Transaction Key", true)}
            <div>
              <Label>Mode</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gateway_config.mode ?? "production"} onChange={e => updateConfig("mode", e.target.value)}>
                <option value="production">production</option>
                <option value="sandbox">sandbox</option>
              </select>
            </div>
          </Card>
        );
      case "paynote":
        return (
          <Card className="p-4 space-y-4 mt-4">
            <h4 className="text-base font-semibold text-primary">Paynote Configuration</h4>
            <p className="text-xs text-muted-foreground">Sign up with Paynote to accept ACH payments.</p>
            {secretInput("api_key", "API Key", true)}
            {secretInput("merchant_id", "Merchant ID", true)}
          </Card>
        );
      default:
        return null;
    }
  };

  const BoolIcon = ({ val }: { val: boolean }) => val ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />;

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  // Edit form
  if (!listView) {
    return (
      <AdminLayout>
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold">{editing ? editing.nome : "New Payment Option"}</h2>
        </div>
        <div className="max-w-3xl space-y-4">
          <div><Label>Name</Label><Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div>
            <Label>Description</Label>
            <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} />
            <p className="text-xs text-muted-foreground">Description will be shown to customers at the order checkout form</p>
          </div>

          {/* Gateway type selector */}
          <div>
            <Label>Payment Gateway</Label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gateway_type} onChange={e => setForm({ ...form, gateway_type: e.target.value as GatewayType, gateway_config: {} })}>
              {GATEWAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {renderGatewayFields()}

          {/* Due in days - for credit/manual types */}
          {(form.gateway_type === "none") && (
            <div><Label>Due in Days</Label><Input type="number" value={form.due_in_days} onChange={e => setForm({ ...form, due_in_days: e.target.value })} placeholder="Leave empty for no due date" /></div>
          )}

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.cobrar_checkout} onChange={e => setForm({ ...form, cobrar_checkout: e.target.checked })} /> Charge on checkout</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.privado} onChange={e => setForm({ ...form, privado: e.target.checked })} /> Private</label>
          <div><Label>View order</Label><Input type="number" value={form.ordem} onChange={e => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} /></div>
          {/* CAMPOS REMOVIDOS DA TELA em 25/ago/2026, por decisao do dono.
            *
            * `taxa_percentual` e `taxa_valor` sao gravados e NUNCA entram no
            * total: `fn_pedido_total_appside` calcula desconto, frete, imposto e
            * total, e nao le nenhum dos dois. Configurar "taxa de 3% no cartao"
            * nao cobrava nada. Ja estava registrado como N9 no log de trabalho.
            *
            * AS COLUNAS CONTINUAM NO BANCO com os valores atuais — nada se
            * perde.
            *
            * PARA VOLTAR: descomente este bloco E some a taxa no servidor,
            * dentro de `fn_pedido_total_appside` (decidindo se incide sobre o
            * subtotal ou sobre o total ja com imposto e frete). Sem a segunda
            * parte, volta a ser fantasma.
            *
            * <div><Label>Payment Fee Percentage</Label><Input type="number" step="0.01" value={form.taxa_percentual} onChange={e => setForm({ ...form, taxa_percentual: parseFloat(e.target.value) || 0 })} /></div>
            * <div><Label>Payment Fee Amount</Label><Input type="number" step="0.01" value={form.taxa_valor} onChange={e => setForm({ ...form, taxa_valor: parseFloat(e.target.value) || 0 })} /></div>
            */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={() => setListView(true)}>Back</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // List view
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Payment Options</h2>
        <Button onClick={openNew} className="mt-3 gap-1"><Plus className="h-4 w-4" /> Create payment option</Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Private</TableHead>
              <TableHead>View order</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                <TableCell><BoolIcon val={r.ativo ?? true} /></TableCell>
                <TableCell><BoolIcon val={r.privado ?? false} /></TableCell>
                <TableCell>{r.ordem}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id, r.nome)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-sm text-muted-foreground mt-3">Contact support for questions regarding payment options</p>
      <Button onClick={openNew} className="mt-4 gap-1"><Plus className="h-4 w-4" /> Create payment option</Button>
    </AdminLayout>
  );
};

export default PaymentOptions;
