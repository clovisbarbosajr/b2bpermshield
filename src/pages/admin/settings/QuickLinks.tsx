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

const QuickLinks = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ titulo: "", url: "", icone: "", ordem: 0, ativo: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => { const { data } = await supabase.from("quick_links").select("*").order("ordem"); setItems(data ?? []); setLoading(false); };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ titulo: "", url: "", icone: "", ordem: 0, ativo: true }); setDialogOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setForm({ titulo: r.titulo, url: r.url, icone: r.icone ?? "", ordem: r.ordem, ativo: r.ativo }); setDialogOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, icone: form.icone || null };
    if (editing) { await supabase.from("quick_links").update(payload).eq("id", editing.id); toast.success("Updated"); }
    else { await supabase.from("quick_links").insert(payload); toast.success("Created"); }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div><h2 className="font-display text-2xl font-semibold">Quick Links</h2><p className="mt-1 text-sm text-muted-foreground">Add quick access links for customers.</p></div>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> Add Link</Button>
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div> : (
        <Card><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>URL</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{items.map(r => (<TableRow key={r.id}><TableCell className="font-medium">{r.titulo}</TableCell><TableCell className="text-muted-foreground text-xs truncate max-w-[200px]">{r.url}</TableCell><TableCell>{r.ordem}</TableCell><TableCell><Badge variant={r.ativo ? "default" : "secondary"}>{r.ativo ? "Active" : "Inactive"}</Badge></TableCell><TableCell className="text-right space-x-1"><Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={async () => { await supabase.from("quick_links").delete().eq("id", r.id); fetchData(); }}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>))}</TableBody></Table></Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Quick Link</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} /></div>
          <div><Label>URL</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Icon</Label><Input value={form.icone} onChange={e => setForm({ ...form, icone: e.target.value })} /></div><div><Label>Order</Label><Input type="number" value={form.ordem} onChange={e => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} /></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
          <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
        </div></DialogContent></Dialog>
    </AdminLayout>
  );
};
export default QuickLinks;
