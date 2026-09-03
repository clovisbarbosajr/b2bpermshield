import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Trash2 } from "lucide-react";

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
  // `showSecrets` saiu com os campos de credencial (02/set/2026): era o
  // olhinho de mostrar/esconder a chave, e nao ha mais chave nesta tela.

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

  const openNew = () => { setEditing(null); setForm(defaultForm); setListView(false); };
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

  // CAMPOS DE CREDENCIAL REMOVIDOS em 02/set/2026 — decisao da Jessika (SEG 1):
  // "Tirar o campo da tela. Chave secreta de pagamento tem lugar proprio para
  // ficar, e nao e esse."
  //
  // O que havia aqui: Secret Key da Stripe, Access Token do Square, API
  // Password e Signature do PayPal, Transaction Key do Authorize.Net, API Key
  // do Sola e do Paynote — sete gateways, todos gravando em
  // `payment_options.gateway_config`.
  //
  // O PROBLEMA nao era a tela: a RLS de `payment_options` e por LINHA, e a
  // policy "Read visible payment_options" libera SELECT para todo
  // `authenticated`. Qualquer cliente logado baixava a coluna inteira pelo
  // console do navegador. O checkout ja nao lia mais essa coluna (colunas
  // explicitas), entao o vazamento pelo app estava fechado — o que continuava
  // aberto era a leitura direta, e o campo convidava a por segredo novo la.
  //
  // Removido a CLASSE, e nao so a Secret Key da Stripe que motivou a pergunta:
  // os sete tinham exatamente o mesmo destino.
  //
  // PARA VOLTAR, quando houver gateway de verdade: a chave vai para os secrets
  // da edge function (`Deno.env.get`), nunca para uma coluna que o cliente le.
  const renderGatewayFields = () => {
    if (form.gateway_type === "none") return null;
    return (
      <Card className="p-4 space-y-2 mt-4">
        <h4 className="text-base font-semibold text-primary">Gateway credentials</h4>
        <p className="text-sm text-muted-foreground">
          Credentials are <strong>not stored here</strong>. This table is readable by any
          signed-in customer, so API keys and secret tokens are kept in the server
          environment instead. Ask the developer to set them there.
        </p>
      </Card>
    );
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
