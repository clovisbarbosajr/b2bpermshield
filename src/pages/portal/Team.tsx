import { useState, useEffect } from "react";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Member = { id: string; nome: string; email: string; role: string; ativo: boolean; created_at: string };

const ROLE_LABEL: Record<string, string> = {
  buyer: "Can place orders",
  viewer: "View only (cannot order)",
  manager: "Manager (orders + team)",
};

const Team = () => {
  const { contactRole } = useAuth();
  const canManage = !contactRole || contactRole === "manager";

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", role: "buyer" });

  const load = async () => {
    const { data, error } = await supabase.functions.invoke("company-member", { body: { action: "list" } });
    if (error) toast.error(error.message);
    else setMembers(data?.members ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const addMember = async () => {
    if (!form.email || !form.email.includes("@")) { toast.error("Valid email required"); return; }
    if (!form.nome) { toast.error("Name required"); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("company-member", {
      body: { action: "create", email: form.email.trim().toLowerCase(), nome: form.nome.trim(), role: form.role, redirectTo: `${window.location.origin}/reset-password` },
    });
    setSaving(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Failed"); return; }
    toast.success(data?.mailOk
      ? `${form.nome} added — a setup email was sent.`
      : `${form.nome} added, but the setup email failed. They can use "Forgot password" to set it.`);
    setForm({ nome: "", email: "", role: "buyer" });
    load();
  };

  const updateRole = async (m: Member, role: string) => {
    const { error } = await supabase.functions.invoke("company-member", { body: { action: "update", contact_id: m.id, role } });
    if (error) { toast.error(error.message); return; }
    setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, role } : x));
  };

  const removeMember = async (m: Member) => {
    if (!confirm(`Remove ${m.nome}'s access?`)) return;
    const { error } = await supabase.functions.invoke("company-member", { body: { action: "delete", contact_id: m.id } });
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
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-muted-foreground">Add employees who can log in for your company. They share your account's pricing and catalog access.</p>
      </div>

      <Card className="p-5 mb-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><UserPlus className="h-4 w-4" /> Add employee</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div><Label>Name</Label><Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div>
            <Label>Permission</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buyer">Can place orders</SelectItem>
                <SelectItem value="viewer">View only (cannot order)</SelectItem>
                <SelectItem value="manager">Manager (orders + team)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addMember} disabled={saving} className="gap-1"><UserPlus className="h-4 w-4" /> {saving ? "Adding..." : "Add"}</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Permission</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : members.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No employees yet.</TableCell></TableRow>
            ) : members.map((m) => (
              <TableRow key={m.id} className={m.ativo ? "" : "opacity-50"}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  {m.ativo ? (
                    <Select value={m.role} onValueChange={(v) => updateRole(m, v)}>
                      <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buyer">Can place orders</SelectItem>
                        <SelectItem value="viewer">View only (cannot order)</SelectItem>
                        <SelectItem value="manager">Manager (orders + team)</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{ROLE_LABEL[m.role] ?? m.role}</span>
                  )}
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
