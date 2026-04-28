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
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

const SalesTax = () => {
  const [classes, setClasses] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    setClasses(c.data ?? []);
    setGroups(g.data ?? []);
    setRates(r.data ?? []);
    setRules(ru.data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  // Save handlers
  const saveClass = async () => {
    setSaving(true);
    if (editingClass) {
      await supabase.from("tax_classes").update(classForm).eq("id", editingClass.id);
      toast.success("Updated");
    } else {
      await supabase.from("tax_classes").insert(classForm);
      toast.success("Created");
    }
    setSaving(false); setClassDialog(false); fetchAll();
  };

  const saveGroup = async () => {
    setSaving(true);
    if (editingGroup) {
      await supabase.from("tax_customer_groups").update(groupForm).eq("id", editingGroup.id);
      toast.success("Updated");
    } else {
      await supabase.from("tax_customer_groups").insert(groupForm);
      toast.success("Created");
    }
    setSaving(false); setGroupDialog(false); fetchAll();
  };

  const saveRate = async () => {
    setSaving(true);
    const payload = { nome: rateForm.nome, estado: rateForm.estado, regiao: rateForm.estado, percentual: rateForm.percentual, ordem: rateForm.ordem, tax_class_id: classes[0]?.id ?? "" };
    if (editingRate) {
      await supabase.from("tax_rates").update({ nome: rateForm.nome, estado: rateForm.estado, regiao: rateForm.estado, percentual: rateForm.percentual, ordem: rateForm.ordem }).eq("id", editingRate.id);
      toast.success("Updated");
    } else {
      await supabase.from("tax_rates").insert(payload);
      toast.success("Created");
    }
    setSaving(false); setRateDialog(false); fetchAll();
  };

  const saveRule = async () => {
    setSaving(true);
    if (editingRule) {
      await supabase.from("tax_rules").update(ruleForm).eq("id", editingRule.id);
      toast.success("Updated");
    } else {
      await supabase.from("tax_rules").insert(ruleForm);
      toast.success("Created");
    }
    setSaving(false); setRuleDialog(false); fetchAll();
  };

  const BoolIcon = ({ val }: { val: boolean }) => val ? <Check className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4 text-destructive" />;

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Sales Tax</h2>
      </div>

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
                      await supabase.from("tax_rules").delete().eq("id", r.id); fetchAll();
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button size="sm" className="mt-3 gap-1" onClick={() => {
            setEditingRule(null);
            setRuleForm({ tax_class_id: classes[0]?.id ?? "", tax_customer_group_id: groups[0]?.id ?? "", tax_rate_id: rates[0]?.id ?? "" });
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
                        await supabase.from("tax_classes").delete().eq("id", c.id); fetchAll();
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
                        await supabase.from("tax_customer_groups").delete().eq("id", g.id); fetchAll();
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
                        await supabase.from("tax_rates").delete().eq("id", r.id); fetchAll();
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
            <div><Label>Rate</Label><Input type="number" step="0.1" value={rateForm.percentual} onChange={e => setRateForm({ ...rateForm, percentual: parseFloat(e.target.value) || 0 })} /></div>
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
              <Select value={ruleForm.tax_class_id} onValueChange={v => setRuleForm({ ...ruleForm, tax_class_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
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
