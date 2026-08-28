import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, DollarSign, Search, Copy } from "lucide-react";

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
  // Snapshot do que está SALVO — o Save único só habilita quando algo divergir.
  const [origPrices, setOrigPrices] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);

  const fetchData = async () => {
    const { data, error } = await supabase.from("tabelas_preco").select("*").order("nome");
    setLoading(false);
    // Sem isto, a falha de leitura virava a tela vazia "No price lists yet" —
    // convite a recriar reguas que ja existem.
    if (error) { toast.error("Could not load price lists: " + error.message); return; }
    setTabelas((data as TabelaPreco[]) ?? []);
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

  // Duplica a price list: cria "<nome> (copy)" (nunca default) e copia TODOS os
  // preços custom. Se a cópia dos preços falhar, avisa — a lista fica criada e
  // é só apagar/repetir (nada da lista original é tocado).
  const handleDuplicate = async (t: TabelaPreco) => {
    const { data: nova, error } = await supabase.from("tabelas_preco")
      .insert({ nome: `${t.nome} (copy)`, descricao: t.descricao, ativo: t.ativo, is_default: false })
      .select("id").single();
    if (error || !nova) { toast.error(error?.message ?? "Error duplicating"); return; }
    // PAGINADO: `tabela_preco_itens` cresce com produtos x reguas (1974 linhas hoje)
    // e o PostgREST corta em 1000 SEM erro. Uma leitura so copiava as primeiras 1000
    // e a tela ainda dizia "1000 price(s) copied" — a copia nascia incompleta, e o
    // que faltasse cairia no preco base, mais caro, sem ninguem notar.
    let items: { produto_id: string; preco: number }[];
    try {
      items = await fetchAllRows<{ produto_id: string; preco: number }>((from, to) =>
        supabase.from("tabela_preco_itens").select("produto_id, preco")
          .eq("tabela_preco_id", t.id).order("id", { ascending: true }).range(from, to));
    } catch (e: any) {
      toast.error("List created, but failed to read prices: " + (e?.message ?? String(e)));
      fetchData();
      return;
    }
    if (items.length > 0) {
      // SEM `origem` DE PROPOSITO — a linha nasce no default `desconhecido`.
      //
      // Duplicar copia TODAS as linhas de uma vez; ninguem "mexeu" em nenhuma.
      // Carimbar `local` seria marcar como humano o que e copia mecanica de preco
      // do B2BWave, e criaria uma regua inteira imune a limpeza automatica.
      // Carimbar `b2bwave` seria pior: a copia vai para uma regua "<nome> (copy)",
      // que a origem NAO conhece — o sync casa regua por nome, e esse nome nunca
      // casa. Seria afirmar que a origem escreveu uma linha que ela nunca viu.
      //
      // CUSTO ACEITO: essas linhas ficam em `desconhecido` PARA SEMPRE e
      // reaparecem em toda consulta de candidatos. E residuo visivel, e preferi
      // isso a imunidade invisivel.
      const rows = items.map((i) => ({ tabela_preco_id: nova.id, produto_id: i.produto_id, preco: i.preco }));
      const { error: insErr } = await supabase.from("tabela_preco_itens").insert(rows);
      if (insErr) { toast.error("List created, but prices failed to copy: " + insErr.message); fetchData(); return; }
    }
    toast.success(`Price list duplicated (${items.length} price(s) copied)`);
    fetchData();
  };

  const openItems = async (t: TabelaPreco) => {
    // As DUAS leituras paginadas e com erro tratado. `produtos` cresce sem limite
    // com o catalogo e `tabela_preco_itens` com produtos x reguas: cortadas em 1000
    // (silenciosamente), o produto que sobrasse ficava sem linha na tela — sem jeito
    // de dar preco custom — e o preco custom que sobrasse aparecia como "sem preco".
    // Erro na leitura NAO abre o popup: o snapshot `origPrices` vazio e o que
    // sustenta o Save, e um snapshot mentiroso e pior que nao abrir.
    let prods: Produto[];
    let items: ItemPreco[];
    try {
      [prods, items] = await Promise.all([
        fetchAllRows<Produto>((from, to) =>
          supabase.from("produtos").select("id, nome, sku, preco")
            .order("nome").order("id", { ascending: true }).range(from, to)),
        fetchAllRows<ItemPreco>((from, to) =>
          supabase.from("tabela_preco_itens").select("id, tabela_preco_id, produto_id, preco")
            .eq("tabela_preco_id", t.id).order("id", { ascending: true }).range(from, to)),
      ]);
    } catch (e: any) {
      toast.error("Could not open the prices of this list: " + (e?.message ?? String(e)));
      return;
    }
    setSelectedTabela(t);
    setItemSearch("");
    setProdutos(prods);
    setItens(items);
    const prices: Record<string, string> = {};
    items.forEach((i) => { prices[i.produto_id] = String(i.preco); });
    setEditingPrices(prices);
    setOrigPrices(prices);
    setItemsDialog(true);
  };

  // Preço "normalizado" pra comparar editado × salvo (vazio/inválido/<=0 = sem preço).
  const normPrice = (s: string | undefined): string => {
    const v = parseFloat(s ?? "");
    return isNaN(v) || v <= 0 ? "" : String(v);
  };
  // Linhas com edição pendente — habilita o Save único.
  const dirtyIds = useMemo(() => {
    const ids = new Set([...Object.keys(editingPrices), ...Object.keys(origPrices)]);
    return [...ids].filter((id) => normPrice(editingPrices[id]) !== normPrice(origPrices[id]));
  }, [editingPrices, origPrices]);

  // Save ÚNICO: aplica TODAS as edições do popup de uma vez (upsert em lote;
  // preço apagado/zerado = remove o preço custom daquele produto).
  const saveAllPrices = async () => {
    if (!selectedTabela || dirtyIds.length === 0) return;
    setSavingPrices(true);
    // `origem: 'local'` — preco que uma PESSOA digitou.
    //
    // So as linhas de `dirtyIds` entram aqui, e e por isso que o carimbo e
    // honesto: marca o que foi realmente mexido, nao tudo que a tela gravou.
    //
    // Sem isto, uma linha editada a mao continuaria marcada `b2bwave` e seria
    // apagada sozinha no ciclo seguinte, quando a exclusao automatica for
    // armada — exatamente a perda de trabalho humano que a coluna `origem`
    // (20260826100000) existe para impedir.
    const upserts: { tabela_preco_id: string; produto_id: string; preco: number; origem: string }[] = [];
    const removes: string[] = [];
    for (const id of dirtyIds) {
      const v = parseFloat(editingPrices[id] ?? "");
      if (isNaN(v) || v <= 0) removes.push(id);
      else upserts.push({ tabela_preco_id: selectedTabela.id, produto_id: id, preco: v, origem: "local" });
    }
    let error = null as { message: string } | null;
    if (upserts.length) {
      const r = await supabase.from("tabela_preco_itens")
        .upsert(upserts, { onConflict: "tabela_preco_id,produto_id" });
      error = r.error;
    }
    if (!error && removes.length) {
      const r = await supabase.from("tabela_preco_itens").delete()
        .eq("tabela_preco_id", selectedTabela.id).in("produto_id", removes);
      error = r.error;
    }
    setSavingPrices(false);
    if (error) { toast.error(error.message); return; }
    setOrigPrices({ ...editingPrices });
    toast.success(`${dirtyIds.length} price(s) saved`);
  };

  const filteredProdutos = produtos.filter((p) =>
    p.nome.toLowerCase().includes(itemSearch.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(itemSearch.toLowerCase())
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
                    <Button variant="ghost" size="icon" onClick={() => handleDuplicate(t)} title="Duplicate price list"><Copy className="h-4 w-4" /></Button>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProdutos.map((p) => (
                  <TableRow key={p.id} className={normPrice(editingPrices[p.id]) !== normPrice(origPrices[p.id]) ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-muted-foreground">$ {Number(p.preco).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="—"
                        className="h-8 w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editingPrices[p.id] ?? ""}
                        onChange={(e) => setEditingPrices({ ...editingPrices, [p.id]: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Save ÚNICO: habilita ao editar qualquer linha e salva TODAS de uma vez. */}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {dirtyIds.length > 0 ? `${dirtyIds.length} unsaved change(s)` : "No pending changes"}
            </span>
            <Button onClick={saveAllPrices} disabled={savingPrices || dirtyIds.length === 0}>
              {savingPrices ? "Saving..." : `Save${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminTabelasPreco;
