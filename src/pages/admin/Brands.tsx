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
import { Plus, Pencil, Trash2, Tag } from "lucide-react";

const AdminBrands = () => {
  const [brands, setBrands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", logo_url: "", ativo: true });
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = async () => {
    const { data, error } = await supabase.from("brands").select("*").order("nome");
    setLoading(false);
    // ESTADO DE ERRO, e nao so o toast.
    //
    // O comentario que estava aqui dizia que isto evitava o admin "recriar marcas
    // que ja existem" — mas so o toast tinha sido aplicado. Sem o estado, a tela
    // caia em `brands.length === 0` e mostrava "No brands yet" + Create Brand: o
    // toast some em 6s e a afirmacao falsa fica na tela para sempre.
    //
    // `brands.nome` nao tem UNIQUE, e o `sync_brands` do B2BWave indexa por
    // `nome.toLowerCase()` — marca duplicada faz uma das duas linhas parar de
    // sincronizar de vez. As outras quatro telas desta pasta ja tinham o ramo.
    if (error) {
      setLoadError(error.message);
      toast.error("Could not load brands: " + error.message);
      return;
    }
    setLoadError(null);
    setBrands(data ?? []);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", descricao: "", logo_url: "", ativo: true }); setDialogOpen(true); };
  const openEdit = (b: any) => {
    setEditing(b);
    setForm({ nome: b.nome, descricao: b.descricao ?? "", logo_url: b.logo_url ?? "", ativo: b.ativo });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, descricao: form.descricao || null, logo_url: form.logo_url || null };
    if (editing) {
      // `.select()` DE CONFIRMACAO: sem ele, "updated" e um chute.
      //
      // A RLS destas tabelas e `FOR ALL USING (has_role(auth.uid(),'admin'))`.
      // UPDATE que nao casa NENHUMA linha nao e erro no Postgres — volta 204 com
      // `error: null`, e a tela dizia "updated" em cima de nada.
      //
      // Nao e janela de milissegundos: o `AuthContext` cacheia o `role` e nunca
      // rele `user_roles` na sessao, entao um admin rebaixado para manager
      // continua com a tela aberta e funcional ate fechar a aba, com o banco
      // recusando toda escrita e a tela confirmando cada uma. `Representantes.tsx`
      // ja tinha essa guarda; estas quatro ficaram de fora.
      const { data: salvo, error } = await supabase.from("brands")
        .update(payload).eq("id", editing.id).select("id").maybeSingle();
      if (error) { toast.error(error.message); setSaving(false); return; }
      if (!salvo) {
        toast.error("Nothing was saved — the record no longer exists, or you no longer have permission. Reload the page.");
        setSaving(false); return;
      }
      toast.success("Brand updated");
    } else {
      const { error } = await supabase.from("brands").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Brand created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this brand?")) return;
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Brand removed"); fetchData();
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Brands</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Brand</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : loadError ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <h3 className="text-lg font-semibold">Could not load brands</h3>
          <p className="text-muted-foreground mb-4">{loadError}</p>
          <Button variant="outline" onClick={() => { setLoading(true); fetchData(); }}>Try again</Button>
        </Card>
      ) : brands.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Tag className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No brands yet</h3>
          <p className="text-muted-foreground mb-4">Create and manage product brands.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Brand</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{b.descricao ?? "—"}</TableCell>
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
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Brand" : "New Brand"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>Description</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <div><Label>Logo URL</Label><Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://..." /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminBrands;
