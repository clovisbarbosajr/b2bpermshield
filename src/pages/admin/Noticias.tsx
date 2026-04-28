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
import { Plus, Pencil, Trash2, Newspaper } from "lucide-react";

const AdminNoticias = () => {
  const [noticias, setNoticias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ titulo: "", conteudo: "", imagem_url: "", ativo: true, destaque: false });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("noticias").select("*").order("publicado_em", { ascending: false });
    setNoticias(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ titulo: "", conteudo: "", imagem_url: "", ativo: true, destaque: false }); setDialogOpen(true); };
  const openEdit = (n: any) => {
    setEditing(n);
    setForm({ titulo: n.titulo, conteudo: n.conteudo ?? "", imagem_url: n.imagem_url ?? "", ativo: n.ativo, destaque: n.destaque });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, imagem_url: form.imagem_url || null, conteudo: form.conteudo || null };
    if (editing) {
      const { error } = await supabase.from("noticias").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("News updated");
    } else {
      const { error } = await supabase.from("noticias").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("News created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this news item?")) return;
    const { error } = await supabase.from("noticias").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("News removed"); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-semibold">News</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Post</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : noticias.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Newspaper className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No news yet</h3>
          <p className="text-muted-foreground mb-4">Create news and announcements for your clients.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Post</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Title</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Featured</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {noticias.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.titulo}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(n.publicado_em).toLocaleDateString("en-US")}</TableCell>
                  <TableCell><Badge variant={n.ativo ? "default" : "secondary"}>{n.ativo ? "Active" : "Draft"}</Badge></TableCell>
                  <TableCell>{n.destaque && <Badge variant="outline">Featured</Badge>}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(n)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(n.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit News" : "New News Post"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></div>
            <div><Label>Content</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={5} value={form.conteudo} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} /></div>
            <div><Label>Image URL</Label><Input value={form.imagem_url} onChange={(e) => setForm({ ...form, imagem_url: e.target.value })} placeholder="https://..." /></div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.destaque} onChange={(e) => setForm({ ...form, destaque: e.target.checked })} /> Featured</label>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminNoticias;
