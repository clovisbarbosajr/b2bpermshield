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
import { Plus, Pencil, Trash2, DollarSign, Search } from "lucide-react";

type TabelaPreco = {
  id: string; nome: string; descricao: string | null; ativo: boolean; is_default: boolean;
  created_at: string;
};
type Produto = { id: string; nome: string; sku: string; preco: number };
type ItemPreco = { id: string; tabela_preco_id: string; produto_id: string; preco: number };

const AdminTabelasPreco = () => {
  const [tabelas, setTabelas] = useState<TabelaPreco[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TabelaPreco | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", ativo: true, is_default: false });
  const [saving, setSaving] = useState(false);

  // Items management
  const [itemsDialog, setItemsDialog] = useState(false);
  const [selectedTabela, setSelectedTabela] = useState<TabelaPreco | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [itens, setItens] = useState<ItemPreco[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({});

  const fetchData = async () => {
    const { data } = await supabase.from("tabelas_preco").select("*").order("nome");
    setTabelas((data as TabelaPreco[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", descricao: "", ativo: true, is_default: false }); setDialogOpen(true); };
  const openEdit = (t: TabelaPreco) => {
    setEditing(t);
    setForm({ nome: t.nome, descricao: t.descricao ?? "", ativo: t.ativo, is_default: t.is_default });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from("tabelas_preco").update(form).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Price list updated");
    } else {
      const { error } = await supabase.from("tabelas_preco").insert(form);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Price list created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this price list?")) return;
    const { error } = await supabase.from("tabelas_preco").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Price list removed"); fetchData();
  };

  const openItems = async (t: TabelaPreco) => {
    setSelectedTabela(t);
    setItemSearch("");
    const [prodRes, itemRes] = await Promise.all([
      supabase.from("produtos").select("id, nome, sku, preco").order("nome"),
      supabase.from("tabela_preco_itens").select("*").eq("tabela_preco_id", t.id),
    ]);
    setProdutos((prodRes.data as Produto[]) ?? []);
    const items = (itemRes.data as ItemPreco[]) ?? [];
    setItens(items);
    const prices: Record<string, string> = {};
    items.forEach((i) => { prices[i.produto_id] = String(i.preco); });
    setEditingPrices(prices);
    setItemsDialog(true);
  };

  const handleSavePrice = async (produtoId: string) => {
    if (!selectedTabela) return;
    const preco = parseFloat(editingPrices[produtoId] ?? "0");
    if (isNaN(preco) || preco <= 0) {
      // Remove price entry
      await supabase.from("tabela_preco_itens").delete().eq("tabela_preco_id", selectedTabela.id).eq("produto_id", produtoId);
      const newPrices = { ...editingPrices };
      delete newPrices[produtoId];
      setEditingPrices(newPrices);
      setItens(itens.filter((i) => i.produto_id !== produtoId));
      toast.success("Price removed");
      return;
    }
    const { error } = await supabase.from("tabela_preco_itens").upsert(
      { tabela_preco_id: selectedTabela.id, produto_id: produtoId, preco },
      { onConflict: "tabela_preco_id,produto_id" }
    );
    if (error) { toast.error(error.message); return; }
    toast.success("Price saved");
  };

  const filteredProdutos = produtos.filter((p) =>
    p.nome.toLowerCase().includes(itemSearch.toLowerCase()) || p.sku.toLowerCase().includes(itemSearch.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-semibold">Price Lists</h2>
        <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> New Price List</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : tabelas.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No price lists yet</h3>
          <p className="text-muted-foreground mb-4">Create custom pricing for different customer groups.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Price List</Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabelas.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{t.descricao ?? "—"}</TableCell>
                  <TableCell><Badge variant={t.ativo ? "default" : "secondary"}>{t.ativo ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell>{t.is_default && <Badge variant="outline">Default</Badge>}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openItems(t)} title="Manage prices"><DollarSign className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(t.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Price List" : "New Price List"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>Description</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Default</label>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Items/Prices Dialog */}
      <Dialog open={itemsDialog} onOpenChange={setItemsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Prices — {selectedTabela?.nome}</DialogTitle></DialogHeader>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search products..." className="pl-9" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Custom Price</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProdutos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-muted-foreground">$ {Number(p.preco).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="—"
                        className="h-8 w-28"
                        value={editingPrices[p.id] ?? ""}
                        onChange={(e) => setEditingPrices({ ...editingPrices, [p.id]: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => handleSavePrice(p.id)}>Save</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminTabelasPreco;
