import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

const MeasurementUnit = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", abreviacao: "", ativo: true });
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    const { data } = await supabase.from("measurement_units").select("*").order("nome");
    setItems(data ?? []); setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", abreviacao: "", ativo: true }); setDialogOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setForm({ nome: r.nome, abreviacao: r.abreviacao, ativo: r.ativo }); setDialogOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from("measurement_units").update(form).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Updated");
    } else {
      const { error } = await supabase.from("measurement_units").insert(form);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Created");
    }
    setSaving(false); setDialogOpen(false); fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete?")) return;
    await supabase.from("measurement_units").delete().eq("id", id);
    toast.success("Deleted"); fetch();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Measurement Units</h2>
          <p className="mt-1 text-sm text-muted-foreground">Define measurement units for your products (kg, lb, m², sq ft, etc.).</p>
        </div>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Unit</Button>
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Abbreviation</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {items.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.nome}</TableCell>
                  <TableCell className="font-mono">{r.abreviacao}</TableCell>
                  <TableCell><Badge variant={r.ativo ? "default" : "secondary"}>{r.ativo ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Unit" : "New Unit"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Kilogram" /></div>
            <div><Label>Abbreviation</Label><Input value={form.abreviacao} onChange={e => setForm({ ...form, abreviacao: e.target.value })} placeholder="kg" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default MeasurementUnit;
