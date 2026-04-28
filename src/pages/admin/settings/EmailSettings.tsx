import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Eye, EyeOff, Pencil, Trash2, Mail, Server, CheckCircle2, Send, Plus, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PROVIDER_LABELS: Record<string, string> = {
  smtp: "SMTP (Office 365, Gmail, etc.)",
  resend: "Resend",
  sendgrid: "SendGrid",
};

const EMAIL_TESTS: { type: string; label: string; description: string }[] = [
  { type: "waiting_approval",       label: "Registration — Waiting for approval",   description: "Sent to customer after creating account" },
  { type: "new_registration_admin", label: "New registration — Admin notification", description: "Sent to admin when a customer registers" },
  { type: "approval",               label: "Account approved",                      description: "Sent to customer when account is approved" },
  { type: "rejection",              label: "Account rejected",                      description: "Sent to customer when account is rejected" },
  { type: "new_order_customer",     label: "New order — Customer confirmation",     description: "Sent to customer after placing an order" },
  { type: "new_order_admin",        label: "New order — Admin notification",        description: "Sent to admin when an order is placed" },
  { type: "order_status_change",    label: "Order status update",                   description: "Sent to customer when order status changes" },
  { type: "raw",                    label: "Generic email (ping)",                  description: "Basic SMTP connectivity test" },
];

/** Build the correct request body for each email type, using the test recipient */
function buildTestBody(type: string, recipientEmail: string): Record<string, any> {
  const SAMPLE_ORDER = { id: "TEST-001", numero: "TEST-001", subtotal: 59.98, total: 59.98 };
  const SAMPLE_CUSTOMER = { email: recipientEmail, nome: "Test User", empresa: "Test Company LLC" };
  const SAMPLE_ITEMS = [
    { sku: "SKU-001", nome_produto: "Sample Floor Tile 12x24", preco_unitario: 29.99, quantidade: 2, subtotal: 59.98 },
  ];

  switch (type) {
    case "waiting_approval":
      return { type, customerEmail: recipientEmail };

    case "new_registration_admin":
      // adminEmail overrides destination so the test goes to recipientEmail, not jess@
      return { type, customerEmail: recipientEmail, customerName: "Test User", empresa: "Test Company LLC", adminEmail: recipientEmail };

    case "approval":
      return { type, customerEmail: recipientEmail, customerName: "Test User" };

    case "rejection":
      return { type, customerEmail: recipientEmail, customerName: "Test User" };

    case "new_order_customer":
      // edge function uses `customer.email` as destination
      return { type, order: SAMPLE_ORDER, customer: SAMPLE_CUSTOMER, items: SAMPLE_ITEMS };

    case "new_order_admin":
      // adminEmail overrides destination
      return { type, order: SAMPLE_ORDER, customer: SAMPLE_CUSTOMER, items: SAMPLE_ITEMS, adminEmail: recipientEmail };

    case "order_status_change":
      // edge function uses `customer.email` as destination
      return { type, order: SAMPLE_ORDER, customer: SAMPLE_CUSTOMER, newStatus: "em_separacao" };

    case "raw":
    default:
      return {
        type: "raw",
        to: recipientEmail,
        subject: "Test Email — PermShield B2B",
        html: `<h2 style="color:#1a7fbd;">Email service is working!</h2><p>This is a connectivity test from PermShield B2B.</p><p style="color:#888;font-size:12px;">Sent at: ${new Date().toISOString()}</p>`,
      };
  }
}

