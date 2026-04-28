import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Save, Info } from "lucide-react";

const DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const WarehouseSettings = () => {
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    warehouse_popup_enabled:      true,
    warehouse_popup_message:      "",
    warehouse_popup_day:          1,
    warehouse_inactivity_popup:   5,
    warehouse_inactivity_default: 480,
  });

  const fetchData = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("configuracoes")
      .select("id, warehouse_popup_enabled, warehouse_popup_message, warehouse_popup_day, warehouse_inactivity_popup, warehouse_inactivity_default")
      .limit(1)
      .maybeSingle();
    if (data) {
      setConfigId(data.id);
      setForm({
        warehouse_popup_enabled:      data.warehouse_popup_enabled  ?? true,
        warehouse_popup_message:      data.warehouse_popup_message  ?? "It's Monday! Please make sure inventory levels are up to date before starting your shift.",
        warehouse_popup_day:          data.warehouse_popup_day      ?? 1,
        warehouse_inactivity_popup:   data.warehouse_inactivity_popup   ?? 5,
        warehouse_inactivity_default: data.warehouse_inactivity_default ?? 480,
      });
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const update = (key: keyof typeof form, value: any) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!configId) { toast.error("Configuration not found."); return; }
    if (form.warehouse_inactivity_popup < 1) {
      toast.error("Inactivity timeout on popup day must be at least 1 minute."); return;
    }
    if (form.warehouse_inactivity_default < 1) {
      toast.error("Default inactivity timeout must be at least 1 minute."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("configuracoes").update({
      warehouse_popup_enabled:      form.warehouse_popup_enabled,
      warehouse_popup_message:      form.warehouse_popup_message || null,
      warehouse_popup_day:          form.warehouse_popup_day,
      warehouse_inactivity_popup:   form.warehouse_inactivity_popup,
      warehouse_inactivity_default: form.warehouse_inactivity_default,
    }).eq("id", configId);
    if (error) { toast.error("Error saving: " + error.message); }
    else { toast.success("Warehouse settings saved."); }
    setSaving(false);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Warehouse Settings</h2>
        <Button onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* ── Popup configuration ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Login Popup Reminder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex gap-2 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                When enabled, warehouse users will see a mandatory confirmation popup on the selected day.
                They must check the checkbox and confirm before they can use the system.
                The popup reappears on every login on that day.
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="popup-enabled"
                checked={form.warehouse_popup_enabled}
                onChange={e => update("warehouse_popup_enabled", e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
              <Label htmlFor="popup-enabled" className="cursor-pointer">
                Enable popup reminder for warehouse users
              </Label>
            </div>

            <div>
              <Label>Day to show popup</Label>
              <Select
                value={String(form.warehouse_popup_day)}
                onValueChange={v => update("warehouse_popup_day", Number(v))}
                disabled={!form.warehouse_popup_enabled}
              >
                <SelectTrigger className="mt-1 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Popup message</Label>
              <Textarea
                className="mt-1 min-h-[100px] text-sm"
                value={form.warehouse_popup_message}
                onChange={e => update("warehouse_popup_message", e.target.value)}
                disabled={!form.warehouse_popup_enabled}
                placeholder="Message displayed in the popup..."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This text appears in the popup body. Keep it short and actionable.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Inactivity timeout ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inactivity Auto-Logout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Warehouse users are automatically logged out after a period of inactivity.
              Inactivity is detected when there is no mouse movement, click, scroll or keypress.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>
                  Timeout on popup day ({DAYS.find(d => d.value === String(form.warehouse_popup_day))?.label})
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={480}
                    value={form.warehouse_inactivity_popup}
                    onChange={e => update("warehouse_inactivity_popup", Number(e.target.value))}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Recommended: 5 min</p>
              </div>

              <div>
                <Label>Timeout on other days</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={form.warehouse_inactivity_default}
                    onChange={e => update("warehouse_inactivity_default", Number(e.target.value))}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Recommended: 480 min (8 hours)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── How to manage warehouse users ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Managing Warehouse Users</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              To <strong className="text-foreground">create</strong> a warehouse user: go to{" "}
              <strong className="text-foreground">Settings → Users</strong> and click{" "}
              <strong className="text-foreground">Create user</strong>, then select the{" "}
              <strong className="text-foreground">Warehouse</strong> role.
            </p>
            <p>
              To <strong className="text-foreground">edit email or password</strong> of a warehouse user:
              use Supabase Dashboard → Authentication → Users, or create a new user and remove the old one.
            </p>
            <p>
              To <strong className="text-foreground">remove warehouse access</strong>: go to{" "}
              <strong className="text-foreground">Settings → Users</strong> and click the delete icon next
              to the user. This removes their system access without deleting the auth account.
            </p>
            <p>
              Warehouse users can access: <strong className="text-foreground">Orders, Customers, Products (create/edit/delete)</strong>.
              They cannot access: Logs, User management, Settings, Reports, or Price Lists.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default WarehouseSettings;
