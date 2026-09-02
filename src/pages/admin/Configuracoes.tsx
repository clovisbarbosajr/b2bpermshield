import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { EnderecoWebhookStripe } from "@/components/EnderecoWebhookStripe";
import { Save, Building2, Mail, Palette, FileText, CreditCard, Eye, EyeOff } from "lucide-react";

// Só os campos que ESTA página edita. Antes gravava a linha inteira (spread),
// revertendo settings de OUTRAS páginas (warehouse, templates, recipients) por
// lost-update e re-persistindo segredos à toa.
//
// `satisfies (keyof TablesUpdate<"configuracoes">)[]` faz o `tsc` recusar campo
// que não existe no schema. Sem isso a lista era só string e o payload era
// `any`: `allow_order_without_payment` estava aqui, NÃO existe na tabela, e
// bastava o admin mexer naquele checkbox para o PGRST204 derrubar o Save
// INTEIRO da página — nome da empresa, chaves do Stripe, tudo junto.
const SAVE_FIELDS = [
  "nome_empresa", "email_contato", "telefone_contato", "endereco", "logo_url",
  "cor_primaria", "cor_secundaria", "moeda", "fuso_horario", "pedido_minimo",
  "mensagem_boas_vindas", "politica_privacidade", "termos_condicoes",
  "permite_cadastro_aberto",
  "email_provider", "email_api_key", "email_from", "email_reply_to",
  "stripe_enabled", "stripe_publishable_key", "stripe_secret_key", "stripe_webhook_secret",
  "email_on_new_registration", "email_on_approval", "email_on_rejection",
  "email_on_new_order", "email_on_order_status",
] as const satisfies readonly (keyof TablesUpdate<"configuracoes">)[];

