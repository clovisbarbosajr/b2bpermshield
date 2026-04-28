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
import { Plus, Pencil, Trash2, Image as ImageIcon, Upload } from "lucide-react";

const AdminBanners = () => {
  const [banners, setBanners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ titulo: "", imagem_url: "", link_url: "", ativo: true, ordem: 0 });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("banners").select("*").order("ordem");
    setBanners(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ titulo: "", imagem_url: "", link_url: "", ativo: true, ordem: 0 }); setDialogOpen(true); };
  const openEdit = (b: any) => {
    setEditing(b);
    setForm({ titulo: b.titulo, imagem_url: b.imagem_url ?? "", link_url: b.link_url ?? "", ativo: b.ativo, ordem: b.ordem });
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `banners/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error("Upload error: " + error.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    setForm({ ...form, imagem_url: urlData.publicUrl });
    setUploading(false);
    toast.success("Image uploaded");
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, imagem_url: form.imagem_url || null, link_url: form.link_url || null };
    if (editing) {
      const { error } = await supabase.from("banners").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Banner updated");
    } else {
      const { error } = await supabase.from("banners").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Banner created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this banner?")) return;
    const { error } = await supabase.from("banners").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Banner removed"); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Banners</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Banner</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : banners.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No banners yet</h3>
          <p className="text-muted-foreground mb-4">Create banners for promotions and announcements on the customer portal.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Banner</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Image</TableHead><TableHead>Title</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {banners.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    {b.imagem_url ? <img src={b.imagem_url} alt={b.titulo} className="h-10 w-20 rounded object-cover" /> : <div className="flex h-10 w-20 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>}
                  </TableCell>
                  <TableCell className="font-medium">{b.titulo}</TableCell>
                  <TableCell>{b.ordem}</TableCell>
                  <TableCell><Badge variant={b.ativo ? "default" : "secondary"}>{b.ativo ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(b.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Banner" : "New Banner"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></div>
            <div>
              <Label>Banner Image</Label>
              <div className="mt-1 flex items-center gap-3">
                {form.imagem_url ? <img src={form.imagem_url} alt="Preview" className="h-16 w-32 rounded object-cover border" /> : <div className="flex h-16 w-32 items-center justify-center rounded border bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>}
                <label className="cursor-pointer flex-1">
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                    <Upload className="h-4 w-4" />{uploading ? "Uploading..." : "Select image"}
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                </label>
              </div>
            </div>
            <div><Label>Link URL (optional)</Label><Input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Display Order</Label><Input type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminBanners;
