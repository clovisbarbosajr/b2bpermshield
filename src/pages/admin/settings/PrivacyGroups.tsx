import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

const PrivacyGroups = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [listView, setListView] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", default_for_new_customers: false });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("privacy_groups").select("*").order("nome");
    setItems(data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", default_for_new_customers: false }); setListView(false); };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({ nome: r.nome, default_for_new_customers: r.default_for_new_customers ?? false });
    setListView(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { nome: form.nome, default_for_new_customers: form.default_for_new_customers, ativo: true };
    if (editing) {
      await supabase.from("privacy_groups").update(payload).eq("id", editing.id);
      toast.success("Updated");
    } else {
      await supabase.from("privacy_groups").insert(payload);
      toast.success("Created");
    }
    setSaving(false); setListView(true); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this privacy group?")) return;
    await supabase.from("privacy_groups").delete().eq("id", id);
    toast.success("Deleted");
    fetchData();
  };

  const BoolIcon = ({ val }: { val: boolean }) => val ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />;

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  if (!listView) {
    return (
      <AdminLayout>
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold">{editing ? "Edit privacy group" : "New privacy group"}</h2>
        </div>
        <div className="max-w-3xl">
          <Card className="p-6 space-y-4">
            <div><Label>Name *</Label><Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.default_for_new_customers} onChange={e => setForm({ ...form, default_for_new_customers: e.target.checked })} />
              Default for new customers
            </label>
          </Card>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setListView(true)}>Back</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Privacy Groups</h2>
          <p className="mt-1 text-sm text-muted-foreground">Control product visibility for customer groups.</p>
        </div>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Group</Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Default for new customers</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                <TableCell><BoolIcon val={r.default_for_new_customers ?? false} /></TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Button onClick={openNew} className="mt-4 gap-1"><Plus className="h-4 w-4" /> Add privacy group</Button>
    </AdminLayout>
  );
};
export default PrivacyGroups;
