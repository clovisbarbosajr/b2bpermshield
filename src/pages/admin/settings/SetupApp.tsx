import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save } from "lucide-react";
import qrCodeSvg from "@/assets/qr-permshield-app.svg";

const SetupApp = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from("configuracoes").select("*").limit(1).maybeSingle();
      if (data) {
        setConfig(data);
      } else {
        const { data: newConfig, error } = await supabase.from("configuracoes").insert({}).select().single();
        if (!error) setConfig(newConfig);
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const update = (key: string, value: any) => setConfig({ ...config, [key]: value });

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const { id, created_at, updated_at, ...payload } = config;
    const { error } = await supabase.from("configuracoes").update(payload).eq("id", id);
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Settings saved");
    setSaving(false);
  };

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Setup App</h2>
          <p className="mt-1 text-sm text-muted-foreground">Configure your B2B portal general settings.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Settings"}</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - settings */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold">Company Information</h3>
            <div className="mt-4 space-y-4">
              <div><Label>Company Name</Label><Input value={config?.nome_empresa ?? ""} onChange={(e) => update("nome_empresa", e.target.value)} /></div>
              <div><Label>Contact Email</Label><Input type="email" value={config?.email_contato ?? ""} onChange={(e) => update("email_contato", e.target.value)} /></div>
              <div><Label>Contact Phone</Label><Input value={config?.telefone_contato ?? ""} onChange={(e) => update("telefone_contato", e.target.value)} /></div>
              <div><Label>Address</Label><Input value={config?.endereco ?? ""} onChange={(e) => update("endereco", e.target.value)} /></div>
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="text-lg font-semibold">Branding</h3>
            <div className="mt-4 space-y-4">
              <div><Label>Logo URL</Label><Input value={config?.logo_url ?? ""} onChange={(e) => update("logo_url", e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input value={config?.cor_primaria ?? ""} onChange={(e) => update("cor_primaria", e.target.value)} placeholder="#1a3a6b" />
                    {config?.cor_primaria && <div className="h-10 w-10 rounded border shrink-0" style={{ backgroundColor: config.cor_primaria }} />}
                  </div>
                </div>
                <div>
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input value={config?.cor_secundaria ?? ""} onChange={(e) => update("cor_secundaria", e.target.value)} placeholder="#e67e22" />
                    {config?.cor_secundaria && <div className="h-10 w-10 rounded border shrink-0" style={{ backgroundColor: config.cor_secundaria }} />}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="text-lg font-semibold">Order Settings</h3>
            <div className="mt-4 space-y-4">
              <div><Label>Minimum Order Value</Label><Input type="number" step="0.01" value={config?.pedido_minimo ?? 0} onChange={(e) => update("pedido_minimo", parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Currency</Label><Input value={config?.moeda ?? "USD"} onChange={(e) => update("moeda", e.target.value)} /></div>
              <div><Label>Timezone</Label><Input value={config?.fuso_horario ?? ""} onChange={(e) => update("fuso_horario", e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config?.permite_cadastro_aberto ?? true} onChange={(e) => update("permite_cadastro_aberto", e.target.checked)} />
                Allow open customer registration
              </label>
            </div>
          </Card>
        </div>

        {/* Right column - Mobile App */}
        <div>
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Setup mobile app</h3>
            <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-medium text-foreground">1.</span>
                <span>Download the app:
                  <a href="https://apps.apple.com/us/app/permshield/id6759396326" target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center">
                    <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" className="h-8" />
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-medium text-foreground">2.</span>
                <span>Open the app and scan the QR Code to link your account:</span>
              </li>
            </ol>
            <div className="mt-4 flex justify-center">
              <div className="bg-white p-3 rounded-lg inline-block">
                <img src={qrCodeSvg} alt="QR Code - PermShield App" className="w-48 h-48" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Contact our support team for any questions.</p>
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <p>Use the following information only if you cannot scan the QR code with your phone:</p>
              <p><strong>App Store:</strong>{" "}
                <a href="https://apps.apple.com/us/app/permshield/id6759396326" target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
                  https://apps.apple.com/us/app/permshield/id6759396326
                </a>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
};

export default SetupApp;
