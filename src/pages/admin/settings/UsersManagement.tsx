import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pencil } from "lucide-react";
import { PERMISSION_GROUPS, DEFAULT_PERMISSIONS, type PermissionKey } from "@/lib/permissions";

type StaffRole = "admin" | "manager" | "warehouse";

type StaffUser = {
  user_id: string;
  email: string;
  nome: string | null;
  role: StaffRole;
  permissions: Record<string, boolean>;
  created_at: string;
  last_sign_in_at: string | null;
};

const ROLE_BADGE: Record<StaffRole, { label: string; className: string }> = {
  admin:     { label: "Admin",     className: "bg-primary/10 text-primary border-0 text-xs" },
  manager:   { label: "Manager",   className: "bg-purple-100 text-purple-800 border-0 text-xs dark:bg-purple-900/30 dark:text-purple-400" },
  warehouse: { label: "Warehouse", className: "bg-amber-100 text-amber-800 border-0 text-xs dark:bg-amber-900/30 dark:text-amber-400" },
};

const UsersManagement = () => {
  const [allUsers, setAllUsers] = useState<StaffUser[]>([]);
  const [filtered, setFiltered] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", nome: "", password: "", role: "warehouse" as StaffRole });
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState<StaffRole>("warehouse");
  const [editPassword, setEditPassword] = useState("");
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role, permissions")
      .in("role", ["admin", "manager", "warehouse"] as any[]);

    if (!roles || roles.length === 0) {
      setAllUsers([]);
      setFiltered([]);
      setLoading(false);
      return;
    }

    const userIds = (roles as any[]).map((r: any) => r.user_id);

    const { data: staffData } = await supabase.functions.invoke("admin-create-user", {
      body: { action: "list_staff", user_ids: userIds },
    });

    const authMap: Record<string, any> = {};
    (staffData?.users ?? []).forEach((u: any) => { authMap[u.id] = u; });

    const users: StaffUser[] = (roles as any[]).map((r: any) => {
      const u = authMap[r.user_id];
      return {
        user_id:         r.user_id,
        email:           u?.email ?? "—",
        nome:            u?.nome || null,
        role:            r.role as StaffRole,
        permissions:     (r as any).permissions || {},
        created_at:      u?.created_at ?? new Date().toISOString(),
        last_sign_in_at: u?.last_sign_in_at ?? null,
      };
    });

    setAllUsers(users);
    setFiltered(users);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSearch = () => {
    let result = allUsers;
    if (searchName.trim()) result = result.filter(u => (u.nome ?? "").toLowerCase().includes(searchName.toLowerCase()));
    if (searchEmail.trim()) result = result.filter(u => u.email.toLowerCase().includes(searchEmail.toLowerCase()));
    setFiltered(result);
  };

  const handleDelete = async (u: StaffUser) => {
    if (!confirm(`Remove access for ${u.nome || u.email}?\nThis removes their role — their login account is kept.`)) return;
    await supabase.from("user_roles").delete().eq("user_id", u.user_id);
    toast.success("Access removed");
    fetchData();
  };

  const openEdit = (u: StaffUser) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditPassword("");
    // Merge stored permissions with defaults for the role (in case new perms were added)
    const defaults = u.role !== "admin" ? (DEFAULT_PERMISSIONS[u.role as "manager" | "warehouse"] || {}) : {};
    setEditPerms({ ...defaults, ...u.permissions });
    setEditOpen(true);
  };

  const handleRoleChange = (newRole: StaffRole) => {
    setEditRole(newRole);
    if (newRole !== "admin") {
      const defaults = DEFAULT_PERMISSIONS[newRole as "manager" | "warehouse"] || {};
      setEditPerms({ ...defaults, ...(editUser?.permissions || {}) });
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setSaving(true);

    // Update role and permissions
    const updatePayload: any = { user_id: editUser.user_id, role: editRole };
    if (editRole !== "admin") {
      updatePayload.permissions = editPerms;
    } else {
      updatePayload.permissions = {};
    }

    await (supabase.from("user_roles") as any).upsert(updatePayload, { onConflict: "user_id" });

    // Update password if provided
    if (editPassword.trim().length > 0) {
      if (editPassword.trim().length < 6) {
        toast.error("Password must be at least 6 characters");
        setSaving(false);
        return;
      }
      const { data: pwData } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "update_password", user_id: editUser.user_id, new_password: editPassword.trim() },
      });
      if (pwData?.error) {
        toast.error(pwData.error);
        setSaving(false);
        return;
      }
    }

    toast.success("User updated");
    setSaving(false);
    setEditOpen(false);
    fetchData();
  };

  const handleCreateUser = async () => {
    if (!createForm.email.trim()) { toast.error("Email required"); return; }
    if (!createForm.password.trim() || createForm.password.length < 6) {
      toast.error("Password must be at least 6 characters"); return;
    }
    setCreating(true);

    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email:    createForm.email.trim(),
        nome:     createForm.nome.trim() || "",
        password: createForm.password,
      },
    });

    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Error creating user");
      setCreating(false);
      return;
    }

    const userId = data.user_id;
    const defaultPerms = createForm.role !== "admin"
      ? DEFAULT_PERMISSIONS[createForm.role as "manager" | "warehouse"]
      : {};

    await (supabase.from("user_roles") as any).upsert(
      { user_id: userId, role: createForm.role, permissions: defaultPerms },
      { onConflict: "user_id" }
    );

    toast.success(`${createForm.role.charAt(0).toUpperCase() + createForm.role.slice(1)} user created`);
    setCreating(false);
    setCreateOpen(false);
    setCreateForm({ email: "", nome: "", password: "", role: "warehouse" });
    fetchData();
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    return `${dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })} ${dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  };

  const togglePerm = (key: string, val: boolean) => {
    setEditPerms(p => ({ ...p, [key]: val }));
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Users</h2>
      </div>

      {/* Search */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div>
            <Label>Full Name</Label>
            <Input value={searchName} onChange={e => setSearchName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={searchEmail} onChange={e => setSearchEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} />
          </div>
        </div>
        <Button onClick={handleSearch} className="gap-1" size="sm">
          <Search className="h-4 w-4" /> Search
        </Button>
      </Card>

      <Button onClick={() => setCreateOpen(true)} className="mb-3 gap-1 bg-cyan-600 hover:bg-cyan-700" size="sm">
        <Plus className="h-4 w-4" /> Create user
      </Button>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Admin: full access. Manager: full access except Activity Logs (default). Warehouse: products, customers &amp; orders only (default).
          </p>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>
                    Created<br />
                    <span className="font-normal text-muted-foreground text-xs">Last Login</span>
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : filtered.map(u => {
                  const badge = ROLE_BADGE[u.role] ?? ROLE_BADGE["admin"];
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell className="font-medium text-primary">{u.nome || "—"}</TableCell>
                      <TableCell className="text-primary text-sm">{u.email}</TableCell>
                      <TableCell>
                        <Badge className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-pre-line">
                        {fmtDate(u.created_at)}{"\n"}{fmtDate(u.last_sign_in_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(u)}
                            title="Remove access"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* ── Create User Dialog ───────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Role *</Label>
              <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v as StaffRole }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access to everything</SelectItem>
                  <SelectItem value="manager">Manager — full access except Activity Logs (default)</SelectItem>
                  <SelectItem value="warehouse">Warehouse — products, customers &amp; orders only (default)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {createForm.role === "warehouse" && "Monday popup and inactivity logout apply to this role."}
                {createForm.role === "manager" && "Permissions can be customized after creation by clicking Edit."}
                {createForm.role === "admin" && "Admin has unrestricted access. No permission customization available."}
              </p>
            </div>
            <div>
              <Label>Email *</Label>
              <Input value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} type="email" placeholder="user@company.com" />
            </div>
            <div>
              <Label>Full Name</Label>
              <Input value={createForm.nome} onChange={e => setCreateForm(f => ({ ...f, nome: e.target.value }))} placeholder="Optional" />
            </div>
            <div>
              <Label>Password *</Label>
              <Input value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} type="password" placeholder="Min. 6 characters" />
            </div>
            <Button onClick={handleCreateUser} disabled={creating} className="w-full gap-1">
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "Create User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            {/* Role */}
            <div>
              <Label>Role</Label>
              <Select value={editRole} onValueChange={v => handleRoleChange(v as StaffRole)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access to everything</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="warehouse">Warehouse</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Permissions — only for manager and warehouse */}
            {editRole !== "admin" && (
              <div>
                <Label className="mb-2 block">Permissions</Label>
                <div className="space-y-4 rounded-md border p-4">
                  {PERMISSION_GROUPS.map(group => (
                    <div key={group.group}>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">{group.group}</p>
                      <div className="space-y-1.5">
                        {group.keys.map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editPerms[key] === true}
                              onChange={e => togglePerm(key, e.target.checked)}
                              className="h-4 w-4 rounded"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Password reset */}
            <div>
              <Label>New Password</Label>
              <Input
                value={editPassword}
                onChange={e => setEditPassword(e.target.value)}
                type="password"
                placeholder="Leave blank to keep current password"
              />
              <p className="text-xs text-muted-foreground mt-1">Min. 6 characters. Leave blank to keep unchanged.</p>
            </div>

            <Button onClick={handleSaveEdit} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default UsersManagement;
