import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { percentualEmFaixa } from "@/lib/percentual";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

const SalesTax = () => {
  const [classes, setClasses] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // O toast do sonner dura 6 s; a TELA continuava afirmando que nao ha regra de
  // imposto nenhuma, e o admin recriava as que ja existiam. Pior: com `classes`
  // vazio, "New Sales Tax rate" manda `tax_class_id: ""` e o Postgres recusa
  // com 22P02 — o admin leva a mensagem crua do banco em vez de saber que a tela
  // nao conseguiu ler.
  const [loadError, setLoadError] = useState<string | null>(null);

  // Dialogs
  const [classDialog, setClassDialog] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [rateDialog, setRateDialog] = useState(false);
  const [ruleDialog, setRuleDialog] = useState(false);

  // Editing state
  const [editingClass, setEditingClass] = useState<any>(null);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [editingRate, setEditingRate] = useState<any>(null);
  const [editingRule, setEditingRule] = useState<any>(null);

  // Forms
  const [classForm, setClassForm] = useState({ nome: "", is_default: false });
  const [groupForm, setGroupForm] = useState({ nome: "", is_default: false });
  const [rateForm, setRateForm] = useState({ nome: "", estado: "", percentual: 0, ordem: 0 });
  const [ruleForm, setRuleForm] = useState({ tax_class_id: "", tax_customer_group_id: "", tax_rate_id: "" });
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    const [c, g, r, ru] = await Promise.all([
      supabase.from("tax_classes").select("*").order("nome"),
      supabase.from("tax_customer_groups").select("*").order("nome"),
      supabase.from("tax_rates").select("*").order("regiao"),
      supabase.from("tax_rules").select("*, tax_classes(nome), tax_customer_groups(nome), tax_rates(nome, regiao, percentual)").order("created_at"),
    ]);
    // Erro de leitura calado pintava a tela de "nao ha nenhuma regra de imposto"
    // — e o admin recriava as regras que ja existiam. Pior: com `classes` vazio,
    // o botao "New Sales Tax rate" manda `tax_class_id: ""` e leva 22P02
    // cru na cara. NAO grava: a coluna e `uuid NOT NULL`.
    const erro = c.error ?? g.error ?? r.error ?? ru.error;
    setLoadError(erro ? erro.message : null);
    if (erro) {
      // NAO segue para os `setX(... ?? [])`: lista vazia sob um banner de erro
      // ainda e lista vazia, e os dialogos gravam a partir dela.
      toast.error("Could not load the tax settings: " + erro.message);
      setClasses([]); setGroups([]); setRates([]); setRules([]);
      setLoading(false);
      return;
    }
    setClasses(c.data ?? []);
    setGroups(g.data ?? []);
    setRates(r.data ?? []);
    setRules(ru.data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  // Save handlers
  // Marcar como default aqui NAO desmarcava os outros (a tela de frete faz certo,
  // ShippingOptions:105-106). Com DOIS defaults, o checkout usa `.maybeSingle()` e
  // ERRA -> a tela mostra imposto ZERO; o trigger do banco usa `LIMIT 1`, escolhe
  // um e CALCULA o imposto; o checkout entao cobra o total do banco. Resultado: o
  // cliente paga mais do que viu na tela.
  const limparOutrosDefault = async (tabela: "tax_classes" | "tax_customer_groups", exceto?: string) => {
    let q = supabase.from(tabela).update({ is_default: false } as any).eq("is_default", true);
    if (exceto) q = q.neq("id", exceto);
    const { error } = await q;
    return error;
  };

  const saveClass = async () => {
    setSaving(true);
    const { data, error } = editingClass
      ? await supabase.from("tax_classes").update(classForm).eq("id", editingClass.id).select("id").maybeSingle()
      : await supabase.from("tax_classes").insert(classForm).select("id").maybeSingle();
    if (error) { setSaving(false); toast.error("Could not save: " + error.message); return; }
    // `update` que nao casa nenhuma linha (outro admin apagou a classe) volta
    // `data: null, error: null` — dizia "Updated" sem ter gravado nada. E o passo
    // seguinte era pior: sem `data.id`, `limparOutrosDefault` recebia `undefined`,
    // caia no ramo SEM `neq` e tirava o `is_default` de TODAS. Zero classe padrao
    // = `tax_classes WHERE is_default LIMIT 1` vazio no trigger = imposto ZERO em
    // todo pedido seguinte, calado. Falha FECHADO: nao limpa nada.
    if (!data) {
      setSaving(false);
      toast.error(editingClass
        ? "This tax class no longer exists — nothing was saved. Reload the page."
        : "Could not confirm the saved tax class — reload the page before setting a default.");
      fetchAll(); return;
    }
    if ((classForm as any).is_default) {
      const e2 = await limparOutrosDefault("tax_classes", data.id);
      if (e2) { setSaving(false); toast.error("Saved, but could not clear the previous default: " + e2.message); fetchAll(); return; }
    }
    toast.success(editingClass ? "Updated" : "Created");
    setSaving(false); setClassDialog(false); fetchAll();
  };

  const saveGroup = async () => {
    setSaving(true);
    const { data, error } = editingGroup
      ? await supabase.from("tax_customer_groups").update(groupForm).eq("id", editingGroup.id).select("id").maybeSingle()
      : await supabase.from("tax_customer_groups").insert(groupForm).select("id").maybeSingle();
    if (error) { setSaving(false); toast.error("Could not save: " + error.message); return; }
    // Mesmo caso do `saveClass`: sem `data.id`, o `limparOutrosDefault` roda sem
    // `neq` e zera o padrao de TODOS os grupos.
    if (!data) {
      setSaving(false);
      toast.error(editingGroup
        ? "This customer group no longer exists — nothing was saved. Reload the page."
        : "Could not confirm the saved customer group — reload the page before setting a default.");
      fetchAll(); return;
    }
    if ((groupForm as any).is_default) {
      const e2 = await limparOutrosDefault("tax_customer_groups", data.id);
      if (e2) { setSaving(false); toast.error("Saved, but could not clear the previous default: " + e2.message); fetchAll(); return; }
    }
    toast.success(editingGroup ? "Updated" : "Created");
    setSaving(false); setGroupDialog(false); fetchAll();
  };

  const saveRate = async () => {
    setSaving(true);
    const payload = { nome: rateForm.nome, estado: rateForm.estado, regiao: rateForm.estado, percentual: rateForm.percentual, ordem: rateForm.ordem, tax_class_id: (classes.find((c: any) => c.is_default) ?? classes[0])?.id ?? "" };
    // `.select("id")`: UPDATE que nao acha linha (outro admin apagou a classe no
    // meio, e o CASCADE levou esta taxa junto) volta `error: null` com zero
    // linhas — a tela dizia "Updated" por cima de nada. O molde ja estava em
    // `saveClass`/`saveGroup` neste mesmo arquivo; duas das quatro tinham ficado
    // de fora, que e a inconsistencia que morde depois.
    const { data, error } = editingRate
      ? await supabase.from("tax_rates").update({ nome: rateForm.nome, estado: rateForm.estado, regiao: rateForm.estado, percentual: rateForm.percentual, ordem: rateForm.ordem }).eq("id", editingRate.id).select("id").maybeSingle()
      : await supabase.from("tax_rates").insert(payload).select("id").maybeSingle();
    setSaving(false);
    if (error) { toast.error("Could not save: " + error.message); return; }
    if (!data) { toast.error("Nothing was saved — this tax rate no longer exists. Reload the page."); fetchAll(); return; }
    toast.success(editingRate ? "Updated" : "Created");
    setRateDialog(false); fetchAll();
  };

  const saveRule = async () => {
    // DUAS REGRAS PARA O MESMO PAR QUEBRAM O CHECKOUT, E NAO E CASO RARO.
    //
    // `tax_rules` nao tem UNIQUE em `(tax_class_id, tax_customer_group_id)`, e o
    // `Checkout` le a regra com `.maybeSingle()`, que ERRA quando volta mais de
    // uma linha: `taxLookupOk` vira false, `taxRate` fica 0 e a linha "Sales Tax"
    // some da tela. O banco, que resolve a mesma consulta com `LIMIT 1` sem
    // `ORDER BY`, cobra o imposto de verdade.
    //
    // O caminho natural para cair nisso: o admin cria "TX 8.25%" e "FL 6%" e
    // amarra as duas ao mesmo grupo padrao — porque imposto, para ele, e por
    // estado. So que o calculo IGNORA estado por completo (a regra e por grupo).
    // Dois cliques, sem erro nenhum, e o checkout passa a mentir.
    //
    // A checagem e no cliente e nao substitui o UNIQUE no banco: duas abas ao
    // mesmo tempo ainda passam. Fecha o caso do dia a dia, que e o que existe.
    const duplicada = rules.find((r: any) =>
      r.tax_class_id === ruleForm.tax_class_id &&
      r.tax_customer_group_id === ruleForm.tax_customer_group_id &&
      r.id !== editingRule?.id);
    if (duplicada) {
      toast.error(
        "There is already a rule for this tax class and customer group. " +
        "Two rules for the same pair make the checkout show no sales tax while the order is still taxed. " +
        "Edit the existing rule instead."
      );
      return;
    }
    setSaving(true);
    const { data, error } = editingRule
      ? await supabase.from("tax_rules").update(ruleForm).eq("id", editingRule.id).select("id").maybeSingle()
      : await supabase.from("tax_rules").insert(ruleForm).select("id").maybeSingle();
    setSaving(false);
    if (error) { toast.error("Could not save: " + error.message); return; }
    if (!data) { toast.error("Nothing was saved — this rule no longer exists. Reload the page."); fetchAll(); return; }
    toast.success(editingRule ? "Updated" : "Created");
    setRuleDialog(false); fetchAll();
  };

  const BoolIcon = ({ val }: { val: boolean }) => val ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />;

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Sales Tax</h2>
      </div>

      {/* ANTES DAS QUATRO TABELAS. Toast dura 6 s; a tela continuava afirmando que
          nao ha regra de imposto nenhuma, e o admin recriava as que ja existiam —
          criando exatamente a duplicata que faz o checkout mostrar imposto zero
          enquanto o banco cobra. E com `classes` vazio, "New Sales Tax rate" grava
          `tax_class_id: ""`. */}
      {loadError && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Could not load the tax settings.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This does NOT mean there are no tax rules — they could not be read. Do not re-create anything:
            a duplicate rule makes the checkout show no sales tax while the order is still taxed.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); fetchAll(); }}>Try again</Button>
        </div>
      )}

      {/* Sales Tax Rules */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Sales Tax rules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sales Tax product class</TableHead>
                <TableHead>Sales Tax customer Group</TableHead>
                <TableHead>Sales Tax rate</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{(r as any).tax_classes?.nome ?? "—"}</TableCell>
                  <TableCell>{(r as any).tax_customer_groups?.nome ?? "—"}</TableCell>
                  <TableCell>
                    {(r as any).tax_rates?.nome || (r as any).tax_rates?.regiao || "—"}{" "}
                    {(r as any).tax_rates?.percentual != null && `${Number((r as any).tax_rates.percentual).toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => {
                      setEditingRule(r);
                      setRuleForm({ tax_class_id: r.tax_class_id, tax_customer_group_id: r.tax_customer_group_id, tax_rate_id: r.tax_rate_id });
                      setRuleDialog(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                      if (!confirm("Delete this tax rule?")) return;
                      const { error } = await supabase.from("tax_rules").delete().eq("id", r.id); if (error) { toast.error("Could not delete: " + error.message); return; } fetchAll();
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button size="sm" className="mt-3 gap-1" onClick={() => {
            setEditingRule(null);
            setRuleForm({ tax_class_id: (classes.find((c: any) => c.is_default) ?? classes[0])?.id ?? "", tax_customer_group_id: groups[0]?.id ?? "", tax_rate_id: rates[0]?.id ?? "" });
            setRuleDialog(true);
          }}><Plus className="h-4 w-4" /> New Sales Tax rule</Button>
        </CardContent>
      </Card>

      {/* Three columns: Product Classes, Customer Groups, Rates */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Classes */}
        <Card>
          <CardHeader><CardTitle>Sales Tax product classes</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Is default?</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {classes.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell>{c.is_default ? "Is default" : ""}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setEditingClass(c); setClassForm({ nome: c.nome, is_default: c.is_default ?? false }); setClassDialog(true);
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                        // `tax_rates.tax_class_id` e `tax_rules.tax_class_id` sao
                        // ON DELETE CASCADE: apagar a classe leva as taxas E as
                        // regras. E o sync do B2BWave NAO reescreve nada de
                        // imposto — a perda e permanente.
                        //
                        // Se for a classe PADRAO, o gatilho passa a nao achar
                        // nenhuma (`SELECT id INTO _taxclass ... WHERE is_default`)
                        // e grava `sales_tax := 0` em TODO pedido seguinte, calado.
                        // O confirm era "Delete this tax class?".
                        const [tr, tru] = await Promise.all([
                          supabase.from("tax_rates").select("id", { count: "exact", head: true }).eq("tax_class_id", c.id),
                          supabase.from("tax_rules").select("id", { count: "exact", head: true }).eq("tax_class_id", c.id),
                        ]);
                        if (tr.error || tru.error) {
                          toast.error("Could not check what this tax class is used by — nothing was deleted: " + (tr.error ?? tru.error)!.message);
                          return;
                        }
                        if (!confirm(
                          `Delete "${c.nome}"?

` +
                          `This permanently deletes, together with the class:
` +
                          `• ${tr.count ?? 0} tax rate(s)
` +
                          `• ${tru.count ?? 0} tax rule(s)

` +
                          (c.is_default
                            ? `THIS IS THE DEFAULT TAX CLASS. With no default, every new order will be saved with sales tax = 0, silently.

`
                            : ``) +
                          `Tax settings do not come back from the B2BWave sync. This cannot be undone.`
                        )) return;
                        const { data: apagada, error } = await supabase.from("tax_classes").delete().eq("id", c.id).select("id").maybeSingle();
                        if (error) { toast.error("Could not delete: " + error.message); return; }
                        if (!apagada) { toast.error("Nothing was deleted — this tax class no longer exists."); fetchAll(); return; }
                        fetchAll();
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1" onClick={() => {
              setEditingClass(null); setClassForm({ nome: "", is_default: false }); setClassDialog(true);
            }}><Plus className="h-4 w-4" /> New Sales Tax product class</Button>
          </CardContent>
        </Card>

        {/* Customer Groups */}
        <Card>
          <CardHeader><CardTitle>Sales Tax customer groups</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Is default?</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {groups.map(g => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.nome}</TableCell>
                    <TableCell>{g.is_default ? "Is default" : ""}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setEditingGroup(g); setGroupForm({ nome: g.nome, is_default: g.is_default ?? false }); setGroupDialog(true);
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                        if (!confirm("Delete this customer group?")) return;
                        const { error } = await supabase.from("tax_customer_groups").delete().eq("id", g.id); if (error) { toast.error("Could not delete: " + error.message); return; } fetchAll();
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1" onClick={() => {
              setEditingGroup(null); setGroupForm({ nome: "", is_default: false }); setGroupDialog(true);
            }}><Plus className="h-4 w-4" /> New Sales Tax customer group</Button>
          </CardContent>
        </Card>

        {/* Rates */}
        <Card>
          <CardHeader><CardTitle>Sales Tax rates</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Rate</TableHead><TableHead>Sort</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rates.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.nome || r.regiao}</TableCell>
                    <TableCell>{Number(r.percentual).toFixed(1)}</TableCell>
                    <TableCell>{r.ordem ?? 0}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setEditingRate(r); setRateForm({ nome: r.nome || "", estado: r.estado || r.regiao, percentual: Number(r.percentual), ordem: r.ordem ?? 0 }); setRateDialog(true);
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                        // `tax_rules.tax_rate_id` e ON DELETE CASCADE: apagar a
                        // taxa apaga as regras que a usam, e o grupo daqueles
                        // clientes passa a nao ter regra — imposto zero em todo
                        // pedido deles, sem aviso. Perda permanente (o sync do
                        // B2BWave nao toca em imposto).
                        const usos = await supabase.from("tax_rules")
                          .select("id", { count: "exact", head: true }).eq("tax_rate_id", r.id);
                        if (usos.error) {
                          toast.error("Could not check what this rate is used by — nothing was deleted: " + usos.error.message);
                          return;
                        }
                        if (!confirm(
                          `Delete "${r.nome || r.estado || r.regiao}"?

` +
                          `This also deletes ${usos.count ?? 0} tax rule(s) that use it. ` +
                          `Customer groups left without a rule are charged no sales tax, with no warning.

` +
                          `Tax settings do not come back from the B2BWave sync. This cannot be undone.`
                        )) return;
                        const { data: apagada, error } = await supabase.from("tax_rates").delete().eq("id", r.id).select("id").maybeSingle();
                        if (error) { toast.error("Could not delete: " + error.message); return; }
                        if (!apagada) { toast.error("Nothing was deleted — this tax rate no longer exists."); fetchAll(); return; }
                        fetchAll();
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1" onClick={() => {
              setEditingRate(null); setRateForm({ nome: "", estado: "", percentual: 0, ordem: 0 }); setRateDialog(true);
            }}><Plus className="h-4 w-4" /> New Sales Tax rate</Button>
          </CardContent>
        </Card>
      </div>

      {/* Class Dialog */}
      <Dialog open={classDialog} onOpenChange={setClassDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingClass ? "Edit" : "New"} Tax Product Class</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={classForm.nome} onChange={e => setClassForm({ ...classForm, nome: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classForm.is_default} onChange={e => setClassForm({ ...classForm, is_default: e.target.checked })} /> Is default</label>
            <Button onClick={saveClass} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Dialog */}
      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingGroup ? "Edit" : "New"} Tax Customer Group</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={groupForm.nome} onChange={e => setGroupForm({ ...groupForm, nome: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={groupForm.is_default} onChange={e => setGroupForm({ ...groupForm, is_default: e.target.checked })} /> Is default</label>
            <Button onClick={saveGroup} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rate Dialog */}
      <Dialog open={rateDialog} onOpenChange={setRateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingRate ? "Edit" : "New"} Tax Rate</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={rateForm.nome} onChange={e => setRateForm({ ...rateForm, nome: e.target.value })} /></div>
            <div><Label>Rate</Label><Input type="number" min="0" max="100" step="0.1" value={rateForm.percentual} onChange={e => setRateForm({ ...rateForm, percentual: percentualEmFaixa(e.target.value) })} /></div>
            <div><Label>Sort</Label><Input type="number" value={rateForm.ordem} onChange={e => setRateForm({ ...rateForm, ordem: parseInt(e.target.value) || 0 })} /></div>
            <Button onClick={saveRate} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rule Dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingRule ? "Edit" : "New"} Sales Tax Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Sales Tax Product Class</Label>
              {/* So a classe PADRAO. O calculo do imposto — tanto no checkout
                  (Checkout.tsx, `.eq("is_default", true)`) quanto no trigger
                  (`WHERE is_default LIMIT 1`) — so procura regra na classe padrao.
                  Deixar escolher outra criava uma regra que aparece ativa na tela e
                  resulta em imposto ZERO no pedido, sem nenhum aviso. */}
              <Select value={ruleForm.tax_class_id} onValueChange={v => setRuleForm({ ...ruleForm, tax_class_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                <SelectContent>
                  {classes
                    // A classe da regra ATUAL entra na lista mesmo se nao for a
                    // padrao — senao o Select ficava EM BRANCO ao editar uma regra
                    // antiga e o admin nem via qual classe estava quebrada.
                    .filter(c => c.is_default || c.id === ruleForm.tax_class_id)
                    .map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}{c.is_default ? "" : " (not used in calculation)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {classes.some(c => !c.is_default) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Tax is calculated using the <strong>default</strong> product class only. A rule on any other class results in zero tax.
                </p>
              )}
            </div>
            <div>
              <Label>Sales Tax Customer Group</Label>
              <Select value={ruleForm.tax_customer_group_id} onValueChange={v => setRuleForm({ ...ruleForm, tax_customer_group_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sales Tax Rate</Label>
              <Select value={ruleForm.tax_rate_id} onValueChange={v => setRuleForm({ ...ruleForm, tax_rate_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{rates.map(r => <SelectItem key={r.id} value={r.id}>{r.nome || r.regiao} {Number(r.percentual).toFixed(2)}%</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={saveRule} disabled={saving} className="w-full">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default SalesTax;
