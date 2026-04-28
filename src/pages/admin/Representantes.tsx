import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, UserCheck } from "lucide-react";

const AdminRepresentantes = () => {
  const [reps, setReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", email: "", telefone: "", comissao_percentual: 0, ativo: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("representantes").select("*").order("nome");
    setReps(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", email: "", telefone: "", comissao_percentual: 0, ativo: true }); setDialogOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({ nome: r.nome, email: r.email, telefone: r.telefone ?? "", comissao_percentual: r.comissao_percentual, ativo: r.ativo });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, telefone: form.telefone || null, comissao_percentual: Number(form.comissao_percentual) };
    if (editing) {
      const { error } = await supabase.from("representantes").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Sales rep updated");
    } else {
      const { error } = await supabase.from("representantes").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Sales rep created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this sales rep?")) return;
    const { error } = await supabase.from("representantes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Sales rep removed"); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-semibold">Sales Reps</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Rep</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : reps.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <UserCheck className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No sales reps yet</h3>
          <p className="text-muted-foreground mb-4">Add sales representatives and assign them to clients.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add Sales Rep</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Commission</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {reps.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{r.email}</TableCell>
                  <TableCell className="text-muted-foreground">{r.telefone ?? "—"}</TableCell>
                  <TableCell>{Number(r.comissao_percentual).toFixed(1)}%</TableCell>
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
          <DialogHeader><DialogTitle>{editing ? "Edit Sales Rep" : "New Sales Rep"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Phone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
              <div><Label>Commission %</Label><Input type="number" step="0.1" value={form.comissao_percentual} onChange={(e) => setForm({ ...form, comissao_percentual: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminRepresentantes;
