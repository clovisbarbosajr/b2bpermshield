import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Eye, EyeOff } from "lucide-react";

const SCOPES = [
  { key: "order_list", label: "Order List" },
  { key: "order_edit", label: "Order Edit" },
  { key: "product_list", label: "Product List" },
  { key: "product_edit", label: "Product Edit" },
  { key: "prices_list", label: "Prices List" },
  { key: "prices_edit", label: "Prices Edit" },
  { key: "customer_list", label: "Customer List" },
  { key: "customer_edit", label: "Customer Edit" },
];

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = "bj_";
  const body = Array.from(crypto.getRandomValues(new Uint8Array(40)))
    .map((b) => chars[b % chars.length])
    .join("");
  return prefix + body;
}

const ApiKeys = () => {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", allowed_ips: "", ativo: true, scopes: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const fetchKeys = async () => {
    const { data } = await supabase.from("api_keys").select("*").order("created_at", { ascending: false });
    setKeys(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const toggleScope = (scope: string) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope],
    }));
  };

  const allScopes = () => {
    const all = SCOPES.map((s) => s.key);
    setForm((f) => ({ ...f, scopes: f.scopes.length === all.length ? [] : all }));
  };

  const handleGenerate = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    const key = generateApiKey();
    const { error } = await supabase.from("api_keys").insert({
      name: form.name,
      key_value: key,
      allowed_ips: form.allowed_ips || null,
      ativo: form.ativo,
      scopes: form.scopes,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setNewKeyValue(key);
    setDialogOpen(false);
    fetchKeys();
    toast.success("API key generated");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this API key? This cannot be undone.")) return;
    await supabase.from("api_keys").delete().eq("id", id);
    fetchKeys();
    toast.success("Key deleted");
  };

  const handleToggleActive = async (key: any) => {
    await supabase.from("api_keys").update({ ativo: !key.ativo }).eq("id", key.id);
    fetchKeys();
  };

  const copyKey = (val: string) => {
    navigator.clipboard.writeText(val);
    toast.success("Copied to clipboard");
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">API Keys</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage API keys for third-party integrations. Keys are shown only once at creation.
          </p>
        </div>
        <Button className="gap-1" onClick={() => { setForm({ name: "", allowed_ips: "", ativo: true, scopes: [] }); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> Generate Key
        </Button>
      </div>

      {/* New key banner */}
      {newKeyValue && (
        <Card className="mb-4 border-green-500/30 bg-green-500/10 p-4">
          <p className="text-sm font-semibold text-green-400 mb-2">New API Key — copy it now, it won't be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-background px-3 py-2 text-xs font-mono break-all">{newKeyValue}</code>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => copyKey(newKeyValue)}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setNewKeyValue(null)}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : keys.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p>No API keys yet. Generate one to allow external applications to interact with your B2B portal.</p>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Allowed IPs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <code className="text-xs font-mono">
                        {revealed[k.id] ? k.key_value : `${k.key_value?.slice(0, 10)}...`}
                      </code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))}>
                        {revealed[k.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyKey(k.key_value)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {k.scopes?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(k.scopes as string[]).map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s.replace("_", " ")}</Badge>
                        ))}
                      </div>
                    ) : "All"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.allowed_ips || "Any"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={k.ativo ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => handleToggleActive(k)}
                    >
                      {k.ativo ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(k.created_at).toLocaleDateString("en-US")}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(k.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Generate dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Name / Description *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Mobile App, ERP Integration" />
            </div>
            <div>
              <Label>Allowed IP Addresses (optional)</Label>
              <Input value={form.allowed_ips} onChange={(e) => setForm((f) => ({ ...f, allowed_ips: e.target.value }))} placeholder="e.g. 192.168.1.1, 10.0.0.0/24" />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: !!v }))} /> Active
              </label>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Scope</Label>
                <button onClick={allScopes} className="text-xs text-accent hover:underline">
                  {form.scopes.length === SCOPES.length ? "Deselect All" : "Select All"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SCOPES.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.scopes.includes(s.key)} onCheckedChange={() => toggleScope(s.key)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={handleGenerate} disabled={saving} className="w-full gap-1">
              <Plus className="h-4 w-4" />
              {saving ? "Generating..." : "Generate Key"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default ApiKeys;
