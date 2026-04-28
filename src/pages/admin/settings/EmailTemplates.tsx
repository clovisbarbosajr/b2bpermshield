import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Check, X, Save, Eye, RefreshCw } from "lucide-react";

// ─── Email template rows ──────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  { nome: "Approval",                          tipo: "approval",              assunto: "Your account has been approved", corpo: "" },
  { nome: "New order placed",                  tipo: "new_order",             assunto: "New order #{{order_number}} placed", corpo: "" },
  { nome: "Invite a new customer",             tipo: "invite_customer",       assunto: "You have been invited to join {{company}}", corpo: "" },
  { nome: "Notify customer(s) a message",      tipo: "notify_message",        assunto: "You have a new message from {{company}}", corpo: "" },
  { nome: "Notify order status/notes",         tipo: "notify_order_status",   assunto: "Order #{{order_number}} status update", corpo: "" },
  { nome: "New customer waiting for approval", tipo: "new_customer_approval", assunto: "New customer {{customer_name}} waiting for approval", corpo: "" },
  { nome: "An abandoned cart reminder",        tipo: "abandoned_cart",        assunto: "You left items in your cart", corpo: "" },
  { nome: "Notify customer newsletter",        tipo: "newsletter",            assunto: "News from {{company}}", corpo: "" },
];

// ─── PDF Template defaults ────────────────────────────────────────────────────
const PDF_VARIABLES = [
  { var: "{{orderNumber}}",     desc: "Order number" },
  { var: "{{orderDate}}",       desc: "Order date" },
  { var: "{{poNumber}}",        desc: "PO Number" },
  { var: "{{deliveryDate}}",    desc: "Requested delivery date" },
  { var: "{{customerName}}",    desc: "Customer company name" },
  { var: "{{customerEmail}}",   desc: "Customer email" },
  { var: "{{customerAddress}}", desc: "Delivery address" },
  { var: "{{companyName}}",     desc: "Your company name" },
  { var: "{{companyAddress}}",  desc: "Your company address" },
  { var: "{{companyEmail}}",    desc: "Your company email" },
  { var: "{{itemsRows}}",       desc: "HTML table rows for items (auto-generated)" },
  { var: "{{subtotal}}",        desc: "Order subtotal" },
  { var: "{{discount}}",        desc: "Discount amount" },
  { var: "{{tax}}",             desc: "Sales tax" },
  { var: "{{grossTotal}}",      desc: "Gross total" },
  { var: "{{notes}}",           desc: "Order notes / comments" },
];

