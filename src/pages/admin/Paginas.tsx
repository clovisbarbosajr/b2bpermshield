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
import { Plus, Pencil, Trash2, FileText } from "lucide-react";

const AdminPaginas = () => {
  const [paginas, setPaginas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ titulo: "", slug: "", conteudo: "", ativo: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("paginas").select("*").order("titulo");
    setPaginas(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ titulo: "", slug: "", conteudo: "", ativo: true }); setDialogOpen(true); };
  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ titulo: p.titulo, slug: p.slug, conteudo: p.conteudo ?? "", ativo: p.ativo });
    setDialogOpen(true);
  };

  const generateSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, conteudo: form.conteudo || null };
    if (editing) {
      const { error } = await supabase.from("paginas").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Page updated");
    } else {
      const { error } = await supabase.from("paginas").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Page created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this page?")) return;
    const { error } = await supabase.from("paginas").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Page removed"); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-semibold">Pages</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Page</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : paginas.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No pages yet</h3>
          <p className="text-muted-foreground mb-4">Create static pages like About, FAQ, or Shipping Info.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Page</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Title</TableHead><TableHead>Slug</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {paginas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.titulo}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">/{p.slug}</TableCell>
                  <TableCell><Badge variant={p.ativo ? "default" : "secondary"}>{p.ativo ? "Active" : "Draft"}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Page" : "New Page"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={form.titulo} onChange={(e) => { setForm({ ...form, titulo: e.target.value, ...(editing ? {} : { slug: generateSlug(e.target.value) }) }); }} /></div>
            <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
            <div><Label>Content</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={8} value={form.conteudo} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminPaginas;
