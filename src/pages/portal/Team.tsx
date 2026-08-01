import { useState, useEffect } from "react";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";

// Sub-usuário no modelo do B2BWave: registro próprio em `clientes`, com 2 permissões.
type Member = {
  id: string; nome: string; email: string;
  can_confirm_order: boolean; can_view_full_history: boolean; ativo: boolean;
};

const Team = () => {
  const { isSubUser, user, impersonatedCustomer } = useAuth();
  const canManage = !isSubUser; // só o dono da conta gerencia a equipe
  // Em "view as" a sessão real é do STAFF — a função precisa saber o alvo explícito,
  // senão o funcionário cai na empresa errada (caso "Nextgen Flooring").
  const target = impersonatedCustomer ? { cliente_id: impersonatedCustomer.id } : {};

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [form, setForm] = useState({ nome: "", email: "", can_confirm_order: false, can_view_full_history: false });

  const load = async () => {
    const { data, error } = await supabase.functions.invoke("company-member", { body: { action: "list", ...target } });
    if (error) toast.error(error.message);
    else setMembers(data?.members ?? []);
    // Nome da EMPRESA DA CONTA logada no título — o header mostra a marca da LOJA,
    // o que já fez funcionário ser adicionado no time da empresa errada por engano.
    if (impersonatedCustomer) {
      setCompanyName(impersonatedCustomer.empresa || impersonatedCustomer.nome || "");
    } else if (user?.id) {
      const { data: me } = await supabase.from("clientes")
        .select("empresa, nome").eq("user_id", user.id).maybeSingle();
      setCompanyName(me?.empresa || me?.nome || "");
    }
    setLoading(false);
  };
  // Depende do ALVO: com `[]` o primeiro load podia rodar antes de `impersonatedCustomer`
  // /`user` resolverem, mandando `target` vazio pra edge function (lista da empresa
  // errada / vazia até um refresh manual).
  useEffect(() => { load(); }, [impersonatedCustomer?.id, user?.id]);

  const addMember = async () => {
    if (!form.email || !form.email.includes("@")) { toast.error("Valid email required"); return; }
    if (!form.nome) { toast.error("Name required"); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("company-member", {
      body: {
        action: "create", email: form.email.trim().toLowerCase(), nome: form.nome.trim(),
        can_confirm_order: form.can_confirm_order, can_view_full_history: form.can_view_full_history,
        redirectTo: `${window.location.origin}/reset-password`,
        ...target,
      },
    });
    setSaving(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Failed"); return; }
    toast.success(data?.mailOk
      ? `${form.nome} added — a setup email was sent.`
      : `${form.nome} added, but the setup email failed. They can use "Forgot password" to set it.`);
    setForm({ nome: "", email: "", can_confirm_order: false, can_view_full_history: false });
    load();
  };

  const toggleFlag = async (m: Member, field: "can_confirm_order" | "can_view_full_history", value: boolean) => {
    setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, [field]: value } : x));
    const { error } = await supabase.functions.invoke("company-member", { body: { action: "update", member_id: m.id, [field]: value, ...target } });
    if (error) { toast.error(error.message); load(); }
  };

  const removeMember = async (m: Member) => {
    if (!confirm(`Remove ${m.nome}'s access?`)) return;
    const { error } = await supabase.functions.invoke("company-member", { body: { action: "delete", member_id: m.id, ...target } });
    if (error) { toast.error(error.message); return; }
    toast.success(`${m.nome} removed`);
    setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, ativo: false } : x));
  };

  if (!canManage) {
    return (
      <PortalLayout>
        <div className="py-20 text-center text-muted-foreground">You don't have permission to manage the team.</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Team{companyName ? ` — ${companyName}` : ""}</h1>
        <p className="text-sm text-muted-foreground">
          Add employees who can log in for <strong>{companyName || "your company"}</strong>.
          They share this account's pricing and catalog access.
        </p>
      </div>

      <Card className="p-5 mb-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><UserPlus className="h-4 w-4" /> Add employee</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div><Label>Name</Label><Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
        </div>
        <div className="flex flex-col gap-2 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.can_confirm_order} onCheckedChange={(v) => setForm((f) => ({ ...f, can_confirm_order: v === true }))} />
            Can confirm orders without approval
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.can_view_full_history} onCheckedChange={(v) => setForm((f) => ({ ...f, can_view_full_history: v === true }))} />
            Can view the full company order history
          </label>
        </div>
        <Button onClick={addMember} disabled={saving} className="gap-1"><UserPlus className="h-4 w-4" /> {saving ? "Adding..." : "Add employee"}</Button>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead>
              <TableHead className="text-center">Confirm orders</TableHead>
              <TableHead className="text-center">Full history</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : members.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No employees yet.</TableCell></TableRow>
            ) : members.map((m) => (
              <TableRow key={m.id} className={m.ativo ? "" : "opacity-50"}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell className="text-center">
                  {m.ativo ? (
                    <Checkbox checked={m.can_confirm_order} onCheckedChange={(v) => toggleFlag(m, "can_confirm_order", v === true)} />
                  ) : (m.can_confirm_order ? <Check className="h-4 w-4 inline text-muted-foreground" /> : "—")}
                </TableCell>
                <TableCell className="text-center">
                  {m.ativo ? (
                    <Checkbox checked={m.can_view_full_history} onCheckedChange={(v) => toggleFlag(m, "can_view_full_history", v === true)} />
                  ) : (m.can_view_full_history ? <Check className="h-4 w-4 inline text-muted-foreground" /> : "—")}
                </TableCell>
                <TableCell>{m.ativo ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Removed</Badge>}</TableCell>
                <TableCell>
                  {m.ativo && (
                    <Button size="icon" variant="ghost" onClick={() => removeMember(m)} title="Remove access">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </PortalLayout>
  );
};

export default Team;
