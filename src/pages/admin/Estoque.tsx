import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useAuth } from "@/contexts/AuthContext";
import { useActivityLog } from "@/hooks/useActivityLog";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { toast } from "sonner";

const AdminEstoque = () => {
  const { user } = useAuth();
  const { log } = useActivityLog();
  const [produtos, setProdutos] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [novaQtd, setNovaQtd] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  const fetchData = async () => {
    // Pagina de verdade (o PostgREST corta em 1000 sem erro) e mostra o erro em
    // vez de virar lista vazia com cara de banco sem produto.
    try {
      const data = await fetchAllRows<any>((f, t) => supabase.from("produtos")
        .select("id, nome, sku, estoque_total, estoque_reservado").order("nome").range(f, t) as any);
      setProdutos(data);
    } catch (e: any) {
      console.error(e);
      toast.error("Could not load stock. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Estoque AO VIVO: refaz a lista quando produtos mudam (ex.: item comprado reserva/baixa).
  useEffect(() => {
    const channel = supabase
      .channel("admin-estoque-produtos")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const openAjuste = async (p: any) => {
    setSelected(p);
    setNovaQtd(p.estoque_total);
    setMotivo("");
    const { data } = await supabase.from("estoque_log").select("*").eq("produto_id", p.id).order("created_at", { ascending: false }).limit(10);
    setLogs(data ?? []);
  };

  const handleAjuste = async () => {
    if (!selected) return;
    // Validações que faltavam aqui e que a OUTRA tela de estoque
    // (`InventoryAdjustment.tsx:101,189`) já fazia — duas telas gravando a mesma
    // coluna com regras opostas. Não há CHECK no banco segurando isso.
    if (!Number.isFinite(novaQtd) || novaQtd < 0) {
      toast.error("Quantity cannot be negative.");
      return;
    }
    // Relê o estoque AGORA: o diálogo trabalha com um retrato tirado no `openAjuste`,
    // e o update é ABSOLUTO. Se um pedido foi concluído com o diálogo aberto, salvar
    // sem mudar nada regravava o valor velho e DESFAZIA a baixa.
    const { data: atual, error: reErr } = await supabase.from("produtos")
      .select("estoque_total, estoque_reservado").eq("id", selected.id).maybeSingle();
    if (reErr || !atual) { toast.error("Could not re-read current stock. Try again."); return; }
    if (atual.estoque_total !== selected.estoque_total) {
      toast.error(`Stock changed to ${atual.estoque_total} while this window was open (was ${selected.estoque_total}). Reopen the adjustment.`);
      setSelected(null);
      fetchData();
      return;
    }
    const reservado = atual.estoque_reservado ?? 0;
    if (novaQtd < reservado) {
      toast.error(`There are ${reservado} unit(s) already reserved by open orders — the total cannot be lower than that.`);
      return;
    }
    setSaving(true);
    // O UPDATE vem PRIMEIRO e é checado: antes, o estoque_log e o activity log
    // eram gravados mesmo quando o update falhava (RLS/rede) e a tela dizia
    // "Stock updated" — o histórico registrava um ajuste que nunca aconteceu.
    const { error: updErr } = await supabase.from("produtos")
      .update({ estoque_total: novaQtd }).eq("id", selected.id);
    if (updErr) {
      setSaving(false);
      toast.error("Failed to update stock: " + updErr.message);
      return;
    }
    // O histórico também é checado: sem isso, um insert barrado deixava o ajuste
    // aplicado e o History sem registro — buraco silencioso na auditoria.
    const { error: logErr } = await supabase.from("estoque_log").insert({
      produto_id: selected.id, quantidade_anterior: selected.estoque_total,
      quantidade_nova: novaQtd, motivo: motivo || null, usuario_id: user?.id ?? null,
    });
    if (logErr) toast.warning("Stock saved, but the history entry failed: " + logErr.message);
    // Também no Activity Logs (Settings → Activity Logs), com detalhes.
    log("updated", "inventory", selected.id, selected.sku ? `${selected.nome} (${selected.sku})` : selected.nome, {
      qty_before: selected.estoque_total, qty_after: novaQtd,
      difference: novaQtd - selected.estoque_total, memo: motivo || null,
    });
    setSaving(false);
    toast.success("Stock updated");
    setSelected(null);
    fetchData();
  };

  const filtered = produtos.filter((p) => p.nome.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(search.toLowerCase()));
  const disponivel = (p: any) => p.estoque_total - p.estoque_reservado;

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-semibold">Inventory</h2>
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead className="text-center">Total</TableHead><TableHead className="text-center">Reserved</TableHead><TableHead className="text-center">Available</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell className="text-center">{p.estoque_total}</TableCell>
                  <TableCell className="text-center">{p.estoque_reservado}</TableCell>
                  <TableCell className="text-center"><Badge variant={disponivel(p) > 0 ? "default" : "destructive"}>{disponivel(p)}</Badge></TableCell>
                  <TableCell><Button variant="outline" size="sm" onClick={() => openAjuste(p)}>Adjust</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust Stock — {selected?.nome}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Current quantity</Label><Input value={selected?.estoque_total ?? 0} disabled /></div>
            {/* `min={0}`: sem isso a setinha pra baixo passava de zero e salvava
                estoque NEGATIVO (não há CHECK no banco). */}
            <div>
              <Label>New quantity</Label>
              <Input type="number" min={0} value={novaQtd} onChange={(e) => setNovaQtd(Math.max(0, parseInt(e.target.value) || 0))} />
              {selected?.estoque_reservado > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.estoque_reservado} unit(s) reserved by open orders — the total can't go below that.
                </p>
              )}
            </div>
            <div><Label>Reason</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="e.g. Receiving, Inventory..." /></div>
            <Button onClick={handleAjuste} disabled={saving} className="w-full">{saving ? "Saving..." : "Confirm Adjustment"}</Button>
            {logs.length > 0 && (
              <div>
                <h4 className="mt-4 mb-2 text-sm font-semibold">History</h4>
                <div className="max-h-40 overflow-auto space-y-1">
                  {logs.map((l) => (
                    <div key={l.id} className="flex justify-between rounded border p-2 text-xs">
                      <span>{l.quantidade_anterior} → {l.quantidade_nova}</span>
                      <span className="text-muted-foreground">{l.motivo ?? "—"}</span>
                      <span className="text-muted-foreground">{new Date(l.created_at).toLocaleDateString("en-US")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminEstoque;
