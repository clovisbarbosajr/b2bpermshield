import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Check, Eye, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

type Categoria = {
  id: string;
  nome: string;
  descricao: string | null;
  parent_id: string | null;
  ativo: boolean;
  ordem: number;
  desconto: number;
  imagem_url: string | null;
};

const AdminCategorias = () => {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Categoria | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", parent_id: "", ativo: true, ordem: 0, desconto: 0 });
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const fetchData = async () => {
    const { data } = await supabase
      .from("categorias")
      .select("*")
      .eq("ativo", true)
      .order("ordem")
      .order("nome");
    setCategorias((data as Categoria[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ nome: "", descricao: "", parent_id: "", ativo: true, ordem: 0, desconto: 0 });
    setDialogOpen(true);
  };

  const openEdit = (c: Categoria) => {
    setEditing(c);
    setForm({
      nome: c.nome,
      descricao: c.descricao ?? "",
      parent_id: c.parent_id ?? "",
      ativo: c.ativo,
      ordem: c.ordem ?? 0,
      desconto: c.desconto ?? 0,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const payload = {
      nome: form.nome,
      descricao: form.descricao || null,
      parent_id: form.parent_id || null,
      ativo: form.ativo,
      ordem: form.ordem,
      desconto: form.desconto,
    };
    if (editing) {
      const { error } = await supabase.from("categorias").update(payload as any).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Category updated");
    } else {
      const { error } = await supabase.from("categorias").insert(payload as any);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Category created");
    }
    setSaving(false);
    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    const { error } = await supabase.from("categorias").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Category removed");
    fetchData();
  };

  const moveCategory = async (cat: Categoria, direction: "up" | "down") => {
    const siblings = categorias.filter(c => c.parent_id === cat.parent_id);
    const idx = siblings.findIndex(c => c.id === cat.id);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= siblings.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapCat = siblings[swapIdx];

    await Promise.all([
      supabase.from("categorias").update({ ordem: swapCat.ordem } as any).eq("id", cat.id),
      supabase.from("categorias").update({ ordem: cat.ordem } as any).eq("id", swapCat.id),
    ]);
    fetchData();
  };

  const sortAlphabetically = async () => {
    const sorted = [...categorias].sort((a, b) => a.nome.localeCompare(b.nome));
    for (let i = 0; i < sorted.length; i++) {
      await supabase.from("categorias").update({ ordem: i } as any).eq("id", sorted[i].id);
    }
    toast.success("Categories sorted alphabetically");
    fetchData();
  };

  // Build flat ordered list with hierarchy
  const rootCats = categorias.filter(c => !c.parent_id).sort((a, b) => a.ordem - b.ordem);
  const childrenOf = (parentId: string) =>
    categorias.filter(c => c.parent_id === parentId).sort((a, b) => a.ordem - b.ordem);

  const parentName = (parentId: string | null) => {
    if (!parentId) return "";
    return categorias.find(c => c.id === parentId)?.nome ?? "";
  };

  // Count products per category
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const fetchCounts = async () => {
      const { data } = await supabase.from("produtos").select("categoria_id").eq("ativo", true);
      if (data) {
        const counts: Record<string, number> = {};
        data.forEach((p: any) => { if (p.categoria_id) counts[p.categoria_id] = (counts[p.categoria_id] || 0) + 1; });
        setProductCounts(counts);
      }
    };
    fetchCounts();
  }, []);

  const buildFlatList = (cats: Categoria[], level: number = 0): { cat: Categoria; level: number }[] =>
    cats.flatMap(c => [
      { cat: c, level },
      ...buildFlatList(childrenOf(c.id), level + 1),
    ]);

  const flatList = buildFlatList(rootCats);

  // Determine siblings for move button visibility
  const getSiblings = (cat: Categoria) => categorias.filter(c => c.parent_id === cat.parent_id);
  const getSiblingIndex = (cat: Categoria) => {
    const siblings = getSiblings(cat);
    return siblings.findIndex(c => c.id === cat.id);
  };

  return (
    <AdminLayout>
      <div className="mb-4">
        <h2 className="font-display text-2xl font-semibold">Product Categories</h2>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <Button onClick={openNew} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="h-4 w-4" /> New category
        </Button>
        <Button variant="outline" onClick={sortAlphabetically} className="gap-1 text-sm border-cyan-600 text-cyan-400 hover:bg-cyan-600/10">
          Sort categories alphabetically
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-primary font-semibold">Name</TableHead>
                <TableHead className="text-primary font-semibold">Parent category</TableHead>
                <TableHead className="text-primary font-semibold w-28 text-center">Move</TableHead>
                <TableHead className="text-primary font-semibold w-20 text-center">Active</TableHead>
                <TableHead className="text-primary font-semibold w-24 text-center">Discount</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatList.map(({ cat, level }) => {
                const siblings = getSiblings(cat);
                const idx = getSiblingIndex(cat);
                const canMoveUp = idx > 0;
                const canMoveDown = idx < siblings.length - 1;

                return (
                  <TableRow key={cat.id} className="border-b border-border/50">
                    <TableCell>
                      <span style={{ paddingLeft: level * 24 }} className="flex items-center gap-2">
                        <span className="font-medium text-primary">{cat.nome}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                          {productCounts[cat.id] || 0}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {parentName(cat.parent_id)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-1 justify-center">
                        {canMoveUp && (
                          <Button
                            variant="default"
                            size="icon"
                            className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                            onClick={() => moveCategory(cat, "up")}
                            title="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canMoveDown && (
                          <Button
                            variant="default"
                            size="icon"
                            className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                            onClick={() => moveCategory(cat, "down")}
                            title="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {cat.ativo && <Check className="h-4 w-4 text-green-500 mx-auto" />}
                    </TableCell>
                    <TableCell className="text-center">
                      {cat.desconto ? `${cat.desconto}%` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                          onClick={() => openEdit(cat)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                          onClick={() => navigate(`/portal/catalogo?category=${cat.id}`)}
                          title="View as"
                        >
                          <Monitor className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-destructive hover:bg-destructive/90"
                          onClick={() => handleDelete(cat.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {flatList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    No categories yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label>Parent Category</Label>
              <Select value={form.parent_id} onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None (root)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (root)</SelectItem>
                  {categorias.filter((c) => c.id !== editing?.id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.parent_id ? `↳ ${c.nome}` : c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Order</Label>
                <Input type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Discount (%)</Label>
                <Input type="number" value={form.desconto} onChange={(e) => setForm({ ...form, desconto: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Active
              </label>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminCategorias;
