import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

// Matches exactly what B2BWave shows:
const fieldTypes = [
  { value: "text",         label: "Small Text" },
  { value: "textarea",     label: "Text Area" },
  { value: "date",         label: "Date" },
  { value: "select",       label: "Select" },
  { value: "file",         label: "File" },
  { value: "multi_select", label: "Multi-Select" },
];

const viewLocations = [
  { value: "order_checkout",      label: "Order Checkout" },
  { value: "order_products_edit", label: "Order Products Edit" },
  { value: "order_edit_admin",    label: "Order Edit (admin)" },
  { value: "customer_registration", label: "Customer Registration" },
  { value: "customer_edit",       label: "Customer Edit" },
  { value: "product",             label: "Product" },
  { value: "category",            label: "Category" },
  { value: "sales_rep",           label: "Sales Rep" },
  { value: "admin_user",          label: "Admin User" },
  { value: "brand",               label: "Brand" },
  { value: "shipping_option",     label: "Shipping Option" },
];

const viewLabel = (v: string) => viewLocations.find(x => x.value === v)?.label ?? v;
const typeLabel = (t: string) => fieldTypes.find(x => x.value === t)?.label ?? t;

const ExtraFields = () => {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [listView, setListView] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving]   = useState(false);

  const emptyForm = {
    nome: "",
    tipo: "text",
    view_location: "order_checkout",
    obrigatorio: false,
    show_to_customers: false,
    ordem: "",
    opcoes: "",          // one option per line for select/multi_select
  };
  const [form, setForm] = useState(emptyForm);

  const fetchData = async () => {
    const { data } = await supabase.from("extra_fields").select("*").order("ordem");
    setItems(data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setListView(false);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      nome:             r.nome ?? "",
      tipo:             r.tipo ?? "text",
      view_location:    r.view_location ?? r.entidade ?? "order_checkout",
      obrigatorio:      r.obrigatorio ?? false,
      show_to_customers: r.show_to_customers ?? false,
      ordem:            r.ordem != null ? String(r.ordem) : "",
      opcoes:           Array.isArray(r.opcoes)
                          ? r.opcoes.join("\n")
                          : (r.opcoes ?? ""),
    });
    setListView(false);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Label is required"); return; }
    if (!form.view_location) { toast.error("View is required"); return; }
    setSaving(true);

    const opcoes = (form.tipo === "select" || form.tipo === "multi_select")
      ? form.opcoes.split("\n").map((s: string) => s.trim()).filter(Boolean)
      : [];

    // derive the legacy 'entidade' field for backwards compat
    const entidade =
      ["product", "category", "brand"].includes(form.view_location) ? "product"
      : form.view_location.includes("customer") ? "customer"
      : form.view_location === "shipping_option" ? "shipping"
      : "order";

    const payload: any = {
      nome:             form.nome.trim(),
      tipo:             form.tipo,
      view_location:    form.view_location,
      entidade,
      obrigatorio:      form.obrigatorio,
      show_to_customers: form.show_to_customers,
      ordem:            form.ordem !== "" ? parseInt(form.ordem) || 0 : 0,
      opcoes,
      ativo:            true,
    };

    let error: any;
    if (editing) {
      ({ error } = await supabase.from("extra_fields").update(payload).eq("id", editing.id));
      if (!error) toast.success("Updated");
    } else {
      ({ error } = await supabase.from("extra_fields").insert(payload));
      if (!error) toast.success("Created");
    }
    if (error) toast.error(error.message);

    setSaving(false);
    if (!error) { setListView(true); fetchData(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this extra field?")) return;
    const { error } = await supabase.from("extra_fields").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); fetchData(); }
  };

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </AdminLayout>
  );

  // ── Edit / New form ────────────────────────────────────────────────────────
  if (!listView) {
    return (
      <AdminLayout>
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold">
            {editing ? "Edit extra field" : "New extra field"}
          </h2>
        </div>

        <div className="max-w-4xl space-y-5">
          {/* Label */}
          <div>
            <Label className="text-primary text-sm">Label</Label>
            <Input
              className="mt-1"
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          {/* View */}
          <div>
            <Label className="text-primary text-sm">
              View <span className="text-destructive">*</span>
            </Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.view_location}
              onChange={e => setForm({ ...form, view_location: e.target.value })}
            >
              {viewLocations.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Field type */}
          <div>
            <Label className="text-primary text-sm">
              Field type <span className="text-destructive">*</span>
            </Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.tipo}
              onChange={e => setForm({ ...form, tipo: e.target.value })}
            >
              {fieldTypes.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Options — only for select / multi_select */}
          {(form.tipo === "select" || form.tipo === "multi_select") && (
            <div>
              <Label className="text-primary text-sm">Options</Label>
              <p className="text-xs text-muted-foreground mb-1">One option per line</p>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-ring"
                value={form.opcoes}
                onChange={e => setForm({ ...form, opcoes: e.target.value })}
                placeholder={"No\nYes"}
              />
            </div>
          )}

          {/* Required */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.obrigatorio}
              onChange={e => setForm({ ...form, obrigatorio: e.target.checked })}
              className="rounded"
            />
            <span className="text-primary">Required</span>
          </label>

          {/* Expose in storefront */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.show_to_customers}
              onChange={e => setForm({ ...form, show_to_customers: e.target.checked })}
              className="rounded"
            />
            <span className="text-primary">Expose in storefront as a JavaScript variable</span>
          </label>

          {/* View Order */}
          <div>
            <Label className="text-primary text-sm">View Order</Label>
            <Input
              className="mt-1"
              type="number"
              value={form.ordem}
              onChange={e => setForm({ ...form, ordem: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mt-6">
          <Button
            onClick={() => setListView(true)}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            Back
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </AdminLayout>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Extra fields</h2>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Label</TableHead>
              <TableHead>View</TableHead>
              <TableHead>Field type</TableHead>
              <TableHead>View Order</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No extra fields yet.
                </TableCell>
              </TableRow>
            ) : items.map(r => (
              <TableRow key={r.id}>
                <TableCell>
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </TableCell>
                <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                <TableCell className="text-muted-foreground">{viewLabel(r.view_location ?? r.entidade)}</TableCell>
                <TableCell className="text-muted-foreground">{typeLabel(r.tipo)}</TableCell>
                <TableCell className="text-muted-foreground">{r.ordem ?? 0}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="default"
                      size="icon"
                      className="h-8 w-8 bg-cyan-600 hover:bg-cyan-700"
                      onClick={() => openEdit(r)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Button
        onClick={openNew}
        className="mt-4 gap-1 bg-emerald-600 hover:bg-emerald-700"
      >
        <Plus className="h-4 w-4" /> New record
      </Button>
    </AdminLayout>
  );
};

export default ExtraFields;
