import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

const Coupons = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ codigo: "", tipo: "percentual", valor: 0, uso_maximo: null as number | null, data_inicio: "", data_fim: "", ativo: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => { const { data } = await supabase.from("coupons").select("*").order("created_at", { ascending: false }); setItems(data ?? []); setLoading(false); };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ codigo: "", tipo: "percentual", valor: 0, uso_maximo: null, data_inicio: "", data_fim: "", ativo: true }); setDialogOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setForm({ codigo: r.codigo, tipo: r.tipo, valor: Number(r.valor), uso_maximo: r.uso_maximo, data_inicio: r.data_inicio?.split("T")[0] ?? "", data_fim: r.data_fim?.split("T")[0] ?? "", ativo: r.ativo }); setDialogOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, valor: Number(form.valor), uso_maximo: form.uso_maximo || null, data_inicio: form.data_inicio || null, data_fim: form.data_fim || null };
    if (editing) { await supabase.from("coupons").update(payload).eq("id", editing.id); toast.success("Updated"); }
    else { await supabase.from("coupons").insert(payload); toast.success("Created"); }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div><h2 className="font-display text-2xl font-semibold">Coupons</h2><p className="mt-1 text-sm text-muted-foreground">Create discount coupons for your customers.</p></div>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Coupon</Button>
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div> : (
        <Card><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Usage</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{items.map(r => (<TableRow key={r.id}><TableCell className="font-mono font-medium">{r.codigo}</TableCell><TableCell>{r.tipo === "percentual" ? "%" : "$"}</TableCell><TableCell>{r.tipo === "percentual" ? `${r.valor}%` : `$${Number(r.valor).toFixed(2)}`}</TableCell><TableCell>{r.uso_atual ?? 0}{r.uso_maximo ? ` / ${r.uso_maximo}` : ""}</TableCell><TableCell><Badge variant={r.ativo ? "default" : "secondary"}>{r.ativo ? "Active" : "Inactive"}</Badge></TableCell><TableCell className="text-right space-x-1"><Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={async () => { await supabase.from("coupons").delete().eq("id", r.id); fetchData(); }}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>))}</TableBody></Table></Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit Coupon" : "New Coupon"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Code</Label><Input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Type</Label><Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentual">Percentage</SelectItem><SelectItem value="fixo">Fixed</SelectItem></SelectContent></Select></div><div><Label>Value</Label><Input type="number" step="0.01" value={form.valor} onChange={e => setForm({ ...form, valor: parseFloat(e.target.value) || 0 })} /></div></div>
          <div><Label>Max Uses</Label><Input type="number" value={form.uso_maximo ?? ""} onChange={e => setForm({ ...form, uso_maximo: parseInt(e.target.value) || null })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Start</Label><Input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} /></div><div><Label>End</Label><Input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} /></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
          <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
        </div></DialogContent></Dialog>
    </AdminLayout>
  );
};
export default Coupons;