// ─── Component ────────────────────────────────────────────────────────────────
const EmailTemplates = () => {
  // Email template state
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ assunto: "", corpo: "" });
  const [saving, setSaving] = useState(false);

  // PDF template state
  const [configId, setConfigId] = useState<string | null>(null);
  const [pdfTemplate, setPdfTemplate] = useState("");
  const [pdfOriginal, setPdfOriginal] = useState("");
  const [pdfSaving, setPdfSaving] = useState(false);
  const [pdfPreviewHtml, setPdfPreviewHtml] = useState("");
  const [pdfPreviewing, setPdfPreviewing] = useState(false);

  // ── Email templates ──
  const fetchData = async () => {
    const [{ data: tmpl }, { data: cfg }] = await Promise.all([
      supabase.from("email_templates").select("*").order("nome"),
      supabase.from("configuracoes").select("id").limit(1).maybeSingle(),
    ]);
    setTemplates(tmpl ?? []);
    setConfigId(cfg?.id ?? null);
    const t = (cfg as any)?.pdf_order_template ?? "";
    setPdfTemplate(t);
    setPdfOriginal(t);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Seed email_templates table if empty
  useEffect(() => {
    if (!loading && templates.length === 0) {
      supabase.from("email_templates").insert(DEFAULT_TEMPLATES).then(() => fetchData());
    }
  }, [loading, templates.length]);

  const displayTemplates = templates.length > 0
    ? templates
    : DEFAULT_TEMPLATES.map((t, i) => ({ id: `temp-${i}`, ...t, ativo: true }));

  const handleEdit = (t: any) => {
    setEditing(t);
    setForm({ assunto: t.assunto, corpo: t.corpo || "" });
  };

  const handleSave = async () => {
    if (!editing || editing.id?.startsWith("temp-")) return;
    setSaving(true);
    await supabase.from("email_templates").update({ assunto: form.assunto, corpo: form.corpo }).eq("id", editing.id);
    toast.success("Template updated");
    setSaving(false);
    setEditing(null);
    fetchData();
  };

  // ── PDF template ──
  const handlePdfSave = async () => {
    if (!configId) { toast.error("Configuração não encontrada"); return; }
    setPdfSaving(true);
    const { error } = await (supabase.from("configuracoes") as any)
      .update({ pdf_order_template: pdfTemplate || null })
      .eq("id", configId);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      setPdfOriginal(pdfTemplate);
      toast.success("PDF template saved");
    }
    setPdfSaving(false);
  };

  const handlePdfReset = () => {
    if (!confirm("Reset to the system default PDF template? Your custom template will be cleared.")) return;
    setPdfTemplate("");
  };

  const handlePdfPreview = async () => {
    // Get the first real order to use as preview data
    setPdfPreviewing(true);
    const { data: pedido } = await supabase
      .from("pedidos")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pedido?.id) {
      toast.error("No orders found to preview. Place a test order first.");
      setPdfPreviewing(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke("generate-pdf", {
      body: { pedido_id: pedido.id },
    });

    if (error || !data?.html) {
      toast.error("Failed to generate preview: " + (error?.message || "unknown error"));
    } else {
      setPdfPreviewHtml(data.html);
    }
    setPdfPreviewing(false);
  };

  // ── Email template edit screen ──
  if (editing) {
    return (
      <AdminLayout>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">{editing.nome}</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>← Back</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Template"}
            </Button>
          </div>
        </div>
        <div className="max-w-3xl space-y-4">
          <div>
            <Label>Subject</Label>
            <Input value={form.assunto} onChange={e => setForm({ ...form, assunto: e.target.value })} />
            <p className="text-xs text-muted-foreground mt-1">
              Variables: <code>{"{{order_number}}, {{customer_name}}, {{company}}, {{status}}"}</code>
            </p>
          </div>
          <div>
            <Label>Body (HTML)</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[360px]"
              value={form.corpo}
              onChange={e => setForm({ ...form, corpo: e.target.value })}
              placeholder="Enter your email template HTML here..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Full HTML is supported. Leave blank to use the system default template.
            </p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ── Main screen ──
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Email Templates</h2>
      </div>

      <Tabs defaultValue="email">
        <TabsList className="mb-4">
          <TabsTrigger value="email">Email Templates</TabsTrigger>
          <TabsTrigger value="pdf">Order PDF Template</TabsTrigger>
        </TabsList>

        {/* ── Email Templates tab ── */}
        <TabsContent value="email">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template name</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Custom body</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayTemplates.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium text-primary">{t.nome}</TableCell>
                      <TableCell>English (US)</TableCell>
                      <TableCell>
                        {t.corpo
                          ? <Check className="h-4 w-4 text-green-500" />
                          : <X className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(t)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ── PDF Template tab ── */}
        <TabsContent value="pdf">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Order PDF Template (HTML)</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={handlePdfPreview} disabled={pdfPreviewing}>
                      <Eye className="h-3 w-3" />
                      {pdfPreviewing ? "Loading..." : "Preview"}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1 text-destructive" onClick={handlePdfReset}>
                      <RefreshCw className="h-3 w-3" />
                      Reset to default
                    </Button>
                    <Button size="sm" className="gap-1" onClick={handlePdfSave} disabled={pdfSaving}>
                      <Save className="h-3 w-3" />
                      {pdfSaving ? "Saving..." : "Save PDF Template"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Customize the HTML layout of the order PDF. Leave blank to use the system default.
                  Use the variables below to insert dynamic data.
                </p>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[400px]"
                  value={pdfTemplate}
                  onChange={e => setPdfTemplate(e.target.value)}
                  placeholder="Leave blank to use the system default template. Paste full HTML here to customize..."
                  spellCheck={false}
                />
                {pdfTemplate !== pdfOriginal && (
                  <p className="text-xs text-amber-600">Unsaved changes — click Save PDF Template to apply.</p>
                )}
              </CardContent>
            </Card>

            {/* Variable reference */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Available Variables</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {PDF_VARIABLES.map(v => (
                    <div key={v.var} className="flex items-center gap-2 text-sm">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary">{v.var}</code>
                      <span className="text-muted-foreground">{v.desc}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Preview pane */}
            {pdfPreviewHtml && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Preview</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setPdfPreviewHtml("")}>Close</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <iframe
                    srcDoc={pdfPreviewHtml}
                    className="w-full rounded border border-border"
                    style={{ height: "700px" }}
                    title="PDF Preview"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    This is a browser preview. The actual PDF may render slightly differently when printed.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default EmailTemplates;