const AdminConfiguracoes = () => {
  const [config, setConfig] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showStripeSecret, setShowStripeSecret] = useState(false);
  const [showEmailKey, setShowEmailKey] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const fetchData = async () => {
    // `error` LIDO. Sem isso, leitura recusada pela RLS ou queda de rede virava
    // `config = null` e a tela abria com TODOS os campos em branco, calada, como
    // se a configuração do sistema estivesse vazia.
    // Colunas explícitas em vez de `*`: a linha carrega `api_token` (o bearer da
    // edge `api`, que roda com service role), `zapier_password` e
    // `smtp_password` — esta tela não usa nem mostra nenhum deles, não há por
    // que baixá-los para o navegador.
    // `.order(created_at, id)`: a mesma escolha determinística da RPC
    // `config_staff()` (20260825290000). `limit(1)` sem ordenação podia entregar
    // uma linha diferente da que o resto do sistema lê.
    const { data, error } = await supabase
      .from("configuracoes")
      .select(["id", "updated_at", ...SAVE_FIELDS].join(","))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    setLoadError(error ? error.message : data ? null : "No settings row found in the database.");
    setConfig(data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const payload: TablesUpdate<"configuracoes"> = Object.fromEntries(
      SAVE_FIELDS.filter((f) => f in config).map((f) => [f, config[f]]),
    );
    // `.eq("updated_at", ...)` é trava otimista, e ela é o ponto desta tela: o
    // payload leva os 27 campos que estavam na TELA, não só os que o admin
    // mexeu. Dois admins abertos ao mesmo tempo — um na aba Company, outro na
    // aba Payments — e quem salvar por último devolve os campos do outro ao
    // valor que carregou. Essa é a linha ÚNICA que o sistema inteiro lê.
    // Com a trava, a segunda gravação não acha linha e o admin é avisado, em
    // vez de reverter o colega em silêncio. `update_updated_at_column()` roda
    // BEFORE UPDATE em `configuracoes` (20260318182853:117), então o carimbo
    // muda a cada gravação.
    // `.select(...).single()` cobre o outro lado: UPDATE sem linha volta
    // `error: null` com zero linhas, e a tela dizia "Settings saved" por cima
    // de nada gravado.
    const { data: saved, error } = await supabase
      .from("configuracoes").update(payload)
      .eq("id", config.id).eq("updated_at", config.updated_at)
      .select("id, updated_at").single();
    setSaving(false);
    if (error || !saved) {
      // Zero linhas tem DUAS causas e o código não sabe qual — não afirma uma.
      toast.error(
        error?.code === "PGRST116"
          ? "Not saved: these settings changed since you opened this page (or the row is gone). Reload before saving, or you would overwrite someone else's change."
          : "Error saving settings: " + (error?.message ?? "no row was written"),
      );
      return;
    }
    // O carimbo novo entra no estado: sem isso o PRÓXIMO save desta mesma aba
    // compararia com o carimbo velho e acusaria conflito que não existe.
    // Forma funcional de propósito: o `config` desta closure envelheceu durante
    // a ida ao servidor. Espalhar aquele objeto desfaria o que o admin digitou
    // enquanto o save estava no ar — troca-se SÓ o carimbo.
    setConfig((c: any) => ({ ...c, updated_at: saved.updated_at }));
    toast.success("Settings saved");
  };

  const update = (key: string, value: any) => setConfig({ ...config, [key]: value });

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          type: "raw",
          to: config?.email_contato || "",
          subject: "Test Email — PermShield",
          html: "<h1>Email service is working!</h1><p>This is a test message from your PermShield B2B portal.</p>",
        },
      });
      if (error) throw error;
      if (data?.success) toast.success("Test email sent! Check your inbox.");
      else throw new Error(data?.error || "Failed to send");
    } catch (err: any) {
      toast.error("Email test failed: " + (err.message || "Unknown error"));
    }
    setTestingEmail(false);
  };

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  // Falha fechado: sem a configuração lida não se mostra o formulário. Um form
  // em branco convida o admin a redigitar por cima do que ninguém leu.
  if (loadError) return (
    <AdminLayout>
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="font-semibold">Settings could not be loaded — nothing is being shown or saved.</p>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); fetchData(); }}>Retry</Button>
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Settings</h2>
        <Button onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="company"><Building2 className="h-4 w-4 mr-1" /> Company</TabsTrigger>
          <TabsTrigger value="notifications"><Mail className="h-4 w-4 mr-1" /> Email</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1" /> Payments</TabsTrigger>
          <TabsTrigger value="appearance"><Palette className="h-4 w-4 mr-1" /> Appearance</TabsTrigger>
          <TabsTrigger value="policies"><FileText className="h-4 w-4 mr-1" /> Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <Card>
            <CardHeader><CardTitle className="text-base">Company Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Company Name</Label><Input value={config?.nome_empresa ?? ""} onChange={(e) => update("nome_empresa", e.target.value)} /></div>
                <div><Label>Contact Email</Label><Input type="email" value={config?.email_contato ?? ""} onChange={(e) => update("email_contato", e.target.value)} /></div>
                <div><Label>Phone</Label><Input value={config?.telefone_contato ?? ""} onChange={(e) => update("telefone_contato", e.target.value)} /></div>
                <div><Label>Currency</Label><Input value={config?.moeda ?? "USD"} onChange={(e) => update("moeda", e.target.value)} /></div>
                <div><Label>Timezone</Label><Input value={config?.fuso_horario ?? ""} onChange={(e) => update("fuso_horario", e.target.value)} /></div>
                <div><Label>Minimum Order Value</Label><Input type="number" step="0.01" value={config?.pedido_minimo ?? 0} onChange={(e) => update("pedido_minimo", parseFloat(e.target.value) || 0)} /></div>
              </div>
              <div><Label>Address</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} value={config?.endereco ?? ""} onChange={(e) => update("endereco", e.target.value)} /></div>
              <div><Label>Logo URL</Label><Input value={config?.logo_url ?? ""} onChange={(e) => update("logo_url", e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config?.permite_cadastro_aberto ?? true} onChange={(e) => update("permite_cadastro_aberto", e.target.checked)} />
                Allow open registration (customers can self-register)
              </label>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EMAIL SETTINGS */}
        <TabsContent value="notifications">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Service</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connect your email service to send transactional emails: customer approval, password reset, new order notifications.
                  Supports <strong>SMTP</strong> (Office 365, Gmail, etc.), <strong>Resend</strong>, and <strong>SendGrid</strong>.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Email Service Provider</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={config?.email_provider ?? ""}
                      onChange={(e) => update("email_provider", e.target.value)}
                    >
                      <option value="">— Not configured —</option>
                      <option value="smtp">SMTP (Office 365, Gmail, etc.)</option>
                      <option value="resend">Resend (resend.com)</option>
                      <option value="sendgrid">SendGrid</option>
                    </select>
                  </div>
                  <div>
                    <Label>From (display name + email)</Label>
                    <Input
                      placeholder="PermShield B2B <automated@wiseitsolutions.us>"
                      value={config?.email_from ?? ""}
                      onChange={(e) => update("email_from", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Format: <code>Name &lt;email@domain.com&gt;</code> or just <code>email@domain.com</code>
                    </p>
                  </div>

                  {config?.email_provider === "smtp" && (
                    <>
                      <div className="sm:col-span-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-blue-300">
                        <strong>SMTP credentials are stored securely</strong> as backend secrets — never in the code or database.
                        Configure them below, then click <em>Save SMTP Secrets</em>.
                      </div>
                      <div>
                        <Label>Reply-To Email</Label>
                        <Input
                          type="email"
                          placeholder="contact@yourcompany.com"
                          value={config?.email_reply_to ?? ""}
                          onChange={(e) => update("email_reply_to", e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {config?.email_provider && config.email_provider !== "smtp" && (
                    <div className="sm:col-span-2">
                      <Label>API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          type={showEmailKey ? "text" : "password"}
                          placeholder="re_xxxx... or SG.xxxx..."
                          value={config?.email_api_key ?? ""}
                          onChange={(e) => update("email_api_key", e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Button variant="outline" size="icon" onClick={() => setShowEmailKey(!showEmailKey)}>
                          {showEmailKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Resend: create a key at resend.com/api-keys. SendGrid: create at app.sendgrid.com/settings/api_keys
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    <Save className="h-3 w-3 mr-1" /> Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testingEmail || !config?.email_from || (!config?.email_api_key && config?.email_provider !== "smtp")}
                    onClick={handleTestEmail}
                  >
                    {/* "saved settings" não é enfeite: a edge `send-email` lê
                        `email_provider`/`email_api_key` da TABELA com service
                        role (send-email/index.ts:710-715). Chave digitada e não
                        salva não é a que está sendo testada — e o botão liga
                        pelo valor digitado, então dava para testar uma chave e
                        receber o veredito de outra. */}
                    {testingEmail ? "Sending..." : "Send Test Email (uses saved settings)"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Notification Triggers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">These emails are sent automatically when the corresponding event occurs (requires email service configured above).</p>
                {[
                  { key: "email_on_new_registration", label: "New customer registration — notify admin" },
                  { key: "email_on_approval", label: "Customer approved — notify customer" },
                  { key: "email_on_rejection", label: "Customer rejected — notify customer" },
                  { key: "email_on_new_order", label: "New order placed — notify admin" },
                  { key: "email_on_order_status", label: "Order status changed — notify customer" },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config?.[key] ?? true}
                      onChange={(e) => update(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Welcome Message</CardTitle></CardHeader>
              <CardContent>
                <div><Label>Welcome Message</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" rows={3} value={config?.mensagem_boas_vindas ?? ""} onChange={(e) => update("mensagem_boas_vindas", e.target.value)} placeholder="Displayed to new clients after registration..." /></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* PAYMENT SETTINGS (STRIPE) */}
        <TabsContent value="payments">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stripe Integration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connect Stripe to accept credit card payments directly in the checkout. Once configured, customers will see a "Pay by Card" option at checkout.
                </p>

                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-blue-300">
                  <strong>How to get your keys:</strong> Log in at stripe.com → Developers → API keys. Use <em>Publishable key</em> (starts with <code>pk_</code>) and <em>Secret key</em> (starts with <code>sk_</code>).
                  Use <code>pk_test_</code> and <code>sk_test_</code> for testing.
                </div>

                <div className="grid gap-4">
                  <div>
                    <Label>Publishable Key (pk_live_... or pk_test_...)</Label>
                    <Input
                      placeholder="pk_live_xxxxxxxxxxxx"
                      value={config?.stripe_publishable_key ?? ""}
                      onChange={(e) => update("stripe_publishable_key", e.target.value)}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">This key is safe to expose — it's used on the client side to show the card form.</p>
                  </div>

                  <div>
                    <Label>Secret Key (sk_live_... or sk_test_...)</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showStripeSecret ? "text" : "password"}
                        placeholder="sk_live_xxxxxxxxxxxx"
                        value={config?.stripe_secret_key ?? ""}
                        onChange={(e) => update("stripe_secret_key", e.target.value)}
                        className="flex-1 font-mono text-sm"
                      />
                      <Button variant="outline" size="icon" onClick={() => setShowStripeSecret(!showStripeSecret)}>
                        {showStripeSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Keep this secret. It's used server-side only to create payment intents.</p>
                  </div>

                  <div>
                    <Label>Webhook Secret (whsec_... — optional)</Label>
                    <Input
                      placeholder="whsec_xxxxxxxxxxxx"
                      value={config?.stripe_webhook_secret ?? ""}
                      onChange={(e) => update("stripe_webhook_secret", e.target.value)}
                      className="font-mono text-sm"
                    />
                    {/* Endereço DITADO ao operador: ele copia daqui e cola no
                        painel da Stripe. Se não soubermos o host, não se inventa
                        um — URL errada aqui não dá erro em lugar nenhum, só faz
                        o webhook morrer calado. */}
                    <EnderecoWebhookStripe supabaseUrl={import.meta.env.VITE_SUPABASE_URL} />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    <Save className="h-3 w-3 mr-1" /> Save Keys
                  </Button>
                  {config?.stripe_publishable_key && (
                    <span className="text-xs text-green-400">
                      {config.stripe_publishable_key.startsWith("pk_live_") ? "✓ Live mode" : "✓ Test mode"}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Payment Options</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Configure which payment methods customers can choose at checkout. Manage payment option names and instructions at Settings → Payment Options.</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={config?.stripe_enabled ?? false} onChange={(e) => update("stripe_enabled", e.target.checked)} />
                  Enable Stripe card payments at checkout (requires keys above)
                </label>
                {/* O checkbox "Allow orders without immediate payment" saiu daqui:
                    `allow_order_without_payment` não existe em `configuracoes`
                    (types.ts) e NENHUM código lia essa coluna — nem o front, nem
                    a edge. Prometia governar o checkout sem governar nada, e
                    quebrava o Save da página inteira com PGRST204. Se o dono
                    quiser a regra de verdade, ela precisa de coluna + leitor no
                    Checkout. */}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader><CardTitle className="text-base">Branding</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input value={config?.cor_primaria ?? ""} onChange={(e) => update("cor_primaria", e.target.value)} placeholder="#1a3a6b" />
                    {config?.cor_primaria && <div className="h-10 w-10 rounded border" style={{ backgroundColor: config.cor_primaria }} />}
                  </div>
                </div>
                <div>
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input value={config?.cor_secundaria ?? ""} onChange={(e) => update("cor_secundaria", e.target.value)} placeholder="#e67e22" />
                    {config?.cor_secundaria && <div className="h-10 w-10 rounded border" style={{ backgroundColor: config.cor_secundaria }} />}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies">
          <Card>
            <CardHeader><CardTitle className="text-base">Terms & Policies</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Terms & Conditions</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={6} value={config?.termos_condicoes ?? ""} onChange={(e) => update("termos_condicoes", e.target.value)} /></div>
              <div><Label>Privacy Policy</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={6} value={config?.politica_privacidade ?? ""} onChange={(e) => update("politica_privacidade", e.target.value)} /></div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default AdminConfiguracoes;
