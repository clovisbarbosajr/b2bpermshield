import { useState, useEffect, useMemo, useRef } from "react";
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
  // O toast dura 6 s; a tela continuava exibindo o card "No price lists yet" com
  // um botao "Create Price List" do lado. `tabelas_preco.nome` nao tem UNIQUE:
  // recriar duplica sem barreira, e os quatro `Map` por nome do sync do B2BWave
  // passam a resolver para uma das duas de forma indefinida — regua que recebe
  // preco pode trocar entre execucoes.
  const [loadError, setLoadError] = useState<string | null>(null);
  const duplicandoRef = useRef(false);
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
    setLoadError(error ? error.message : null);
    if (error) { toast.error("Could not load price lists: " + error.message); setTabelas([]); return; }
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
    // `NOT NULL` nao barra string vazia, e o dialogo aceitava. Regua sem nome
    // aparece como linha em branco nos seletores de seis telas — inclusive no de
    // atribuir cliente. O molde ja estava em `Coupons.handleSave`.
    const nome = form.nome.trim();
    if (!nome) { toast.error("Name is required"); return; }
    // GRAVA O APARADO, e nao `form`: um nome so com espacos passaria a checagem
    // acima e chegaria ao banco com os espacos, produzindo a mesma linha em branco.
    const payload = { ...form, nome };
    setSaving(true);
    if (editing) {
      // `.select("id")` de confirmacao: UPDATE que casa ZERO linhas volta 204 com
      // `error: null`. O caso real nao e corrida de escrita, e a linha ja APAGADA
      // por outro admin — a tela dizia "Price list updated" e so o `fetchData`
      // seguinte revelava que a regua nem existia mais.
      const { data: gravado, error } = await supabase.from("tabelas_preco")
        .update(payload).eq("id", editing.id).select("id").maybeSingle();
      if (error) { toast.error(error.message); setSaving(false); return; }
      if (!gravado) {
        toast.error("Nothing was saved — this price list no longer exists. Reload the page.");
        setSaving(false); setDialogOpen(false); fetchData();
        return;
      }
      toast.success("Price list updated");
    } else {
      const { data: criado, error } = await supabase.from("tabelas_preco").insert(payload).select("id").maybeSingle();
      if (error) { toast.error(error.message); setSaving(false); return; }
      if (!criado) { toast.error("Nothing was created. Try again."); setSaving(false); return; }
      toast.success("Price list created");
    }
    setSaving(false); setDialogOpen(false); fetchData();
  };

  const handleDelete = async (id: string) => {
    // CONTA A CASCATA ANTES DE PERGUNTAR — molde de `settings/PrivacyGroups.tsx`.
    //
    // "Delete this price list?" escondia quatro efeitos, e o pior e silencioso:
    //   `clientes.tabela_preco_id ON DELETE SET NULL` (20260318182853:35) — cada
    //     cliente amarrado passa a comprar por `produtos.preco`, o preco de
    //     balcao, sem que nada apareca na ficha dele nem na tela.
    //   `tabela_preco_itens` CASCADE (20260318182853:24) — os precos custom somem.
    //   `variante_precos` CASCADE (20260318202244:129) — idem, por variante.
    //   `produto_descontos` CASCADE (20260318202244:57) — dormente hoje, mas
    //     20260828040000 preservou essas linhas DE PROPOSITO para permitir
    //     rollback; apagar a regua leva o rollback junto.
    //
    // Falha ao contar RECUSA o delete: nao da para avisar sobre o que nao se leu.
    const [itens, variantes, descontos, clis] = await Promise.all([
      supabase.from("tabela_preco_itens").select("id", { count: "exact", head: true }).eq("tabela_preco_id", id),
      supabase.from("variante_precos").select("id", { count: "exact", head: true }).eq("tabela_preco_id", id),
      supabase.from("produto_descontos").select("id", { count: "exact", head: true }).eq("tabela_preco_id", id),
      supabase.from("clientes").select("id", { count: "exact", head: true }).eq("tabela_preco_id", id),
    ]);
    if (itens.error || variantes.error || descontos.error || clis.error) {
      toast.error("Could not check what this price list is used by — nothing was deleted. Try again.");
      return;
    }
    const partes: string[] = [];
    if (clis.count) partes.push(`${clis.count} customer(s) will lose this price list — they will be charged the base price`);
    if (itens.count) partes.push(`${itens.count} custom price(s) will be deleted`);
    if (variantes.count) partes.push(`${variantes.count} variant price(s) will be deleted`);
    if (descontos.count) partes.push(`${descontos.count} discount row(s) will be deleted`);
    const NL = String.fromCharCode(10);
    const aviso = partes.length
      ? ["Delete this price list?", "", ...partes.map((p) => "• " + p), "", "This cannot be undone."].join(NL)
      : "Delete this price list?";
    if (!confirm(aviso)) return;
    // `.select("id")` de confirmacao: DELETE que nao casa linha volta 204 com
    // `error: null`, e a tela dizia "Price list removed" por cima de nada.
    const { data: apagado, error } = await supabase.from("tabelas_preco")
      .delete().eq("id", id).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!apagado) {
      toast.error("Nothing was deleted — the price list no longer exists.");
      fetchData();
      return;
    }
    toast.success("Price list removed"); fetchData();
  };

  // Duplica a price list: cria "<nome> (copy)" (nunca default) e copia TODOS os
  // preços custom. Se a cópia dos preços falhar, avisa — a lista fica criada e
  // é só apagar/repetir (nada da lista original é tocado).
  const handleDuplicate = async (t: TabelaPreco) => {
    // TRAVA POR REF, checada ANTES do primeiro await. O botao era um icone MUDO —
    // sem `disabled`, sem spinner, sem toast de inicio — e a operacao sao no
    // minimo quatro idas ao servidor (insert + duas paginas de leitura + insert de
    // ~2 mil linhas). Segundo clique nessa janela cria uma regua a mais, identica,
    // com ~2 mil linhas de preco. `setState` nao serve: so vale no proximo render,
    // e aqui a leitura de `saving` cairia depois de um await.
    if (duplicandoRef.current) return;
    duplicandoRef.current = true;
    try {
    const { data: nova, error } = await supabase.from("tabelas_preco")
      .insert({ nome: `${t.nome} (copy)`, descricao: t.descricao, ativo: t.ativo, is_default: false })
      .select("id").single();
    if (error || !nova) { toast.error(error?.message ?? "Error duplicating"); return; }
    // PAGINADO: `tabela_preco_itens` cresce com produtos x reguas (1974 linhas hoje)
    // e o PostgREST corta em 1000 SEM erro. Uma leitura so copiava as primeiras 1000
    // e a tela ainda dizia "1000 price(s) copied" — a copia nascia incompleta, e o
    // que faltasse cairia no preco base, mais caro, sem ninguem notar.
    // O `id` VAI NO SELECT: `fetchAllRows` deduplica por `linha.id`, e sem a
    // coluna TODA linha cai no ramo sem dedupe — a protecao ficava desligada
    // exatamente aqui, calada (ordenar por coluna nao selecionada e legal no
    // PostgREST, entao nem erro havia). `tabela_preco_itens.id` e uuid aleatorio:
    // uma insercao concorrente (o proprio sync escreve nesta tabela) cai em
    // posicao arbitraria, empurra a linha de fronteira para a pagina seguinte e
    // ela volta DUAS vezes. O insert e um statement so contra
    // `UNIQUE(tabela_preco_id, produto_id)`: falha inteiro, e sobra uma regua
    // criada e VAZIA na grade, pronta para alguem amarrar um cliente nela.
    let items: { id: string; produto_id: string; preco: number }[];
    try {
      items = await fetchAllRows<{ id: string; produto_id: string; preco: number }>((from, to) =>
        supabase.from("tabela_preco_itens").select("id, produto_id, preco")
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
    } finally {
      // `finally`: qualquer saida antecipada (os tres `return` de erro acima) ou
      // um throw sem isto deixava o botao morto ate o F5.
      duplicandoRef.current = false;
    }
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
    // Se quem falhou foi o PROPRIO upsert, nada dele foi gravado. Contar
    // `upserts.length` incondicionalmente fazia a mensagem de falha parcial dizer
    // "Saved 5 of 5, then stopped" com ZERO no banco — a mensagem existe para
    // contar o que foi feito, e inverteria justamente esse fato.
    const upsertOk = !error;
    // O DELETE VAI EM LOTES DE 100.
    //
    // O filtro `in.(...)` viaja na QUERY STRING, e o encoder do postgrest-js nem
    // sequer poe aspas em uuid: sao 37 bytes por item. Limpar ~200 precos de uma
    // regua ja passa de 7 KB de URL e bate na linha de requisicao do proxy (414).
    // E o upsert acima JA foi commitado quando isso acontece: a regua ficava
    // meio-aplicada, e como o erro sai antes do `setOrigPrices`, toda linha
    // continuava suja e a retentativa refazia o mesmo delete gigante — nunca
    // saia do lugar sozinho. O lote de 100 e o mesmo que o sync usa
    // (`b2bwave-sync:1441`).
    let lotesFeitos = 0;
    for (let i = 0; !error && i < removes.length; i += 100) {
      const r = await supabase.from("tabela_preco_itens").delete()
        .eq("tabela_preco_id", selectedTabela.id).in("produto_id", removes.slice(i, i + 100));
      error = r.error;
      if (!error) lotesFeitos++;
    }
    setSavingPrices(false);
    if (error) {
      // DIZ ATE ONDE FOI. Quando o erro cai num lote do meio, o upsert e os lotes
      // anteriores JA foram commitados: o admin lia uma mensagem crua de rede e
      // nao tinha como saber que parte dos precos ja tinha sido apagada. Molde do
      // `sortAlphabetically` do `Categorias` ("the first N were reordered").
      // Repetir o Save e seguro — upsert e delete convergem —, e por isso as
      // linhas continuam marcadas como pendentes de proposito.
      const feitos = (upsertOk ? upserts.length : 0) + Math.min(lotesFeitos * 100, removes.length);
      toast.error(`Saved ${feitos} of ${dirtyIds.length} change(s), then stopped: ${error.message} — nothing was lost, click Save again to finish.`);
      return;
    }
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
        {/* `disabled` com a leitura falhada: o banner ao lado diz "Do not create a new
            one", mas so aconselhar nao basta. `tabelas_preco.nome` nao tem UNIQUE, e
            o sync do B2BWave casa por nome minusculo em `Map` com last-write-wins —
            a regua duplicada faz o preco ir para a errada, de forma indefinida entre
            execucoes. */}
        <Button onClick={openNew} disabled={!!loadError} className="gap-1"><Plus className="h-4 w-4" /> New Price List</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : loadError ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-destructive">Could not load the price lists.</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            This does NOT mean there are none — they could not be read. Do not create a new one:
            price list names are not unique, and a duplicate makes the B2BWave sync target the wrong list.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); fetchData(); }}>Try again</Button>
        </Card>
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
