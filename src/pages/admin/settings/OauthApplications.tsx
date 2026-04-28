import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Key, Copy, Check, X } from "lucide-react";

// Our app domain — all OAuth callbacks point here, not to b2bwave
const OUR_APP_URL = "https://b2bpermshield.vercel.app";
const OUR_OAUTH_SCHEME = "com.permshield://oauth";

// Generate a random hex string of `bytes` bytes
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

// client_id: 32 hex chars (like a UUID without dashes)
function genClientId(): string {
  return randomHex(16);
}

// client_secret: 64 hex chars
function genClientSecret(): string {
  return randomHex(32);
}

const OauthApplications = () => {
  const [items, setItems]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [listView, setListView]   = useState(true);
  const [editing, setEditing]     = useState<any>(null);
  const [saving, setSaving]       = useState(false);
  const [credentialsApp, setCredentialsApp] = useState<any>(null);
  const [revealSecret, setRevealSecret]     = useState(false);

  const defaultForm = {
    nome: "",
    redirect_uri: OUR_OAUTH_SCHEME,
    logout_url: "",
    confidential: false,
    skip_authorization: false,
    scopes: "",
    ativo: true,
  };
  const [form, setForm] = useState(defaultForm);

  const fetchData = async () => {
    const { data } = await (supabase.from("oauth_applications") as any)
      .select("*")
      .order("created_at");
    setItems(data ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(defaultForm);
    setListView(false);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      nome:               r.nome ?? "",
      redirect_uri:       r.redirect_uri ?? OUR_OAUTH_SCHEME,
      logout_url:         r.logout_url ?? "",
      confidential:       r.confidential ?? false,
      skip_authorization: r.skip_authorization ?? false,
      scopes:             r.scopes ?? "",
      ativo:              r.ativo ?? true,
    });
    setListView(false);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Name is required"); return; }
    setSaving(true);

    let error: any;
    if (editing) {
      // Update — keep existing client_id/secret
      ({ error } = await (supabase.from("oauth_applications") as any)
        .update({
          nome:               form.nome.trim(),
          redirect_uri:       form.redirect_uri || OUR_OAUTH_SCHEME,
          logout_url:         form.logout_url || null,
          confidential:       form.confidential,
          skip_authorization: form.skip_authorization,
          scopes:             form.scopes || null,
          ativo:              form.ativo,
        })
        .eq("id", editing.id));
      if (!error) toast.success("Updated");
    } else {
      // Create — generate credentials now
      const client_id     = genClientId();
      const client_secret = genClientSecret();
      ({ error } = await (supabase.from("oauth_applications") as any)
        .insert({
          nome:               form.nome.trim(),
          redirect_uri:       form.redirect_uri || OUR_OAUTH_SCHEME,
          logout_url:         form.logout_url || null,
          confidential:       form.confidential,
          skip_authorization: form.skip_authorization,
          scopes:             form.scopes || null,
          ativo:              form.ativo,
          client_id,
          client_secret,
        }));
      if (!error) toast.success("Application created — click the key icon to view credentials");
    }

    if (error) toast.error(error.message);
    setSaving(false);
    if (!error) { setListView(true); fetchData(); }
  };

  const handleDuplicate = async (r: any) => {
    const { id, created_at, updated_at, client_id, client_secret, ...rest } = r;
    await (supabase.from("oauth_applications") as any).insert({
      ...rest,
      nome: `${r.nome} (copy)`,
      client_id:     genClientId(),
      client_secret: genClientSecret(),
    });
    toast.success("Duplicated");
    fetchData();
  };

  const handleDelete = async (r: any) => {
    if (!confirm(`Delete "${r.nome}"?`)) return;
    await (supabase.from("oauth_applications") as any).delete().eq("id", r.id);
    toast.success("Deleted");
    fetchData();
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </AdminLayout>
  );

  // ── Edit / New form ────────────────────────────────────────────────────────
  if (!listView) {
    return (
      <AdminLayout>
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold">
            {editing ? "Edit Oauth Application" : "New Oauth Application"}
          </h2>
        </div>

        <div className="max-w-4xl space-y-5">
          <div>
            <Label className="text-primary text-sm">Name <span className="text-destructive">*</span></Label>
            <Input
              className="mt-1"
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              placeholder="e.g. Sales rep App"
            />
          </div>

          <div>
            <Label className="text-primary text-sm">Redirect URI</Label>
            <Input
              className="mt-1"
              value={form.redirect_uri}
              onChange={e => setForm({ ...form, redirect_uri: e.target.value })}
              placeholder={OUR_OAUTH_SCHEME}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Where to redirect to after the user authorizes access (callback URL).
            </p>
          </div>

          <div>
            <Label className="text-primary text-sm">Logout url</Label>
            <Input
              className="mt-1"
              value={form.logout_url}
              onChange={e => setForm({ ...form, logout_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Provide the logout url of the relying party (RP) so that the user is also logged out from there
              when they initiate a logout from the OpenID Connect Provider (OP).
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={e => setForm({ ...form, ativo: e.target.checked })}
              className="rounded"
            />
            <span className="text-emerald-400 font-medium">Is active</span>
          </label>

          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.confidential}
                onChange={e => setForm({ ...form, confidential: e.target.checked })}
                className="rounded"
              />
              <span className="text-primary font-medium">Confidential</span>
            </label>
            <p className="text-xs text-muted-foreground ml-6 mt-0.5">
              Enforce usage of the client secret key. Check for application with a server component,
              leave unchecked for pure javascript applications that can't guarantee private access to the secret key.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.skip_authorization}
                onChange={e => setForm({ ...form, skip_authorization: e.target.checked })}
                className="rounded"
              />
              <span className="text-primary font-medium">Skip authorization</span>
            </label>
            <p className="text-xs text-muted-foreground ml-6 mt-0.5">
              By default the user will be prompted to explicitly authorize access.
              Check this box if the application is trusted and the prompt can be skipped.
            </p>
          </div>

          <div>
            <Label className="text-primary text-sm">Scopes</Label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.scopes}
              onChange={e => setForm({ ...form, scopes: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Separate scopes with spaces. Leave blank to use the default scopes.
              Supported scopes are: openid email profile.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setListView(true)}>Back</Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? "Saving..." : "Submit"}
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Oauth Applications</h2>
      </div>

      <Button onClick={openNew} className="mb-4 gap-1 bg-emerald-600 hover:bg-emerald-700">
        <Plus className="h-4 w-4" /> New
      </Button>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Redirect URI</TableHead>
              <TableHead>Logout URL</TableHead>
              <TableHead className="text-center">Confidential?</TableHead>
              <TableHead className="text-center">Skip authorization</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  No OAuth applications yet.
                </TableCell>
              </TableRow>
            ) : items.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-primary">{r.nome}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.redirect_uri || "—"}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.logout_url || "—"}</TableCell>
                <TableCell className="text-center">
                  {r.confidential
                    ? <Check className="h-4 w-4 text-emerald-400 mx-auto" />
                    : <X className="h-4 w-4 text-destructive mx-auto" />}
                </TableCell>
                <TableCell className="text-center">
                  {r.skip_authorization
                    ? <Check className="h-4 w-4 text-emerald-400 mx-auto" />
                    : <X className="h-4 w-4 text-destructive mx-auto" />}
                </TableCell>
                <TableCell className="text-center">
                  {r.ativo
                    ? <Check className="h-4 w-4 text-emerald-400 mx-auto" />
                    : <X className="h-4 w-4 text-destructive mx-auto" />}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button size="icon" className="h-8 w-8 bg-cyan-600 hover:bg-cyan-700" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" className="h-8 w-8 bg-amber-600 hover:bg-amber-700" onClick={() => { setCredentialsApp(r); setRevealSecret(false); }}>
                      <Key className="h-4 w-4" />
                    </Button>
                    <Button size="icon" className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleDuplicate(r)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => handleDelete(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Credentials Modal */}
      <Dialog open={!!credentialsApp} onOpenChange={() => setCredentialsApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credentials for {credentialsApp?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-primary text-sm">Client ID</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  readOnly
                  value={credentialsApp?.client_id ?? ""}
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={() => copy(credentialsApp?.client_id ?? "")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-primary text-sm">Secret</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  readOnly
                  type={revealSecret ? "text" : "password"}
                  value={credentialsApp?.client_secret ?? ""}
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={() => setRevealSecret(v => !v)}>
                  {revealSecret ? <X className="h-4 w-4" /> : <Key className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={() => copy(credentialsApp?.client_secret ?? "")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Keep this secret safe. It will not be shown again after you close this dialog.
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setCredentialsApp(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default OauthApplications;