const EmailSettings = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState<string | null>(null);
  const [showEmailKey, setShowEmailKey] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  // Email recipients state
  const [recipients, setRecipients] = useState({
    email_new_orders: "",
    email_new_customer: "",
    bcc_outgoing_emails: "",
  });
  const [recipientInputs, setRecipientInputs] = useState({
    email_new_orders: "",
    email_new_customer: "",
    bcc_outgoing_emails: "",
  });
  const [savingRecipients, setSavingRecipients] = useState(false);

  const isConfigured = !!config?.email_provider;

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("configuracoes").select("*").limit(1).maybeSingle();

    if (error) {
      toast.error("Failed to load email settings: " + error.message);
      setLoading(false);
      return;
    }

    setConfig(data);
    setEditing(!data?.email_provider);
    setRecipients({
      email_new_orders:    data?.email_new_orders    ?? "",
      email_new_customer:  data?.email_new_customer  ?? "",
      bcc_outgoing_emails: data?.bcc_outgoing_emails ?? "",
    });
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const update = (key: string, value: any) => {
    setConfig((current: any) => ({ ...(current || {}), [key]: value }));
  };

  const validate = () => {
    if (!config?.email_provider) return "Please select a provider.";
    if (!config?.email_from?.trim()) return "Please fill in the From field.";

    if (config.email_provider === "smtp") {
      if (!config.smtp_host?.trim()) return "Please fill in the SMTP Server.";
      if (!config.smtp_port?.toString().trim()) return "Please fill in the Port.";
      if (!config.smtp_username?.trim()) return "Please fill in the Username.";
    }

    if (config.email_provider !== "smtp" && !config?.email_api_key?.trim()) {
      return "Please fill in the API Key.";
    }

    return null;
  };

  const handleSave = async () => {
    if (!config?.id) {
      toast.error("Configuration not found.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("configuracoes")
      .update({
        email_provider: config.email_provider || null,
        email_from: config.email_from || null,
        email_api_key: config.email_api_key || null,
        email_reply_to: config.email_reply_to || null,
        smtp_host: config.smtp_host || null,
        smtp_port: config.smtp_port || null,
        smtp_username: config.smtp_username || null,
        smtp_password: config.smtp_password || null,
        email_on_new_registration: config.email_on_new_registration ?? true,
        email_on_approval: config.email_on_approval ?? true,
        email_on_rejection: config.email_on_rejection ?? true,
        email_on_new_order: config.email_on_new_order ?? true,
        email_on_order_status: config.email_on_order_status ?? true,
      })
      .eq("id", config.id);

    if (error) {
      toast.error("Error saving: " + error.message);
      setSaving(false);
      return;
    }

    toast.success("Configurações salvas com sucesso.");
    await fetchData();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!config?.id) return;

    setSaving(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({
        email_provider: null,
        email_from: null,
        email_api_key: null,
        email_reply_to: null,
        smtp_host: null,
        smtp_port: null,
        smtp_username: null,
        smtp_password: null,
      })
      .eq("id", config.id);

    if (error) {
      toast.error("Error deleting: " + error.message);
    } else {
      toast.success("Email configuration removed.");
      await fetchData();
    }

    setSaving(false);
    setShowDeleteConfirm(false);
  };

  // ── Email recipients helpers ──
  const parseEmails = (raw: string) => raw.split(",").map(e => e.trim()).filter(Boolean);

  const addRecipient = (field: keyof typeof recipients) => {
    const val = recipientInputs[field].trim();
    if (!val) return;
    const existing = parseEmails(recipients[field]);
    if (existing.includes(val)) { toast.error("Email already in list"); return; }
    const next = [...existing, val].join(", ");
    setRecipients(r => ({ ...r, [field]: next }));
    setRecipientInputs(r => ({ ...r, [field]: "" }));
  };

  const removeRecipient = (field: keyof typeof recipients, email: string) => {
    const next = parseEmails(recipients[field]).filter(e => e !== email).join(", ");
    setRecipients(r => ({ ...r, [field]: next }));
  };

  const handleSaveRecipients = async () => {
    if (!config?.id) { toast.error("Configuration not found."); return; }
    setSavingRecipients(true);
    const { error } = await supabase.from("configuracoes").update({
      email_new_orders:    recipients.email_new_orders    || null,
      email_new_customer:  recipients.email_new_customer  || null,
      bcc_outgoing_emails: recipients.bcc_outgoing_emails || null,
    } as any).eq("id", config.id);
    if (error) { toast.error("Error: " + error.message); } else { toast.success("Recipients saved"); }
    setSavingRecipients(false);
  };

  const handleTestEmailTemplate = async (type: string) => {
    const recipientEmail = testEmail.trim() || config?.email_reply_to || config?.email_contato;

    if (!recipientEmail) {
      toast.error("Enter a recipient email before testing.");
      return;
    }

    if (!isConfigured) {
      toast.error("Configure and save a provider before testing.");
      return;
    }

    setTestingEmail(type);

    try {
      const body = buildTestBody(type, recipientEmail);
      const { data, error } = await supabase.functions.invoke("send-email", { body });

      if (error) {
        throw new Error(error.message || "Edge Function returned a non-2xx status code");
      }

      const template = EMAIL_TESTS.find((t) => t.type === type);

      if (data?.success) {
        toast.success(`✓ "${template?.label ?? type}" sent to ${recipientEmail}`);
      } else if (data?.skipped) {
        toast.warning(`⚠ "${template?.label ?? type}" is disabled in notification settings.`);
      } else {
        toast.error(data?.error || `Falha ao enviar "${template?.label ?? type}"`);
      }
    } catch (err: any) {
      toast.error(`Error testing "${type}": ` + (err.message || "Unknown error"));
    }

    setTestingEmail(null);
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
        <h2 className="font-display text-2xl font-semibold">Email Settings</h2>
        <Button onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <div className="space-y-4">
        {/* ── Current config summary ── */}
        {isConfigured && (
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Current email configuration
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { if (editing) { fetchData(); } else { setEditing(true); } }}
                    className="gap-1"
                  >
                    <Pencil className="h-3 w-3" />
                    {editing ? "Close editing" : "Edit"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluir
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Provider</p>
                    <p className="font-medium">{PROVIDER_LABELS[config.email_provider] || config.email_provider || "—"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">From</p>
                    <p className="font-medium">{config.email_from || "—"}</p>
                  </div>
                </div>

                {config.email_provider === "smtp" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">SMTP Server</p>
                      <p className="font-medium">{config.smtp_host || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Port</p>
                      <p className="font-medium">{config.smtp_port || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Username</p>
                      <p className="font-medium">{config.smtp_username || "—"}</p>
                    </div>
                  </>
                )}

                <div>
                  <p className="text-xs text-muted-foreground">Reply-To</p>
                  <p className="font-medium">{config.email_reply_to || "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Edit form ── */}
        {(editing || !isConfigured) && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Service Provider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Configure the email service for automatic notifications.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Provider <span className="text-destructive">*</span></Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={config?.email_provider ?? ""}
                      onChange={(e) => update("email_provider", e.target.value)}
                    >
                      <option value="">— Select provider —</option>
                      <option value="smtp">SMTP (Office 365, Gmail, etc.)</option>
                      <option value="resend">Resend</option>
                      <option value="sendgrid">SendGrid</option>
                    </select>
                  </div>

                  <div>
                    <Label>From (display name + email) <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="PermShield B2B <automated@wiseitsolutions.us>"
                      value={config?.email_from ?? ""}
                      onChange={(e) => update("email_from", e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Formato: <code>Name &lt;email@domain.com&gt;</code> ou <code>email@domain.com</code>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {config?.email_provider === "smtp" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">SMTP Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>SMTP Server <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="smtp.office365.com"
                        value={config?.smtp_host ?? ""}
                        onChange={(e) => update("smtp_host", e.target.value)}
                      />
                    </div>

                    <div>
                      <Label>Port <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="587"
                        value={config?.smtp_port ?? ""}
                        onChange={(e) => update("smtp_port", e.target.value)}
                      />
                    </div>

                    <div>
                      <Label>Username <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="automated@wiseitsolutions.us"
                        value={config?.smtp_username ?? ""}
                        onChange={(e) => update("smtp_username", e.target.value)}
                      />
                    </div>

                    <div>
                      <Label>Password</Label>
                      <div className="flex gap-2">
                        <Input
                          type={showSmtpPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={config?.smtp_password ?? ""}
                          onChange={(e) => update("smtp_password", e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          type="button"
                          onClick={() => setShowSmtpPassword((prev) => !prev)}
                        >
                          {showSmtpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Leave blank to use the server secret (recommended).
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label>Reply-To Email</Label>
                    <Input
                      type="email"
                      placeholder="jess@zapsupplies.com"
                      value={config?.email_reply_to ?? ""}
                      onChange={(e) => update("email_reply_to", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {config?.email_provider && config.email_provider !== "smtp" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">API Key</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      type={showEmailKey ? "text" : "password"}
                      placeholder="re_xxxx... ou SG.xxxx..."
                      value={config?.email_api_key ?? ""}
                      onChange={(e) => update("email_api_key", e.target.value)}
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      type="button"
                      onClick={() => setShowEmailKey((prev) => !prev)}
                    >
                      {showEmailKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── Notification toggles ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification Triggers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              These emails are sent automatically when the event occurs.
            </p>
            {[
              { key: "email_on_new_registration", label: "New customer registration — notify admin" },
              { key: "email_on_approval",          label: "Customer approved — notify customer" },
              { key: "email_on_rejection",         label: "Customer rejected — notify customer" },
              { key: "email_on_new_order",         label: "New order placed — notify admin & customer" },
              { key: "email_on_order_status",      label: "Order status changed — notify customer" },
            ].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
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

        {/* ── Email Recipients ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Email Recipients</CardTitle>
              <Button size="sm" onClick={handleSaveRecipients} disabled={savingRecipients} className="gap-1">
                <Save className="h-3 w-3" />
                {savingRecipients ? "Saving..." : "Save Recipients"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {(
              [
                {
                  field: "email_new_orders" as const,
                  label: "New order notifications (admin)",
                  description: "Receives an email whenever a new order is placed.",
                },
                {
                  field: "email_new_customer" as const,
                  label: "New customer notifications (admin)",
                  description: "Receives an email whenever a new customer registers.",
                },
                {
                  field: "bcc_outgoing_emails" as const,
                  label: "BCC on all customer emails",
                  description: "Always copied on every email sent to customers.",
                },
              ] as const
            ).map(({ field, label, description }) => (
              <div key={field}>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mb-2">{description}</p>
                {/* Current list */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {parseEmails(recipients[field]).map(email => (
                    <span key={email} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {email}
                      <button onClick={() => removeRecipient(field, email)} className="ml-0.5 text-primary/60 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {parseEmails(recipients[field]).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">No recipients yet</span>
                  )}
                </div>
                {/* Add input */}
                <div className="flex gap-2">
                  <input
                    type="email"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    placeholder="Add email address..."
                    value={recipientInputs[field]}
                    onChange={e => setRecipientInputs(r => ({ ...r, [field]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addRecipient(field)}
                  />
                  <Button size="sm" variant="outline" onClick={() => addRecipient(field)} className="gap-1">
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Individual template tests ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" />
              Test Email Templates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Test each template individually. All emails will be sent to the address entered below.
            </p>

            {/* Shared recipient input */}
            <div>
              <Label className="text-xs">Recipient (para todos os testes)</Label>
              <Input
                type="email"
                placeholder={config?.email_reply_to || "your@email.com"}
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              {!testEmail.trim() && (config?.email_reply_to || config?.email_contato) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Will use saved address:{" "}
                  <strong>{config.email_reply_to || config.email_contato}</strong>
                </p>
              )}
            </div>

            {!isConfigured && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                Configure and save a provider above before testing.
              </p>
            )}

            {/* Grid of template buttons */}
            <div className="grid gap-2 sm:grid-cols-2">
              {EMAIL_TESTS.map((t) => (
                <div
                  key={t.type}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{t.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={testingEmail !== null || !isConfigured}
                    onClick={() => handleTestEmailTemplate(t.type)}
                  >
                    {testingEmail === t.type ? (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>Enviando</span>
                      </span>
                    ) : (
                      "Testar"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete email configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the provider, SMTP, From and Reply-To. Emails will stop sending until reconfigured.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
};

export default EmailSettings;
