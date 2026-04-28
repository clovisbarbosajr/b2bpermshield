import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Save, Upload, Image as ImageIcon, Copy, ExternalLink, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import qrCodeSvg from "@/assets/qr-permshield-app.svg";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
];
const CURRENCIES = ["USD", "BRL", "EUR", "GBP", "CAD"];
const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
];
const LANGUAGES = [
  { value: "en", label: "English (US)" },
  { value: "pt", label: "Português" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];

const APP_CONFIG_OPTIONS = {
  inventory: [
    { key: "manage_stock_levels", label: "Manage stock levels for products" },
    { key: "display_stock_qty", label: "Display stock qty on portal number (SKU)" },
    { key: "prevent_ordering_oos", label: "Prevent ordering for specific products" },
    { key: "manage_large_qty", label: "Manage large quantity and volume products logs, basis to show" },
    { key: "show_available_qty", label: "Show available qty to customers" },
    { key: "disable_estimate_when_oos", label: "Disable estimate when specified qty is 0" },
  ],
  products: [
    { key: "product_details_accordion", label: "Product details in accordion" },
    { key: "hide_category_default_view", label: "Hide Category/Default view on portal" },
    { key: "show_msrp", label: "Show MSRP" },
    { key: "product_status_enabled", label: "Product status enabled to customers" },
    { key: "show_weight_qty_product", label: "Show weight/qty product" },
    { key: "show_barcode_search", label: "Show barcode search" },
    { key: "show_product_dimensions", label: "Show product dimensions" },
  ],
  finding_products: [
    { key: "find_by_sku_first", label: "Find by SKU / ref first" },
    { key: "enable_suggested_retail_price", label: "Enable/show suggested retail price (MSRP)" },
    { key: "show_industry_product_code", label: "Show industry/Product code number (UPC)" },
    { key: "track_inventory_backorder", label: "Track inventory/backorder info (Lot, M, N)" },
    { key: "allow_see_full_description", label: "Allow see full description for" },
    { key: "enable_quantity_order_invoice", label: "Enable/quantity order/invoice" },
  ],
  customers: [
    { key: "open_customer_registration", label: "Open customer registration" },
    { key: "allow_customers_commented_rating", label: "Allow customers commented / rating" },
    { key: "enable_parent_customer", label: "Enable parent customer" },
    { key: "enable_customer_address_registration", label: "Enable customer address registration" },
    { key: "auto_approve_customer_registration", label: "Auto-approve customer registration" },
    { key: "associate_find_list", label: "Associate find list" },
  ],
  customer_layout: [
    { key: "show_products_on_order_notification", label: "Show products order on notification to customer" },
    { key: "hide_product_codes", label: "Hide product codes" },
    { key: "customers_handle_orders_in_cart", label: "Customers handle orders in cart" },
    { key: "show_order_info_to_customer", label: "Show order/info to customer" },
    { key: "enhanced_browse_pagination", label: "Enhanced/browse pagination" },
  ],
  various_settings: [
    { key: "show_products_catalog_to_customer", label: "Show products/catalog to customer for orders" },
    { key: "auto_order_by_default_view", label: "Auto order/by Default view on portal" },
    { key: "catalog_links_from", label: "Catalog links from" },
    { key: "enable_assembly_order", label: "Enable assembly / order" },
    { key: "show_tax_on_portal", label: "Show Tax on portal" },
    { key: "show_product_dimensions_modal", label: "Show product dimensions/modal" },
    { key: "use_flags_on_upc_barcode", label: "Use flags on UPC/Barcode on submission" },
    { key: "enforce_two_factor_auth", label: "Enforce two-factor authentication on export" },
  ],
};

const REGISTRATION_FIELDS = [
  { key: "avatar", label: "Avatar" },
  { key: "address", label: "Address" },
  { key: "address2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip" },
  { key: "country", label: "Country" },
  { key: "company_number", label: "Company Number" },
  { key: "tax", label: "Tax" },
  { key: "cell_number", label: "cell number" },
  { key: "website", label: "Website" },
  { key: "parent_trade", label: "Parent Trade" },
];

const SettingsProfile = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedSubTab, setAdvancedSubTab] = useState("google_analytics");
  const [webhookTestOrder, setWebhookTestOrder] = useState("");
  const [webhookTestOutput, setWebhookTestOutput] = useState("");
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      const [cfgRes, ordersRes] = await Promise.all([
        supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
        supabase.from("pedidos").select("id, numero").order("numero", { ascending: false }).limit(20),
      ]);
      if (cfgRes.data) setConfig(cfgRes.data);
      else {
        const { data: newConfig } = await supabase.from("configuracoes").insert({}).select().single();
        setConfig(newConfig);
      }
      if (ordersRes.data) setOrders(ordersRes.data);
      setLoading(false);
    };
    fetchAll();
  }, [user]);

  const update = (key: string, value: any) => setConfig((prev: any) => ({ ...prev, [key]: value }));

  const updateJsonField = (field: string, key: string, value: any) => {
    const current = config?.[field] || {};
    update(field, { ...current, [key]: value });
  };

  const getJsonValue = (field: string, key: string, defaultVal: any = false) => {
    return config?.[field]?.[key] ?? defaultVal;
  };

  const handleImageUpload = async (file: File, field: string) => {
    const ext = file.name.split(".").pop();
    const path = `settings/${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) {
      toast.error("Upload failed: " + error.message);
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("product-images").getPublicUrl(path);
    update(field, publicUrl);
    toast.success("Image uploaded");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const { id, created_at, updated_at, ...payload } = config;
    const { error } = await supabase.from("configuracoes").update(payload).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
    setSaving(false);
  };

  const handleWebhookTest = async (type: "create" | "update") => {
    if (!webhookTestOrder) {
      toast.error("Select an order");
      return;
    }
    const url = type === "create" ? config?.webhook_create_order : config?.webhook_update_order;
    if (!url) {
      toast.error(`No ${type} webhook URL configured`);
      return;
    }
    try {
      const { data: order } = await supabase
        .from("pedidos")
        .select("*, pedido_itens(*), clientes(nome, email, empresa)")
        .eq("id", webhookTestOrder)
        .single();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config?.webhook_auth_header) headers["Authorization"] = config.webhook_auth_header;
      setWebhookTestOutput(`Sending ${type} webhook to ${url}...\n`);
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ event: `order.${type}d`, data: order }),
      });
      const respText = await resp.text();
      setWebhookTestOutput((prev) => prev + `Status: ${resp.status}\nResponse: ${respText}`);
    } catch (err: any) {
      setWebhookTestOutput(`Error: ${err.message}`);
    }
  };

  if (loading)
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );

  const PdfUploadBox = () => {
    const ref = useRef<HTMLInputElement>(null);
    const handleUpload = async (file: File) => {
      if (!file.name.endsWith(".pdf")) { toast.error("Please upload a PDF file"); return; }
      const path = `settings/catalog-${Date.now()}.pdf`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { contentType: "application/pdf" });
      if (error) { toast.error("Upload failed: " + error.message); return; }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      await update("catalog_pdf_url", data.publicUrl);
      toast.success("Catalog PDF uploaded");
    };
    return (
      <div>
        <Label className="text-sm font-semibold">PDF Catalog (downloadable by customers)</Label>
        <div
          className="mt-1 border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center min-h-[100px] bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
        >
          {(config as any)?.catalog_pdf_url ? (
            <div className="flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 text-primary" />
              <span className="text-sm text-green-400 font-medium">PDF uploaded ✓</span>
              <a href={(config as any).catalog_pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline" onClick={e => e.stopPropagation()}>View PDF</a>
            </div>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Drop PDF file here or click to upload</span>
              <Button variant="outline" size="sm" className="mt-2 gap-1"><Upload className="h-3 w-3" /> Upload PDF</Button>
            </>
          )}
        </div>
        <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
        {(config as any)?.catalog_pdf_url && (
          <Button variant="ghost" size="sm" className="mt-1 text-xs text-destructive" onClick={() => update("catalog_pdf_url", null)}>Remove PDF</Button>
        )}
      </div>
    );
  };

  const ImageUploadBox = ({ field, label }: { field: string; label: string }) => {
    const ref = useRef<HTMLInputElement>(null);
    return (
      <div>
        <Label className="text-sm font-semibold">{label}</Label>
        <div
          className="mt-1 border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center min-h-[140px] bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleImageUpload(f, field);
          }}
        >
          {config?.[field] ? (
            <img src={config[field]} alt={label} className="max-h-24 object-contain" />
          ) : (
            <>
              <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Drop image file here</span>
              <span className="text-xs text-muted-foreground">or optional</span>
              <Button variant="outline" size="sm" className="mt-2 gap-1">
                <Upload className="h-3 w-3" /> Upload
              </Button>
            </>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageUpload(f, field);
          }}
        />
        {config?.[field] && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs text-destructive"
            onClick={() => update(field, null)}
          >
            Remove
          </Button>
        )}
      </div>
    );
  };

  const appCode = config?.app_code || "permshield";
  const apiToken = config?.api_token || "";
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
  const zapierUser = config?.zapier_username || `${appCode}@app.b2bwave.com`;
  const zapierPass = config?.zapier_password || apiToken;

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Profile</h2>
        <Button onClick={handleSave} disabled={saving} className="gap-1">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <Tabs defaultValue="basic_info">
        <TabsList className="flex flex-wrap mb-4">
          <TabsTrigger value="basic_info">Basic Info</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="address">Address</TabsTrigger>
          <TabsTrigger value="social_media">Social media</TabsTrigger>
          <TabsTrigger value="email_notifications">Email notifications</TabsTrigger>
          <TabsTrigger value="app_configuration">Application configuration</TabsTrigger>
          <TabsTrigger value="registration_fields">Customer registration fields</TabsTrigger>
          <TabsTrigger value="default_values">Default Values</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          <TabsTrigger value="api_configuration">API configuration</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="mobile_app">Mobile app (iOS/Android)</TabsTrigger>
        </TabsList>

        {/* === BASIC INFO === */}
        <TabsContent value="basic_info">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div>
                <Label>Company Name</Label>
                <Input value={config?.nome_empresa ?? ""} onChange={(e) => update("nome_empresa", e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={config?.email_contato ?? ""} onChange={(e) => update("email_contato", e.target.value)} />
              </div>
              <div>
                <Label>Language</Label>
                <Select value={config?.language ?? "en"} onValueChange={(v) => update("language", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Company Description</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={config?.mensagem_boas_vindas ?? ""}
                  onChange={(e) => update("mensagem_boas_vindas", e.target.value)}
                  placeholder="Banners, catalogs, advanced and offering product content listing your store at b2bgetmore..."
                />
              </div>
              <div>
                <Label>Minimum Order Value</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={config?.pedido_minimo ?? 0}
                  onChange={(e) => update("pedido_minimo", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Country</Label>
                <Select value={config?.country ?? "US"} onValueChange={(v) => update("country", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Timezone</Label>
                <Select
                  value={config?.fuso_horario ?? "America/New_York"}
                  onValueChange={(v) => update("fuso_horario", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={config?.moeda ?? "USD"} onValueChange={(v) => update("moeda", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-4">
              <Card className="p-4">
                <Label className="text-lg font-semibold">Logo</Label>
                <div
                  className="mt-2 border rounded-md p-4 flex items-center justify-center min-h-[120px] bg-muted/30 cursor-pointer"
                  onClick={() => (document.getElementById("logo-upload") as HTMLInputElement)?.click()}
                >
                  {config?.logo_url ? (
                    <img src={config.logo_url} alt="Logo" className="max-h-24 object-contain" />
                  ) : (
                    <span className="text-muted-foreground text-sm">No logo uploaded</span>
                  )}
                </div>
                <input
                  id="logo-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageUpload(f, "logo_url");
                  }}
                />
                <Input
                  className="mt-2"
                  value={config?.logo_url ?? ""}
                  onChange={(e) => update("logo_url", e.target.value)}
                  placeholder="Logo URL"
                />
              </Card>
              <Card className="p-4">
                <Label className="text-lg font-semibold">Email Signature</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] mt-2"
                  value={config?.email_signature ?? ""}
                  onChange={(e) => update("email_signature", e.target.value)}
                  placeholder="HTML email signature..."
                />
              </Card>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config?.enable_invoice ?? false}
                    onChange={(e) => update("enable_invoice", e.target.checked)}
                  />{" "}
                  Enable Invoice
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config?.enable_scope ?? false}
                    onChange={(e) => update("enable_scope", e.target.checked)}
                  />{" "}
                  Enable scope
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config?.grid_list_default === "grid"}
                    onChange={(e) => update("grid_list_default", e.target.checked ? "grid" : "list")}
                  />{" "}
                  Grid List
                </label>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* === APPEARANCE === */}
        <TabsContent value="appearance">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label>Select Categories</Label>
                <Input
                  value={config?.featured_categories ?? ""}
                  onChange={(e) => update("featured_categories", e.target.value)}
                  placeholder="Featured category IDs (comma separated)"
                />
              </div>
              <div>
                <Label>Theme</Label>
                <Select value={config?.theme ?? "default"} onValueChange={(v) => update("theme", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="classic">Classic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={config?.cor_primaria ?? "#1a3a6b"}
                      onChange={(e) => update("cor_primaria", e.target.value)}
                      className="w-16 h-10 p-1"
                    />
                    <Input
                      value={config?.cor_primaria ?? ""}
                      onChange={(e) => update("cor_primaria", e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={config?.cor_secundaria ?? "#e67e22"}
                      onChange={(e) => update("cor_secundaria", e.target.value)}
                      className="w-16 h-10 p-1"
                    />
                    <Input
                      value={config?.cor_secundaria ?? ""}
                      onChange={(e) => update("cor_secundaria", e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label>PDF Currency Settings</Label>
                <Input
                  value={config?.pdf_currency_settings ?? ""}
                  onChange={(e) => update("pdf_currency_settings", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-4">
              <ImageUploadBox field="footer_logo_url" label="Footer Logo" />
              <ImageUploadBox field="catalog_logo_url" label="Catalog Logo" />
              <ImageUploadBox field="catalog_header_url" label="Catalog Header" />
              <PdfUploadBox />
            </div>
          </div>
        </TabsContent>

        {/* === ADDRESS === */}
        <TabsContent value="address">
          <div className="max-w-2xl space-y-4">
            <div>
              <Label>Address</Label>
              <Input value={config?.endereco ?? ""} onChange={(e) => update("endereco", e.target.value)} />
            </div>
            <div>
              <Label>Business Email</Label>
              <Input value={config?.email_contato ?? ""} onChange={(e) => update("email_contato", e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={config?.telefone_contato ?? ""}
                onChange={(e) => update("telefone_contato", e.target.value)}
              />
            </div>
          </div>
        </TabsContent>

        {/* === SOCIAL MEDIA === */}
        <TabsContent value="social_media">
          <div className="max-w-2xl space-y-4">
            <div>
              <Label>Facebook</Label>
              <Input
                value={config?.facebook_url ?? ""}
                onChange={(e) => update("facebook_url", e.target.value)}
                placeholder="https://www.facebook.com/permshield"
              />
            </div>
            <div>
              <Label>Twitter</Label>
              <Input value={config?.twitter_url ?? ""} onChange={(e) => update("twitter_url", e.target.value)} />
            </div>
            <div>
              <Label>LinkedIn</Label>
              <Input value={config?.linkedin_url ?? ""} onChange={(e) => update("linkedin_url", e.target.value)} />
            </div>
            <div>
              <Label>Instagram</Label>
              <Input
                value={config?.instagram_url ?? ""}
                onChange={(e) => update("instagram_url", e.target.value)}
                placeholder="https://www.instagram.com/permshield/"
              />
            </div>
            <div>
              <Label>Pinterest</Label>
              <Input
                value={config?.pinterest_url ?? ""}
                onChange={(e) => update("pinterest_url", e.target.value)}
                placeholder="https://www.pinterest.com/permshield/"
              />
            </div>
            <div>
              <Label>Youtube</Label>
              <Input value={config?.youtube_url ?? ""} onChange={(e) => update("youtube_url", e.target.value)} />
            </div>
          </div>
        </TabsContent>

        {/* === EMAIL NOTIFICATIONS === */}
        <TabsContent value="email_notifications">
          <div className="max-w-2xl space-y-4">
            <div>
              <Label>Email for new customer notification</Label>
              <Input
                value={config?.email_new_customer ?? ""}
                onChange={(e) => update("email_new_customer", e.target.value)}
                placeholder="admin@company.com"
              />
            </div>
            <div>
              <Label>Email for new orders notification</Label>
              <Input
                value={config?.email_new_orders ?? ""}
                onChange={(e) => update("email_new_orders", e.target.value)}
                placeholder="orders@company.com, sales@company.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                You can enter more than one email separated by commas. For example:
                email@yourstore.com,email2@yourstore.com
              </p>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config?.attach_xls_order ?? false}
                  onChange={(e) => update("attach_xls_order", e.target.checked)}
                />{" "}
                Attach item order via XLS to email
              </label>
            </div>
            <div>
              <Label>BCC outgoing emails to customers</Label>
              <Input
                value={config?.bcc_outgoing_emails ?? ""}
                onChange={(e) => update("bcc_outgoing_emails", e.target.value)}
              />
            </div>
            <div>
              <Label>Email for new order messages from customer</Label>
              <Input
                value={config?.email_order_messages ?? ""}
                onChange={(e) => update("email_order_messages", e.target.value)}
              />
            </div>
            <div className="border-t pt-4 mt-4">
              <h3 className="text-lg font-semibold mb-4">Contact Form</h3>
              <div className="space-y-4">
                <div>
                  <Label>Contact form email *</Label>
                  <Input
                    value={config?.contact_form_email ?? ""}
                    onChange={(e) => update("contact_form_email", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Contact form cc email(s) *</Label>
                  <Input
                    value={config?.contact_form_cc ?? ""}
                    onChange={(e) => update("contact_form_cc", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Contact form bcc email(s) *</Label>
                  <Input
                    value={config?.contact_form_bcc ?? ""}
                    onChange={(e) => update("contact_form_bcc", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* === APPLICATION CONFIGURATION === */}
        <TabsContent value="app_configuration">
          <p className="text-sm text-muted-foreground mb-6">
            These are the features/functions that should be displayed to your customers or upon registration:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Object.entries(APP_CONFIG_OPTIONS).map(([group, items]) => (
              <div key={group}>
                <h3 className="font-semibold text-sm mb-3 capitalize">{group.replace(/_/g, " ")}</h3>
                <div className="space-y-2">
                  {items.map((item) => (
                    <label key={item.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={getJsonValue("app_configuration", item.key)}
                        onChange={(e) => updateJsonField("app_configuration", item.key, e.target.checked)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* === CUSTOMER REGISTRATION FIELDS === */}
        <TabsContent value="registration_fields">
          <div className="max-w-2xl">
            <p className="text-sm text-muted-foreground mb-4">
              These are the fields that should be displayed when customers sign-up/register:
            </p>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input
                type="checkbox"
                checked={config?.permite_cadastro_aberto ?? true}
                onChange={(e) => update("permite_cadastro_aberto", e.target.checked)}
              />
              <span className="font-medium">Allow open customer registration</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {REGISTRATION_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={getJsonValue("registration_fields", field.key, true)}
                    onChange={(e) => updateJsonField("registration_fields", field.key, e.target.checked)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* === DEFAULT VALUES === */}
        <TabsContent value="default_values">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold">Products</h3>
              <div>
                <Label>Item Ordering *</Label>
                <Select value={config?.item_ordering ?? "Yes"} onValueChange={(v) => update("item_ordering", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cases/order *</Label>
                <Input value={config?.cases_order ?? ""} onChange={(e) => update("cases_order", e.target.value)} />
              </div>
              <div>
                <Label>Segments *</Label>
                <Input value={config?.segments ?? ""} onChange={(e) => update("segments", e.target.value)} />
              </div>
            </div>
            <div>
              <ImageUploadBox field="default_product_image" label="Default Product Image" />
            </div>
          </div>
        </TabsContent>

        {/* === ADVANCED === */}
        <TabsContent value="advanced">
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config?.enable_support_button ?? true}
                onChange={(e) => update("enable_support_button", e.target.checked)}
              />
              Enable bottom right support button
            </label>

            <div className="flex flex-wrap gap-1 border-b">
              {[
                { key: "google_analytics", label: "Google Analytics Code" },
                { key: "custom_css", label: "Custom CSS" },
                { key: "conversion_tracking", label: "Conversion Tracking" },
                { key: "custom_code", label: "Custom Code" },
                { key: "custom_code_admin", label: "Custom Code (Admin panel)" },
                { key: "cookie_policy", label: "Cookie Policy Banner" },
                { key: "global_notification", label: "Global Notification" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`px-3 py-2 text-sm border-b-2 transition-colors ${advancedSubTab === tab.key ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setAdvancedSubTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {advancedSubTab === "google_analytics" && (
                <div>
                  <Label>Google Analytics Code</Label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[200px]"
                    value={config?.google_analytics_code ?? ""}
                    onChange={(e) => update("google_analytics_code", e.target.value)}
                    placeholder="Paste your Google Analytics tracking code here..."
                  />
                </div>
              )}

              {advancedSubTab === "custom_css" && (
                <div>
                  <Label>Custom CSS</Label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[300px]"
                    value={config?.custom_css ?? ""}
                    onChange={(e) => update("custom_css", e.target.value)}
                    placeholder="/* Your custom CSS here */"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Place your custom CSS here. Contact support if you need any help with class names and IDs
                  </p>
                </div>
              )}

              {advancedSubTab === "conversion_tracking" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Google Ads</h3>
                    <p className="text-sm text-muted-foreground italic mb-4">
                      Place your Google Adwords tracking code here if you are running any Google AdwordsCampaigns.
                      Google Adwordstracking code will appear before the ending of {"</body>"} tag
                    </p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <Label>Customer registration tracking</Label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                          value={config?.conversion_google_reg ?? ""}
                          onChange={(e) => update("conversion_google_reg", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Order submit tracking</Label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                          value={config?.conversion_google_order ?? ""}
                          onChange={(e) => update("conversion_google_order", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Facebook</h3>
                    <p className="text-sm text-muted-foreground italic mb-4">
                      Place your Facebook tracking code here if you are running any Facebook Campaigns. Facebook
                      tracking code will appear before the ending of {"</head>"} tag
                    </p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <Label>Customer registration tracking</Label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                          value={config?.conversion_fb_reg ?? ""}
                          onChange={(e) => update("conversion_fb_reg", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Order submit tracking</Label>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                          value={config?.conversion_fb_order ?? ""}
                          onChange={(e) => update("conversion_fb_order", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {advancedSubTab === "custom_code" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground italic">
                    Place your custom code for {"<head>"} {"<body>"} sections. Do not forget to include {"<script>"}{" "}
                    and/or {"<style>"} tags if required.
                  </p>
                  <div>
                    <Label>Custom code for {"<head>"} section</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
                      value={config?.custom_code_head ?? ""}
                      onChange={(e) => update("custom_code_head", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Custom code for {"<body>"} section (after opening)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
                      value={config?.custom_code_body_open ?? ""}
                      onChange={(e) => update("custom_code_body_open", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Custom code for {"<body>"} section (before closing)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                      value={config?.custom_code_body_close ?? ""}
                      onChange={(e) => update("custom_code_body_close", e.target.value)}
                    />
                  </div>
                </div>
              )}

              {advancedSubTab === "custom_code_admin" && (
                <div className="space-y-4">
                  <div>
                    <Label>Custom CSS</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
                      value={config?.custom_css_admin ?? ""}
                      onChange={(e) => update("custom_css_admin", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Place your custom CSS here (for Admin panel). Contact support if you need any help with class
                      names and IDs
                    </p>
                  </div>
                  <div>
                    <Label>Custom code for {"<body>"} section (after opening)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
                      value={config?.custom_code_admin_body_open ?? ""}
                      onChange={(e) => update("custom_code_admin_body_open", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Custom code for {"<body>"} section (before closing)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[150px]"
                      value={config?.custom_code_admin_body_close ?? ""}
                      onChange={(e) => update("custom_code_admin_body_close", e.target.value)}
                    />
                  </div>
                </div>
              )}

              {advancedSubTab === "cookie_policy" && (
                <div>
                  <p className="text-sm text-muted-foreground italic mb-4">
                    Use <code className="text-primary">window.accept_cookie_policy;</code> when writing Javascript code
                    to detect if visitor has accepted the cookies.{" "}
                    <a href="#" className="text-primary underline">
                      Add sample text
                    </a>
                  </p>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[250px]"
                    value={config?.cookie_policy_content ?? ""}
                    onChange={(e) => update("cookie_policy_content", e.target.value)}
                    placeholder="Cookie policy banner content (HTML supported)..."
                  />
                </div>
              )}

              {advancedSubTab === "global_notification" && (
                <div className="space-y-4">
                  <div>
                    <Label>Message type *</Label>
                    <Select
                      value={config?.global_notification_type ?? "none"}
                      onValueChange={(v) => update("global_notification_type", v)}
                    >
                      <SelectTrigger className="max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Text that will appear on top of every page *</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[250px]"
                      value={config?.global_notification_content ?? ""}
                      onChange={(e) => update("global_notification_content", e.target.value)}
                      placeholder="Notification content (HTML supported)..."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Bottom section - always visible */}
            <div className="border-t pt-4 mt-4 space-y-4">
              <div>
                <Label>Meta Title For Homepage</Label>
                <Input
                  value={config?.meta_title_homepage ?? ""}
                  onChange={(e) => update("meta_title_homepage", e.target.value)}
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Add Extra Fields at Order Confirm and Customer Details</p>
                <Link to="/admin/settings/extra-fields" className="text-primary underline text-sm">
                  Extra fields
                </Link>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">See all failed login attempts</p>
                <a href="#" className="text-primary underline text-sm">
                  Throttled Customer Logins
                </a>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <Label>App Code</Label>
                  <Input
                    value={config?.app_code ?? ""}
                    onChange={(e) => update("app_code", e.target.value)}
                    placeholder="zapsupplies"
                  />
                </div>
                <div>
                  <Label>API Token</Label>
                  <Input
                    value={config?.api_token ?? ""}
                    onChange={(e) => update("api_token", e.target.value)}
                    placeholder="45afb79c-44ae-4989-8944-80763375e61b"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* === API CONFIGURATION === */}
        <TabsContent value="api_configuration">
          <div className="space-y-6">
            <div>
              <a
                href={`${supabaseUrl}/functions/v1/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline text-sm flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" /> API Documentation
              </a>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <Label className="font-semibold">App Code</Label>
                <p className="text-sm text-muted-foreground">{appCode}</p>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => copyToClipboard(appCode)}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <div>
                <Label className="font-semibold">API Token</Label>
                <p className="text-sm text-muted-foreground font-mono">{apiToken || "Not set"}</p>
                {apiToken && (
                  <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => copyToClipboard(apiToken)}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary"
                  onClick={() => {
                    const token = crypto.randomUUID();
                    update("api_token", token);
                  }}
                >
                  Reset Token
                </Button>
              </div>
            </div>

            <div className="border-t pt-4">
              <a
                href="https://zapier.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline text-sm flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" /> Use B2B Wave with Zapier
              </a>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                <div>
                  <Label className="font-semibold">Zapier Username</Label>
                  <p className="text-sm text-muted-foreground">{zapierUser}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => copyToClipboard(zapierUser)}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <div>
                  <Label className="font-semibold">Zapier Password</Label>
                  <p className="text-sm text-muted-foreground font-mono">{zapierPass || "Not set"}</p>
                  {zapierPass && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1"
                      onClick={() => copyToClipboard(zapierPass)}
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-2">Webhooks</h3>
              <p className="text-sm text-muted-foreground mb-4">
                By defining webhooks, your endpoints will be automatically updated when new orders are added or updated.
              </p>
              <div className="space-y-4 max-w-lg">
                <div>
                  <Label>Create order webhook</Label>
                  <Input
                    value={config?.webhook_create_order ?? ""}
                    onChange={(e) => update("webhook_create_order", e.target.value)}
                    placeholder="https://your-endpoint.com/webhooks/order-created"
                  />
                </div>
                <div>
                  <Label>Update order webhook</Label>
                  <Input
                    value={config?.webhook_update_order ?? ""}
                    onChange={(e) => update("webhook_update_order", e.target.value)}
                    placeholder="https://your-endpoint.com/webhooks/order-updated"
                  />
                </div>
                <div>
                  <Label>Webhook authorization header</Label>
                  <Input
                    value={config?.webhook_auth_header ?? ""}
                    onChange={(e) => update("webhook_auth_header", e.target.value)}
                    placeholder="Bearer your-secret-token"
                  />
                </div>
                <div>
                  <Select value={webhookTestOrder} onValueChange={setWebhookTestOrder}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select order to test" />
                    </SelectTrigger>
                    <SelectContent>
                      {orders.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          Order {o.numero}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleWebhookTest("create")}>
                    Test create
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleWebhookTest("update")}>
                    Test update
                  </Button>
                </div>
                {webhookTestOutput && (
                  <div>
                    <Label>Test output:</Label>
                    <pre className="mt-1 bg-muted/50 rounded-md p-3 text-xs font-mono whitespace-pre-wrap min-h-[100px] max-h-[200px] overflow-auto">
                      {webhookTestOutput}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* === INTEGRATIONS === */}
        <TabsContent value="integrations">
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Quickbooks</h3>
              <div className="flex gap-2 mb-3">
                <Button variant="outline" size="sm" disabled>
                  Install
                </Button>
                <Button size="sm" disabled>
                  Start
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                By connecting Quickbooks, you will be able to directly create an invoice from B2B Wave to Quickbooks.
                Customer & product details will automatically be created if not found.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                The 'Create QuickBooks Invoice' button will be shown at the bottom of each order.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Other Integrations?</h3>
              <p className="text-sm text-muted-foreground">
                Are you looking for another integration? Contact us for more details.
              </p>
            </Card>
          </div>
        </TabsContent>

        {/* === MOBILE APP === */}
        <TabsContent value="mobile_app">
          <div className="max-w-2xl space-y-4">
            <h3 className="text-lg font-semibold">Mobile app (iOS/Android)</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config?.mobile_app_enabled ?? false}
                  onChange={(e) => update("mobile_app_enabled", e.target.checked)}
                />
                The Sales rep mobile app is enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config?.mobile_allow_all_customers ?? false}
                  onChange={(e) => update("mobile_allow_all_customers", e.target.checked)}
                />
                Allow access to all customers from admin users
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config?.mobile_allow_edit_prices ?? false}
                  onChange={(e) => update("mobile_allow_edit_prices", e.target.checked)}
                />
                Allow sales reps to edit order prices
              </label>
            </div>
            <Card className="p-6 mt-6">
              <h4 className="font-semibold mb-3">Setup mobile app</h4>
              <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="shrink-0 font-medium text-foreground">1.</span>
                  <span>
                    Download the app:
                    <a
                      href="https://apps.apple.com/us/app/permshield/id6759396326"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 inline-flex items-center"
                    >
                      <img
                        src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                        alt="App Store"
                        className="h-8"
                      />
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
                  <img src={qrCodeSvg} alt="QR Code" className="w-48 h-48" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">Contact support for any questions.</p>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default SettingsProfile;
