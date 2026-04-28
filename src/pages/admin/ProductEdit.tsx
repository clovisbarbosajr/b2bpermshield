import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Save, Upload, Plus, Trash2, Image as ImageIcon, FileText, Loader2 } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";

type Categoria = { id: string; nome: string };
type Brand = { id: string; nome: string };
type TabelaPreco = { id: string; nome: string };
type Cliente = { id: string; nome: string; empresa: string };
type ProductOption = { id: string; nome: string; tipo: string };

const statusOptions = [
  { value: "disponivel", label: "Available" },
  { value: "estoque_limitado", label: "Limited Stock" },
  { value: "esgotado", label: "Sold Out" },
  { value: "descontinuado", label: "Discontinued" },
  { value: "indisponivel", label: "Not Available" },
  { value: "pre_venda", label: "Pre-order" },
];

const ofertasOptions = [
  { value: "nunca", label: "Never" },
  { value: "sempre", label: "Always" },
  { value: "com_desconto", label: "Only if discounts are available" },
];

const ProductEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";
  const { log } = useActivityLog();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("product");

  // Lookup data
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<TabelaPreco[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<{ id: string; nome: string }[]>([]);

  // Main product form
  const [form, setForm] = useState({
    nome: "", sku: "", descricao: "", imagem_url: "", categoria_id: "", brand_id: "",
    preco: 0, custo: 0, preco_msrp: 0, peso: 0, comprimento: 0, largura: 0, altura: 0,
    quantidade_minima: 1, quantidade_maxima: 0, estoque_total: 0, estoque_reservado: 0,
    rastrear_estoque: true, permitir_backorder: false, quantidade_caixa: 0,
    status_produto: "disponivel", data_disponibilidade: "", unidade_venda: "un",
    ativo: true, barcode: "", codigo_upc: "", codigo_referencia: "",
    quantidade_pacote: 0, meta_descricao: "", descricao_pdf: "", tag_line: "",
    promover_categoria: false, promover_destaque: false, mostrar_ofertas: "nunca",
  });

  // Sub-tab data
  const [galleryImages, setGalleryImages] = useState<{ id?: string; imagem_url: string; ordem: number }[]>([]);
  const [files, setFiles] = useState<{ id?: string; titulo: string; arquivo_url: string }[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customerPrices, setCustomerPrices] = useState<any[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  const [assignedOptions, setAssignedOptions] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [statusRules, setStatusRules] = useState<any[]>([]);
  const [accessGroups, setAccessGroups] = useState<any[]>([]);
  const [priceLists, setPriceLists] = useState<{ tabela_preco_id: string; preco: number }[]>([]);

  useEffect(() => {
    fetchLookups();
    if (!isNew) fetchProduct();
  }, [id]);

  const fetchLookups = async () => {
    const [c, b, tp, cl, po, pg] = await Promise.all([
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("brands").select("id, nome").order("nome"),
      supabase.from("tabelas_preco").select("id, nome").order("nome"),
      supabase.from("clientes").select("id, nome, empresa").order("nome"),
      supabase.from("product_options").select("id, nome, tipo").order("nome"),
      supabase.from("privacy_groups").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    setCategorias(c.data ?? []);
    setBrands(b.data ?? []);
    setTabelasPreco(tp.data ?? []);
    setClientes(cl.data ?? []);
    setProductOptions(po.data ?? []);
    setPrivacyGroups(pg.data ?? []);
  };

  const fetchProduct = async () => {
    const { data, error } = await supabase.from("produtos").select("*").eq("id", id).single();
    if (error || !data) { toast.error("Product not found"); navigate("/admin/products"); return; }

    setForm({
      nome: data.nome, sku: data.sku, descricao: data.descricao ?? "", imagem_url: data.imagem_url ?? "",
      categoria_id: data.categoria_id ?? "", brand_id: data.brand_id ?? "",
      preco: Number(data.preco), custo: Number((data as any).custo ?? 0), preco_msrp: Number((data as any).preco_msrp ?? 0),
      peso: Number((data as any).peso ?? 0), comprimento: Number((data as any).comprimento ?? 0),
      largura: Number((data as any).largura ?? 0), altura: Number((data as any).altura ?? 0),
      quantidade_minima: data.quantidade_minima, quantidade_maxima: (data as any).quantidade_maxima ?? 0,
      estoque_total: data.estoque_total, estoque_reservado: data.estoque_reservado,
      rastrear_estoque: (data as any).rastrear_estoque ?? true, permitir_backorder: (data as any).permitir_backorder ?? false,
      quantidade_caixa: (data as any).quantidade_caixa ?? 0, status_produto: (data as any).status_produto ?? "disponivel",
      data_disponibilidade: (data as any).data_disponibilidade ?? "", unidade_venda: data.unidade_venda,
      ativo: data.ativo, barcode: (data as any).barcode ?? "", codigo_upc: (data as any).codigo_upc ?? "",
      codigo_referencia: (data as any).codigo_referencia ?? "", quantidade_pacote: (data as any).quantidade_pacote ?? 0,
      meta_descricao: (data as any).meta_descricao ?? "", descricao_pdf: (data as any).descricao_pdf ?? "",
      tag_line: (data as any).tag_line ?? "",
      promover_categoria: (data as any).promover_categoria ?? false,
      promover_destaque: (data as any).promover_destaque ?? false,
      mostrar_ofertas: (data as any).mostrar_ofertas ?? "nunca",
    });

    // Fetch sub-data in parallel
    const [imgs, fls, disc, cp, rel, opts, vars, sr, acc, pl] = await Promise.all([
      supabase.from("produto_imagens").select("*").eq("produto_id", id).order("ordem"),
      supabase.from("produto_arquivos").select("*").eq("produto_id", id),
      supabase.from("produto_descontos").select("*").eq("produto_id", id),
      supabase.from("produto_precos_cliente").select("*").eq("produto_id", id),
      supabase.from("produtos_relacionados").select("*").eq("produto_id", id),
      supabase.from("produto_opcoes").select("*").eq("produto_id", id),
      supabase.from("produto_variantes").select("*").eq("produto_id", id),
      supabase.from("produto_status_regras").select("*").eq("produto_id", id),
      supabase.from("produto_acesso").select("*").eq("produto_id", id),
      supabase.from("tabela_preco_itens").select("*").eq("produto_id", id),
    ]);
    setGalleryImages(imgs.data ?? []);
    setFiles(fls.data ?? []);
    setDiscounts(disc.data ?? []);
    setCustomerPrices(cp.data ?? []);
    setRelatedProducts(rel.data ?? []);
    setAssignedOptions(opts.data ?? []);
    setVariants(vars.data ?? []);
    setStatusRules(sr.data ?? []);
    setAccessGroups(acc.data ?? []);
    setPriceLists((pl.data ?? []).map((p: any) => ({ tabela_preco_id: p.tabela_preco_id, preco: Number(p.preco) })));

    setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: "main" | "gallery") => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error("Upload error: " + error.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    if (target === "main") {
      setForm({ ...form, imagem_url: urlData.publicUrl });
    } else {
      setGalleryImages([...galleryImages, { imagem_url: urlData.publicUrl, ordem: galleryImages.length }]);
    }
    setUploading(false);
    toast.success("Image uploaded");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `files/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error("Upload error: " + error.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    setFiles([...files, { titulo: file.name, arquivo_url: urlData.publicUrl }]);
    setUploading(false);
    toast.success("File uploaded");
  };

  const handleSave = async () => {
    if (!form.nome || !form.sku) { toast.error("Name and Code are required"); return; }
    setSaving(true);

    const payload: any = {
      nome: form.nome, sku: form.sku, descricao: form.descricao || null, imagem_url: form.imagem_url || null,
      categoria_id: form.categoria_id || null, brand_id: form.brand_id || null,
      preco: form.preco, custo: form.custo, preco_msrp: form.preco_msrp,
      peso: form.peso, comprimento: form.comprimento, largura: form.largura, altura: form.altura,
      quantidade_minima: form.quantidade_minima, quantidade_maxima: form.quantidade_maxima,
      estoque_total: form.estoque_total, rastrear_estoque: form.rastrear_estoque,
      permitir_backorder: form.permitir_backorder, quantidade_caixa: form.quantidade_caixa,
      status_produto: form.status_produto, data_disponibilidade: form.data_disponibilidade || null,
      unidade_venda: form.unidade_venda, ativo: form.ativo,
      barcode: form.barcode || null, codigo_upc: form.codigo_upc || null,
      codigo_referencia: form.codigo_referencia || null, quantidade_pacote: form.quantidade_pacote || null,
      meta_descricao: form.meta_descricao || null, descricao_pdf: form.descricao_pdf || null,
      tag_line: form.tag_line || null,
      promover_categoria: form.promover_categoria, promover_destaque: form.promover_destaque,
      mostrar_ofertas: form.mostrar_ofertas,
    };

    let productId = id;

    if (isNew) {
      const { data, error } = await supabase.from("produtos").insert(payload).select("id").single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      productId = data.id;
    } else {
      const { error } = await supabase.from("produtos").update(payload).eq("id", id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    }

    // Save sub-data
    await saveSubData(productId!);

    setSaving(false);
    toast.success(isNew ? "Product created" : "Product saved");
    log(isNew ? "created" : "updated", "product", productId!, form.nome as string);
    if (isNew) navigate(`/admin/products/${productId}`);
  };

  const saveSubData = async (pid: string) => {
    // Gallery images
    await supabase.from("produto_imagens").delete().eq("produto_id", pid);
    if (galleryImages.length > 0) {
      await supabase.from("produto_imagens").insert(galleryImages.map((img, i) => ({
        produto_id: pid, imagem_url: img.imagem_url, ordem: i
      })));
    }

    // Files
    await supabase.from("produto_arquivos").delete().eq("produto_id", pid);
    if (files.length > 0) {
      await supabase.from("produto_arquivos").insert(files.map(f => ({
        produto_id: pid, titulo: f.titulo, arquivo_url: f.arquivo_url
      })));
    }

    // Discounts
    await supabase.from("produto_descontos").delete().eq("produto_id", pid);
    if (discounts.length > 0) {
      await supabase.from("produto_descontos").insert(discounts.map(d => ({ ...d, produto_id: pid, id: undefined })));
    }

    // Customer prices
    await supabase.from("produto_precos_cliente").delete().eq("produto_id", pid);
    if (customerPrices.length > 0) {
      await supabase.from("produto_precos_cliente").insert(customerPrices.map(cp => ({ ...cp, produto_id: pid, id: undefined })));
    }

    // Related products
    await supabase.from("produtos_relacionados").delete().eq("produto_id", pid);
    if (relatedProducts.length > 0) {
      await supabase.from("produtos_relacionados").insert(relatedProducts.map(rp => ({ ...rp, produto_id: pid, id: undefined })));
    }

    // Assigned options
    await supabase.from("produto_opcoes").delete().eq("produto_id", pid);
    if (assignedOptions.length > 0) {
      await supabase.from("produto_opcoes").insert(assignedOptions.map(o => ({ produto_id: pid, option_id: o.option_id })));
    }

    // Price lists
    await supabase.from("tabela_preco_itens").delete().eq("produto_id", pid);
    if (priceLists.length > 0) {
      await supabase.from("tabela_preco_itens").insert(priceLists.map(pl => ({
        produto_id: pid, tabela_preco_id: pl.tabela_preco_id, preco: pl.preco
      })));
    }

    // Status rules
    await supabase.from("produto_status_regras").delete().eq("produto_id", pid);
    if (statusRules.length > 0) {
      await supabase.from("produto_status_regras").insert(
        statusRules.map(sr => ({ produto_id: pid, status_nome: sr.status_nome, regra_tipo: sr.regra_tipo, valor_limite: sr.valor_limite }))
      );
    }

    // Access groups
    await supabase.from("produto_acesso").delete().eq("produto_id", pid);
    if (accessGroups.length > 0) {
      await supabase.from("produto_acesso").insert(
        accessGroups.filter(ag => ag.privacy_group_id).map(ag => ({ produto_id: pid, grupo_nome: ag.privacy_group_id }))
      );
    }
  };

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/products")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-display text-xl font-semibold">
              {isNew ? "New Product" : `Editing product: ${form.nome}`}
            </h2>
            {!isNew && (
              <p className="text-xs text-muted-foreground">
                Created: {new Date().toLocaleDateString()} · Last update: {new Date().toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/admin/products")}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          {!isNew && (
            <Button variant="secondary" onClick={async () => { await handleSave(); }} disabled={saving}>
              Save and stay on page
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="product">Product</TabsTrigger>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
          <TabsTrigger value="customer-prices">Customer Prices</TabsTrigger>
          <TabsTrigger value="related">Related Products</TabsTrigger>
          <TabsTrigger value="options">Product Options</TabsTrigger>
          <TabsTrigger value="variants">Code & Price Variants</TabsTrigger>
          <TabsTrigger value="promotion">Promotion</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          <TabsTrigger value="price-lists">Price Lists</TabsTrigger>
          <TabsTrigger value="status-rules">Product Status Rules</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>

        {/* ========== PRODUCT TAB ========== */}
        <TabsContent value="product">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            {/* Left column */}
            <div className="space-y-6">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <Label>Name *</Label>
                      <Input value={form.nome} onChange={e => f("nome", e.target.value)} />
                    </div>
                    <div>
                      <Label>Code *</Label>
                      <Input value={form.sku} onChange={e => f("sku", e.target.value)} />
                    </div>
                    <div>
                      <Label>Category *</Label>
                      <Select value={form.categoria_id} onValueChange={v => f("categoria_id", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Description</Label>
                    <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[160px]"
                      value={form.descricao} onChange={e => f("descricao", e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Image</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-start gap-4">
                    {form.imagem_url ? (
                      <img src={form.imagem_url} alt="Product" className="h-32 w-32 rounded-lg object-cover border" />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded-lg border bg-muted">
                        <ImageIcon className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="cursor-pointer">
                        <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                          <Upload className="h-4 w-4" />{uploading ? "Uploading..." : "Select main image"}
                        </div>
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, "main")} disabled={uploading} />
                      </label>
                      {form.imagem_url && (
                        <Button variant="ghost" size="sm" onClick={() => f("imagem_url", "")} className="text-destructive">
                          <Trash2 className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Dimensions</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    <div><Label>Weight</Label><Input type="number" step="0.01" value={form.peso} onChange={e => f("peso", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Length</Label><Input type="number" step="0.01" value={form.comprimento} onChange={e => f("comprimento", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Width</Label><Input type="number" step="0.01" value={form.largura} onChange={e => f("largura", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Height</Label><Input type="number" step="0.01" value={form.altura} onChange={e => f("altura", parseFloat(e.target.value) || 0)} /></div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div>
                    <Label>Brand</Label>
                    <Select value={form.brand_id} onValueChange={v => f("brand_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-primary">MSRP</Label>
                      <Input type="number" step="0.01" value={form.preco_msrp} onChange={e => f("preco_msrp", parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <Label className="text-primary">Cost</Label>
                      <Input type="number" step="0.01" value={form.custo} onChange={e => f("custo", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-primary">Wholesale Price</Label>
                    <Input type="number" step="0.01" value={form.preco} onChange={e => f("preco", parseFloat(e.target.value) || 0)} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Minimum Quantity</Label><Input type="number" value={form.quantidade_minima} onChange={e => f("quantidade_minima", parseInt(e.target.value) || 0)} /></div>
                    <div><Label>Maximum Quantity</Label><Input type="number" value={form.quantidade_maxima} onChange={e => f("quantidade_maxima", parseInt(e.target.value) || 0)} /></div>
                  </div>

                  <div>
                    <Label>Quantity (Stock)</Label>
                    <Input type="number" value={form.estoque_total} onChange={e => f("estoque_total", parseInt(e.target.value) || 0)} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={form.rastrear_estoque} onCheckedChange={v => f("rastrear_estoque", !!v)} />
                      <Label className="text-sm">Track Inventory</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={form.permitir_backorder} onCheckedChange={v => f("permitir_backorder", !!v)} />
                      <Label className="text-sm">Allow Backorder</Label>
                    </div>
                  </div>

                  <div>
                    <Label>Box Quantity / Multiples</Label>
                    <Input type="number" value={form.quantidade_caixa} onChange={e => f("quantidade_caixa", parseInt(e.target.value) || 0)} />
                  </div>

                  <div>
                    <Label>Status</Label>
                    <Select value={form.status_produto} onValueChange={v => f("status_produto", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Estimated Availability Date</Label>
                    <Input type="date" value={form.data_disponibilidade?.split("T")[0] ?? ""} onChange={e => f("data_disponibilidade", e.target.value)} />
                  </div>

                  <div>
                    <Label>Unit of Sale</Label>
                    <Input value={form.unidade_venda} onChange={e => f("unidade_venda", e.target.value)} />
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Checkbox checked={form.ativo} onCheckedChange={v => f("ativo", !!v)} />
                    <Label className="text-sm font-medium">Is Active?</Label>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ========== DISCOUNTS TAB ========== */}
        <TabsContent value="discounts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Discounts</CardTitle>
              <Button size="sm" onClick={() => setDiscounts([...discounts, { tabela_preco_id: "", percentual: 0, preco_final: null, quantidade_minima: 0, data_inicio: null, data_fim: null }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Discount
              </Button>
            </CardHeader>
            <CardContent>
              {discounts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No discounts configured. Click "Add Discount" to create one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Price List</TableHead><TableHead>From Qty</TableHead>
                      <TableHead>Percentage (%)</TableHead><TableHead>Date From</TableHead>
                      <TableHead>Date To</TableHead><TableHead>Final Price</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discounts.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={d.tabela_preco_id} onValueChange={v => { const nd = [...discounts]; nd[i].tabela_preco_id = v; setDiscounts(nd); }}>
                            <SelectTrigger className="w-40"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>{tabelasPreco.map(tp => <SelectItem key={tp.id} value={tp.id}>{tp.nome}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" className="w-20" value={d.quantidade_minima} onChange={e => { const nd = [...discounts]; nd[i].quantidade_minima = parseInt(e.target.value) || 0; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-20" value={d.percentual} onChange={e => { const nd = [...discounts]; nd[i].percentual = parseFloat(e.target.value) || 0; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="date" className="w-36" value={d.data_inicio?.split("T")[0] ?? ""} onChange={e => { const nd = [...discounts]; nd[i].data_inicio = e.target.value || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="date" className="w-36" value={d.data_fim?.split("T")[0] ?? ""} onChange={e => { const nd = [...discounts]; nd[i].data_fim = e.target.value || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-24" value={d.preco_final ?? ""} onChange={e => { const nd = [...discounts]; nd[i].preco_final = parseFloat(e.target.value) || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setDiscounts(discounts.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== CUSTOMER PRICES TAB ========== */}
        <TabsContent value="customer-prices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Customer Prices</CardTitle>
              <Button size="sm" onClick={() => setCustomerPrices([...customerPrices, { cliente_id: "", preco: 0, aplicar_descontos_extras: false }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {customerPrices.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No customer-specific prices. Click "Add" to create one.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Price</TableHead><TableHead>Apply Extra Discounts</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {customerPrices.map((cp, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={cp.cliente_id} onValueChange={v => { const n = [...customerPrices]; n[i].cliente_id = v; setCustomerPrices(n); }}>
                            <SelectTrigger className="w-52"><SelectValue placeholder="Select customer" /></SelectTrigger>
                            <SelectContent>{clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome} - {c.empresa}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-28" value={cp.preco} onChange={e => { const n = [...customerPrices]; n[i].preco = parseFloat(e.target.value) || 0; setCustomerPrices(n); }} /></TableCell>
                        <TableCell>
                          <Checkbox checked={cp.aplicar_descontos_extras} onCheckedChange={v => { const n = [...customerPrices]; n[i].aplicar_descontos_extras = !!v; setCustomerPrices(n); }} />
                        </TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setCustomerPrices(customerPrices.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== RELATED PRODUCTS TAB ========== */}
        <TabsContent value="related">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Related / Bundled Products</CardTitle>
              <Button size="sm" onClick={() => setRelatedProducts([...relatedProducts, { produto_relacionado_id: "", comprar_junto: false }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {relatedProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No related products. Click "Add" to link products.</p>
              ) : (
                <div className="space-y-2">
                  {relatedProducts.map((rp, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Input placeholder="Product ID" value={rp.produto_relacionado_id} onChange={e => { const n = [...relatedProducts]; n[i].produto_relacionado_id = e.target.value; setRelatedProducts(n); }} className="flex-1" />
                      <div className="flex items-center gap-2">
                        <Checkbox checked={rp.comprar_junto} onCheckedChange={v => { const n = [...relatedProducts]; n[i].comprar_junto = !!v; setRelatedProducts(n); }} />
                        <Label className="text-xs">Buy Together</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setRelatedProducts(relatedProducts.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRODUCT OPTIONS TAB ========== */}
        <TabsContent value="options">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Options</CardTitle>
              <Button size="sm" onClick={() => setAssignedOptions([...assignedOptions, { option_id: "" }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Option
              </Button>
            </CardHeader>
            <CardContent>
              {assignedOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No options assigned. Click "Add Option" to assign one (max 2).</p>
              ) : (
                <div className="space-y-2">
                  {assignedOptions.map((o, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Select value={o.option_id} onValueChange={v => { const n = [...assignedOptions]; n[i].option_id = v; setAssignedOptions(n); }}>
                        <SelectTrigger className="w-60"><SelectValue placeholder="Select option" /></SelectTrigger>
                        <SelectContent>{productOptions.map(po => <SelectItem key={po.id} value={po.id}>{po.nome} ({po.tipo})</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setAssignedOptions(assignedOptions.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== CODE & PRICE VARIANTS TAB ========== */}
        <TabsContent value="variants">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Code & Price Variants</CardTitle>
              <Button size="sm" onClick={() => setVariants([...variants, { codigo: "", ativo: true, quantidade: 0, imagem_url: "", valores_opcao: [] }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Variant
              </Button>
            </CardHeader>
            <CardContent>
              {variants.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No variants. Assign Product Options first, then create variants here.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Active</TableHead><TableHead>Code</TableHead><TableHead>Quantity</TableHead><TableHead /><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {variants.map((v, i) => (
                      <TableRow key={i}>
                        <TableCell><Checkbox checked={v.ativo} onCheckedChange={val => { const n = [...variants]; n[i].ativo = !!val; setVariants(n); }} /></TableCell>
                        <TableCell><Input value={v.codigo} onChange={e => { const n = [...variants]; n[i].codigo = e.target.value; setVariants(n); }} className="w-40" /></TableCell>
                        <TableCell><Input type="number" value={v.quantidade} onChange={e => { const n = [...variants]; n[i].quantidade = parseInt(e.target.value) || 0; setVariants(n); }} className="w-24" /></TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PROMOTION TAB ========== */}
        <TabsContent value="promotion">
          <Card>
            <CardHeader><CardTitle className="text-base">Promotion Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox checked={form.promover_categoria} onCheckedChange={v => f("promover_categoria", !!v)} />
                <Label>Promote in category page</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">Show product on top of its category products list</p>

              <div className="flex items-center gap-2">
                <Checkbox checked={form.promover_destaque} onCheckedChange={v => f("promover_destaque", !!v)} />
                <Label>Promote in front page</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">Show product in the "Featured Products" section on the storefront home page</p>

              <div>
                <Label>Show in Deals page</Label>
                <Select value={form.mostrar_ofertas} onValueChange={v => f("mostrar_ofertas", v)}>
                  <SelectTrigger className="w-72 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ofertasOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== IMAGES TAB ========== */}
        <TabsContent value="images">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Gallery Images</CardTitle>
              <label className="cursor-pointer">
                <Button size="sm" asChild><span><Upload className="h-3 w-3 mr-1" /> Upload Image</span></Button>
                <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, "gallery")} disabled={uploading} />
              </label>
            </CardHeader>
            <CardContent>
              {galleryImages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No gallery images. Upload images to show on the product page.</p>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {galleryImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.imagem_url} alt={`Gallery ${i}`} className="h-32 w-full rounded-lg object-cover border" />
                      <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setGalleryImages(galleryImages.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== FILES TAB ========== */}
        <TabsContent value="files">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Files</CardTitle>
              <label className="cursor-pointer">
                <Button size="sm" asChild><span><Upload className="h-3 w-3 mr-1" /> Upload File</span></Button>
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No files attached. Upload PDFs, documents or other files.</p>
              ) : (
                <div className="space-y-2">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <Input value={file.titulo} onChange={e => { const n = [...files]; n[i].titulo = e.target.value; setFiles(n); }} className="flex-1" />
                      <a href={file.arquivo_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View</a>
                      <Button variant="ghost" size="icon" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== ADVANCED TAB ========== */}
        <TabsContent value="advanced">
          <Card>
            <CardHeader><CardTitle className="text-base">Advanced Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div><Label>UPC Code</Label><Input value={form.codigo_upc} onChange={e => f("codigo_upc", e.target.value)} /></div>
                <div><Label>Barcode</Label><Input value={form.barcode} onChange={e => f("barcode", e.target.value)} /></div>
                <div><Label>Reference Code</Label><Input value={form.codigo_referencia} onChange={e => f("codigo_referencia", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Package Quantity</Label><Input type="number" value={form.quantidade_pacote} onChange={e => f("quantidade_pacote", parseInt(e.target.value) || 0)} /></div>
                <div><Label>Tag Line</Label><Input value={form.tag_line} onChange={e => f("tag_line", e.target.value)} /></div>
              </div>
              <div>
                <Label>Meta Description</Label>
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.meta_descricao} onChange={e => f("meta_descricao", e.target.value)} />
              </div>
              <div>
                <Label>PDF Catalog Description</Label>
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.descricao_pdf} onChange={e => f("descricao_pdf", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRICE LISTS TAB ========== */}
        <TabsContent value="price-lists">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Price Lists</CardTitle>
              <Button size="sm" onClick={() => setPriceLists([...priceLists, { tabela_preco_id: "", preco: 0 }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {priceLists.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No price list overrides. Product uses the default wholesale price for all price lists.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Price List</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priceLists.map((pl, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={pl.tabela_preco_id} onValueChange={v => { const n = [...priceLists]; n[i].tabela_preco_id = v; setPriceLists(n); }}>
                            <SelectTrigger className="w-52"><SelectValue placeholder="Select price list" /></SelectTrigger>
                            <SelectContent>{tabelasPreco.map(tp => <SelectItem key={tp.id} value={tp.id}>{tp.nome}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" className="w-32" value={pl.preco} onChange={e => { const n = [...priceLists]; n[i].preco = parseFloat(e.target.value) || 0; setPriceLists(n); }} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => setPriceLists(priceLists.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRODUCT STATUS RULES TAB ========== */}
        <TabsContent value="status-rules">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Status Rules</CardTitle>
              <Button size="sm" onClick={() => setStatusRules([...statusRules, { status_nome: "", regra_tipo: "quantidade", valor_limite: 0 }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              {statusRules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No status rules configured. Add rules to automatically change product status based on inventory.</p>
              ) : (
                <div className="space-y-2">
                  {statusRules.map((sr, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Select value={sr.status_nome} onValueChange={v => { const n = [...statusRules]; n[i].status_nome = v; setStatusRules(n); }}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>{statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">when quantity ≤</span>
                      <Input type="number" className="w-24" value={sr.valor_limite} onChange={e => { const n = [...statusRules]; n[i].valor_limite = parseInt(e.target.value) || 0; setStatusRules(n); }} />
                      <Button variant="ghost" size="icon" onClick={() => setStatusRules(statusRules.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== ACCESS TAB ========== */}
        <TabsContent value="access">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Access / Privacy Groups</CardTitle>
              <Button size="sm" onClick={() => setAccessGroups([...accessGroups, { privacy_group_id: "" }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Group
              </Button>
            </CardHeader>
            <CardContent>
              {accessGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No access restrictions. All customers can see this product. Add privacy groups to restrict access.</p>
              ) : (
                <div className="space-y-2">
                  {accessGroups.map((ag, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Select
                        value={ag.privacy_group_id}
                        onValueChange={(v) => { const n = [...accessGroups]; n[i].privacy_group_id = v; setAccessGroups(n); }}
                      >
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select privacy group..." /></SelectTrigger>
                        <SelectContent>
                          {privacyGroups.map((pg) => (
                            <SelectItem key={pg.id} value={pg.id}>{pg.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setAccessGroups(accessGroups.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default ProductEdit;
