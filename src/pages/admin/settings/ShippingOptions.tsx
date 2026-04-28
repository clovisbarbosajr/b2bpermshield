import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";

const RULE_TYPES = ["Per Order flat rate", "Per Order Net Value", "Per Item flat rate", "Per Item flat value"];

const US_STATES = [
  "All", "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

type Condition = {
  country: string;
  province: string;
  percentage_upcharge: number;
  from_net_value: number;
  price: number;
};

const defaultCondition = (): Condition => ({
  country: "United States",
  province: "All",
  percentage_upcharge: 0,
  from_net_value: 0,
  price: 0,
});

const ShippingOptions = () => {
  const [items, setItems] = useState<any[]>([]);
  const [taxClasses, setTaxClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [listView, setListView] = useState(true);
  const [saving, setSaving] = useState(false);

  const defaultForm = {
    nome: "",
    tax_class_id: "",
    tipo_regra: "Per Order Net Value",
    show_to_customers: true,
    auto_apply: false,
    privado: false,
    tracking_url: "",
    padrao: false,
    ativo: true,
    ordem: 0,
  };
  const [form, setForm] = useState(defaultForm);
  const [conditions, setConditions] = useState<Condition[]>([defaultCondition()]);

  const fetchData = async () => {
    const [s, t] = await Promise.all([
      supabase.from("shipping_options").select("*, tax_classes(nome)").order("ordem"),
      supabase.from("tax_classes").select("*").order("nome"),
    ]);
    setItems(s.data ?? []);
    setTaxClasses(t.data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ ...defaultForm, tax_class_id: taxClasses[0]?.id ?? "" });
    setConditions([defaultCondition()]);
    setListView(false);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      nome: r.nome,
      tax_class_id: r.tax_class_id ?? "",
      tipo_regra: r.tipo_regra ?? "Per Order Net Value",
      show_to_customers: r.show_to_customers ?? true,
      auto_apply: r.auto_apply ?? false,
      privado: r.privado ?? false,
      tracking_url: r.tracking_url ?? "",
      padrao: r.padrao ?? false,
      ativo: r.ativo ?? true,
      ordem: r.ordem ?? 0,
    });
    const conds = Array.isArray(r.condicoes) && r.condicoes.length > 0
      ? r.condicoes
      : [defaultCondition()];
    setConditions(conds);
    setListView(false);
  };

  const setDefault = async (r: any) => {
    await supabase.from("shipping_options").update({ padrao: false } as any).neq("id", r.id);
    await supabase.from("shipping_options").update({ padrao: true } as any).eq("id", r.id);
    fetchData();
    toast.success(`"${r.nome}" set as default`);
  };

  const updateCondition = (idx: number, field: keyof Condition, value: any) => {
    setConditions(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const addCondition = () => setConditions(prev => [...prev, defaultCondition()]);
  const removeCondition = (idx: number) => setConditions(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const payload: any = {
      ...form,
      tax_class_id: form.tax_class_id || null,
      tracking_url: form.tracking_url || null,
      condicoes: conditions,
    };
    if (editing) {
      const { error } = await supabase.from("shipping_options").update(payload).eq("id", editing.id);
      if (error) { toast.error("Error: " + error.message); setSaving(false); return; }
      toast.success("Updated");
    } else {
      const { error } = await supabase.from("shipping_options").insert(payload);
      if (error) { toast.error("Error: " + error.message); setSaving(false); return; }
      toast.success("Created");
    }
    setSaving(false);
    setListView(true);
    fetchData();
  };

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </AdminLayout>
  );

  // ── Edit form ──
  if (!listView) {
    return (
      <AdminLayout>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">
            {editing ? "Editing shipping option" : "New shipping option"}
          </h2>
          {editing && (
            <Button variant="outline" size="sm" onClick={() => setDefault(editing)}>
              Set default
            </Button>
          )}
        </div>

        <div className="max-w-4xl space-y-5">
          {/* Tabs look */}
          <div className="flex gap-1 border-b pb-2">
            <span className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-t cursor-default">Shipping options</span>
            <span className="px-3 py-1.5 text-sm font-medium text-muted-foreground cursor-not-allowed">Extra fields</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Sales Tax</Label>
              <Select value={form.tax_class_id || "none"} onValueChange={v => setForm({ ...form, tax_class_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Non Taxable</SelectItem>
                  {taxClasses.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Rule Type</Label>
            <Select value={form.tipo_regra} onValueChange={v => setForm({ ...form, tipo_regra: v })}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{RULE_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.show_to_customers} onChange={e => setForm({ ...form, show_to_customers: e.target.checked })} />
              Show as choice to customers
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.auto_apply} onChange={e => setForm({ ...form, auto_apply: e.target.checked })} />
              Auto apply
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.privado} onChange={e => setForm({ ...form, privado: e.target.checked })} />
              Private
            </label>
          </div>

          <div>
            <Label>Tracking URL template</Label>
            <Input
              value={form.tracking_url}
              onChange={e => setForm({ ...form, tracking_url: e.target.value })}
              placeholder="https://carrier.com/track?number={{tracking_number}}"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use <code>{"{{tracking_number}}"}</code> as placeholder for the tracking number
            </p>
          </div>

          {/* Pricing conditions table */}
          <div>
            <h3 className="font-semibold text-sm mb-3">Shipping pricing rules</h3>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Country</th>
                    <th className="px-3 py-2 text-left font-medium">Province / State</th>
                    <th className="px-3 py-2 text-left font-medium">% Percentage Upcharge</th>
                    <th className="px-3 py-2 text-left font-medium">From order net value</th>
                    <th className="px-3 py-2 text-left font-medium">Price</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((c, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Select value={c.country} onValueChange={v => updateCondition(idx, "country", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="United States">United States</SelectItem>
                            <SelectItem value="Canada">Canada</SelectItem>
                            <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={c.province} onValueChange={v => updateCondition(idx, "province", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-sm w-24"
                          value={c.percentage_upcharge}
                          onChange={e => updateCondition(idx, "percentage_upcharge", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-sm w-28"
                          value={c.from_net_value}
                          onChange={e => updateCondition(idx, "from_net_value", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-sm w-24"
                          value={c.price}
                          onChange={e => updateCondition(idx, "price", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {conditions.length > 1 && (
                          <button onClick={() => removeCondition(idx)} className="text-destructive hover:text-destructive/80">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={addCondition}>
              <Plus className="h-3 w-3" /> Add row
            </Button>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setListView(true)}>Back</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ── List view ──
  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Shipping options</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New shipping option</Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Vat Class</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Rule Type</TableHead>
              <TableHead>Private</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(r => (
              <TableRow key={r.id}>
                <TableCell>
                  <button
                    className="font-medium text-primary hover:underline text-left"
                    onClick={() => openEdit(r)}
                  >
                    {r.nome}
                  </button>
                </TableCell>
                <TableCell>{(r as any).tax_classes?.nome ?? "Non Taxable"}</TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDefault(r)}
                  >
                    {r.padrao ? "Default ✓" : "Set default"}
                  </Button>
                </TableCell>
                <TableCell>{r.tipo_regra ?? "Per Order Net Value"}</TableCell>
                <TableCell>
                  {r.privado
                    ? <X className="h-4 w-4 text-destructive" />
                    : <X className="h-4 w-4 text-destructive" />}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={async () => {
                      if (!confirm("Delete this shipping option?")) return;
                      await supabase.from("shipping_options").delete().eq("id", r.id);
                      fetchData();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Button onClick={openNew} className="mt-4 gap-1"><Plus className="h-4 w-4" /> New shipping option</Button>
    </AdminLayout>
  );
};

export default ShippingOptions;
