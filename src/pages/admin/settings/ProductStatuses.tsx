import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

const ProductStatuses = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", cor: "#6b7280", ordem: 0, ativo: true, permite_visualizar: true, permite_comprar: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("product_statuses").select("*").order("ordem");
    setItems(data ?? []); setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", cor: "#6b7280", ordem: 0, ativo: true, permite_visualizar: true, permite_comprar: true }); setDialogOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({ nome: r.nome, cor: r.cor ?? "#6b7280", ordem: r.ordem ?? 0, ativo: r.ativo, permite_visualizar: r.permite_visualizar ?? true, permite_comprar: r.permite_comprar ?? true });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from("product_statuses").update(form).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Status updated");
    } else {
      const { error } = await supabase.from("product_statuses").insert(form);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Status created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const BoolIcon = ({ val }: { val: boolean }) => val ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />;

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Product statuses</h2>
        <Button onClick={openNew} className="mt-3 gap-1"><Plus className="h-4 w-4" /> New product status</Button>
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div> : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>View order</TableHead>
                <TableHead>Can order?</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                  <TableCell>{r.permite_visualizar ? <Check className="h-4 w-4 text-green-500" /> : ""}</TableCell>
                  <TableCell><BoolIcon val={r.permite_comprar ?? true} /></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                      if (!confirm("Delete this status?")) return;
                      await supabase.from("product_statuses").delete().eq("id", r.id); fetchData();
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Button onClick={openNew} className="mt-4 gap-1"><Plus className="h-4 w-4" /> New product status</Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Product Status</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Color</Label><div className="flex gap-2"><Input type="color" value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} className="w-16 h-10 p-1" /><Input value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} /></div></div>
              <div><Label>Order</Label><Input type="number" value={form.ordem} onChange={e => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permite_visualizar} onChange={e => setForm({ ...form, permite_visualizar: e.target.checked })} /> View order</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permite_comprar} onChange={e => setForm({ ...form, permite_comprar: e.target.checked })} /> Can order</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ProductStatuses;
