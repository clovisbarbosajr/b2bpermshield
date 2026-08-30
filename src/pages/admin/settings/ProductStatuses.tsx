import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOMES_DE_SISTEMA } from "@/lib/stock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

const ProductStatuses = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", cor: "#6b7280", ordem: 0, ativo: true, permite_visualizar: true, permite_comprar: true });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data, error } = await supabase.from("product_statuses").select("*").order("ordem");
    // Sem isto, falha de leitura virava lista vazia — e a acao de recuperacao
    // (recriar "Sold Out") gerava DUAS linhas com o mesmo nome, que e o defeito
    // vizinho: navegador (`Map`, ultima vence) e banco (`LIMIT 1` sem `ORDER BY`)
    // podem decidir coisas opostas para o mesmo produto.
    setLoadError(error ? error.message : null);
    setItems(error ? [] : (data ?? [])); setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", cor: "#6b7280", ordem: 0, ativo: true, permite_visualizar: true, permite_comprar: true }); setDialogOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({ nome: r.nome, cor: r.cor ?? "#6b7280", ordem: r.ordem ?? 0, ativo: r.ativo, permite_visualizar: r.permite_visualizar ?? true, permite_comprar: r.permite_comprar ?? true });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const nome = form.nome.trim();
    if (!nome) { toast.error("Name is required"); return; }

    // RENOMEAR UM DOS SEIS QUEBRA O CASAMENTO POR NOME, e a quebra e silenciosa
    // nos tres consumidores de uma vez. Mesmo motivo do aviso no delete.
    const eraDeSistema = editing && NOMES_DE_SISTEMA.includes(String(editing.nome).trim().toLowerCase());
    if (eraDeSistema && nome.toLowerCase() !== String(editing.nome).trim().toLowerCase()) {
      if (!confirm(
        `Rename "${editing.nome}" to "${nome}"?\n\n` +
        `Products are matched to this status BY NAME, and every check fails open. ` +
        `After the rename, every product currently marked "${editing.nome}" goes back on the ` +
        `storefront, orderable — including items you deliberately took off sale while ` +
        `still holding stock.`
      )) return;
    }

    // Nome duplicado: navegador (`Map`, ultima vence) e banco (`LIMIT 1` sem
    // `ORDER BY`) podem decidir coisas opostas para o mesmo produto. Nao ha UNIQUE
    // no banco — esta checagem fecha o caso do dia a dia, nao a corrida.
    const repetido = items.find((i: any) =>
      String(i.nome).trim().toLowerCase() === nome.toLowerCase() && i.id !== editing?.id);
    if (repetido) {
      toast.error(
        `There is already a status named "${repetido.nome}". Two statuses with the same name ` +
        `make the storefront and the order check disagree about the same product.`
      );
      return;
    }

    setSaving(true);
    const payload = { ...form, nome };
    // `.select("id")`: UPDATE que casa zero linhas volta 204 com `error: null`.
    const { data, error } = editing
      ? await supabase.from("product_statuses").update(payload).eq("id", editing.id).select("id").maybeSingle()
      : await supabase.from("product_statuses").insert(payload).select("id").maybeSingle();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error("Nothing was saved — this status no longer exists. Reload the page."); setDialogOpen(false); fetchData(); return; }
    toast.success(editing ? "Status updated" : "Status created");
    setDialogOpen(false); fetchData();
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
                {/* "View order" lia-se como "ver o pedido". O campo e
                  * `permite_visualizar`, e desmarcar ESCONDE o produto do
                  * catalogo (`Catalogo.tsx` filtra por ele). O dono desmarcava
                  * achando que mexia na visualizacao do PEDIDO e sumia com
                  * produto da loja. */}
                <TableHead>Shows in store</TableHead>
                <TableHead>Can be ordered</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                  {/* `BoolIcon` como a coluna vizinha: celula em BRANCO numa coluna booleana
                      le-se como "sem dado", e esta e justamente a coluna que esconde o
                      produto da loja. */}
                  <TableCell><BoolIcon val={r.permite_visualizar ?? true} /></TableCell>
                  <TableCell><BoolIcon val={r.permite_comprar ?? true} /></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                      // NAO EXISTE FK. O comentario anterior aqui afirmava que
                      // "status em uso por produto tem FK" — e falso, e era
                      // justamente essa frase que fazia o revisor pular o defeito:
                      // `produtos.status_produto` e `text`, e os tres consumidores
                      // falham ABRINDO quando o nome nao casa.
                      //
                      // Apagar "Sold Out" devolve ao catalogo, comprável, todo
                      // produto que o admin tirou de venda de proposito com estoque
                      // em caixa.
                      const deSistema = NOMES_DE_SISTEMA.includes(String(r.nome).trim().toLowerCase());
                      if (!confirm(
                        `Delete "${r.nome}"?\n\n` +
                        (deSistema
                          ? `THIS IS A BUILT-IN STATUS. Products are matched to it BY NAME, and every check ` +
                            `fails open: deleting it puts every product currently marked "${r.nome}" back on ` +
                            `the storefront, orderable — including items you deliberately took off sale ` +
                            `while still holding stock.\n\n`
                          : ``) +
                        `This cannot be undone.`
                      )) return;
                      const { data: apagado, error } = await supabase
                        .from("product_statuses").delete().eq("id", r.id).select("id").maybeSingle();
                      if (error) { toast.error("Could not delete: " + error.message); return; }
                      if (!apagado) { toast.error("Nothing was deleted — this status no longer exists."); fetchData(); return; }
                      fetchData();
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
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permite_visualizar} onChange={e => setForm({ ...form, permite_visualizar: e.target.checked })} /> Shows in store</label>
              <p className="text-xs text-muted-foreground pl-6">Unchecking this <strong>hides every product with this status from the catalog</strong>. Customers will not see them at all.</p>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.permite_comprar} onChange={e => setForm({ ...form, permite_comprar: e.target.checked })} /> Can be ordered</label>
              <p className="text-xs text-muted-foreground pl-6">Unchecked means the product is still visible, but cannot be added to an order.</p>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Active</label>
              {/* O texto anterior afirmava que status inativo "nao e mais oferecido ao
                  editar um produto". Falso: o dropdown do ProductEdit e uma lista FIXA
                  de seis, que nunca consulta esta tabela — `ativo` nao e lido por
                  ninguem. */}
              <p className="text-xs text-muted-foreground pl-6">Not used yet: the product form still offers the six built-in statuses regardless of this checkbox.</p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ProductStatuses;
