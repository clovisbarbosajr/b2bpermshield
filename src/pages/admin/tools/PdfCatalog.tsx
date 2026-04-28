import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";

type Categoria = { id: string; nome: string; parent_id: string | null };
type TabelaPreco = { id: string; nome: string };

const perPageOptions = [
  { value: "9", label: "9 (3x3)" },
  { value: "12", label: "12 (3x4)" },
  { value: "16", label: "16 (4x4)" },
  { value: "25", label: "25 (5x5)" },
];

const sortOptions = [
  { value: "default", label: "Default" },
  { value: "name_asc", label: "Name (A-Z)" },
  { value: "name_desc", label: "Name (Z-A)" },
  { value: "price_asc", label: "Price (Low to High)" },
  { value: "price_desc", label: "Price (High to Low)" },
  { value: "sku_asc", label: "Code (A-Z)" },
];

const statusOptions = [
  { value: "disponivel", label: "Available" },
  { value: "estoque_limitado", label: "Limited Stock" },
  { value: "esgotado", label: "Sold Out" },
  { value: "pre_venda", label: "Pre-order" },
  { value: "indisponivel", label: "Not Available" },
  { value: "descontinuado", label: "Discontinued" },
];

const PdfCatalog = () => {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<TabelaPreco[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedPriceList, setSelectedPriceList] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["disponivel"]);
  const [onlyWithDiscounts, setOnlyWithDiscounts] = useState(false);
  const [hidePrices, setHidePrices] = useState(false);
  const [perPage, setPerPage] = useState("9");
  const [sortBy, setSortBy] = useState("default");

  // Display options
  const [showCategoryPath, setShowCategoryPath] = useState(false);
  const [showProductStatus, setShowProductStatus] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [showAvailableQty, setShowAvailableQty] = useState(false);
  const [showMinQty, setShowMinQty] = useState(false);
  const [showDetailedDiscounts, setShowDetailedDiscounts] = useState(false);
  const [showUpcCode, setShowUpcCode] = useState(false);
  const [showMsrp, setShowMsrp] = useState(false);
  const [showQuickOrderLink, setShowQuickOrderLink] = useState(false);

  // Selected products (optional filter)
  const [selectProducts, setSelectProducts] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const [c, tp] = await Promise.all([
        supabase.from("categorias").select("id, nome, parent_id").order("ordem").order("nome"),
        supabase.from("tabelas_preco").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      setCategorias(c.data ?? []);
      setTabelasPreco(tp.data ?? []);
      if (tp.data && tp.data.length > 0) setSelectedPriceList(tp.data[0].id);
      setLoading(false);
    };
    fetch();
  }, []);

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleStatus = (value: string) => {
    setSelectedStatuses(prev =>
      prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
    );
  };

  const buildCategoryTree = (parentId: string | null = null, level: number = 0): React.ReactNode[] => {
    return categorias
      .filter(c => c.parent_id === parentId)
      .map(c => (
        <div key={c.id}>
          <div
            className={`px-2 py-1 cursor-pointer text-sm hover:bg-accent/10 transition-colors ${
              selectedCategories.includes(c.id) ? "bg-accent/20 text-accent-foreground font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + level * 16}px` }}
            onClick={() => toggleCategory(c.id)}
          >
            {level > 0 && "– "}{c.nome}
          </div>
          {buildCategoryTree(c.id, level + 1)}
        </div>
      ));
  };

  const handleGenerate = async () => {
    if (!selectedPriceList) { toast.error("Please select a Price List"); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-pdf", {
        body: {
          type: "catalog",
          categories: selectedCategories,
          price_list_id: selectedPriceList,
          statuses: selectedStatuses,
          sort_by: sortBy,
          per_page: parseInt(perPage),
          only_with_discounts: onlyWithDiscounts,
          hide_prices: hidePrices,
          options: {
            showCategoryPath, showProductStatus, showDescription,
            showAvailableQty, showMinQty, showDetailedDiscounts,
            showUpcCode, showMsrp, showQuickOrderLink,
          },
        },
      });
      if (error) throw error;
      if (data?.html) {
        const win = window.open("", "_blank");
        if (win) { win.document.write(data.html); win.document.close(); setTimeout(() => win.print(), 500); }
      }
      toast.success("Catalog generated!");
    } catch (err: any) {
      toast.error("Error: " + (err.message ?? "Failed to generate"));
    }
    setGenerating(false);
  };

  if (loading) return (
    <AdminLayout><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Catalog</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_300px]">
        {/* Left: Categories */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary">Categories *</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[280px] overflow-y-auto border rounded-md mx-4 mb-4">
              {buildCategoryTree()}
            </div>
          </CardContent>
        </Card>

        {/* Middle: Filters */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label className="text-primary">Price List *</Label>
                <Select value={selectedPriceList} onValueChange={setSelectedPriceList}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {tabelasPreco.map(tp => (
                      <SelectItem key={tp.id} value={tp.id}>{tp.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Customer</Label>
                <Input placeholder="SEARCH" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
              </div>

              <div>
                <Label className="text-primary">Product Status *</Label>
                <div className="border rounded-md max-h-[140px] overflow-y-auto mt-1">
                  {statusOptions.map(s => (
                    <div
                      key={s.value}
                      className={`px-3 py-1.5 cursor-pointer text-sm hover:bg-accent/10 ${
                        selectedStatuses.includes(s.value) ? "bg-accent/20 font-medium" : ""
                      }`}
                      onClick={() => toggleStatus(s.value)}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={onlyWithDiscounts} onCheckedChange={v => setOnlyWithDiscounts(!!v)} />
                  <Label className="text-sm">Only products with discounts</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={hidePrices} onCheckedChange={v => setHidePrices(!!v)} />
                  <Label className="text-sm">Hide prices</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button variant="outline" size="sm" className="text-primary" onClick={() => setSelectProducts(!selectProducts)}>
            Select products
          </Button>

          <div>
            <Label className="text-primary">Per page *</Label>
            <Select value={perPage} onValueChange={setPerPage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {perPageOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Right: Display Options + Sort */}
        <div className="space-y-4">
          <div>
            <Label className="text-primary">Sort by *</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sortOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 pt-2">
            {[
              { checked: showCategoryPath, set: setShowCategoryPath, label: "Show full category path in title" },
              { checked: showProductStatus, set: setShowProductStatus, label: "Show product status" },
              { checked: showDescription, set: setShowDescription, label: "Show product description", sub: "Add description for PDF in Product's Advanced section→PDF Description" },
              { checked: showAvailableQty, set: setShowAvailableQty, label: "Show available quantity" },
              { checked: showMinQty, set: setShowMinQty, label: "Show minimum quantity" },
              { checked: showDetailedDiscounts, set: setShowDetailedDiscounts, label: "Show detailed product discounts", sub: "Only first 3 discounts will be shown" },
              { checked: showUpcCode, set: setShowUpcCode, label: "Show UPC code" },
              { checked: showMsrp, set: setShowMsrp, label: "Show MSRP" },
              { checked: showQuickOrderLink, set: setShowQuickOrderLink, label: "Show quick order link" },
            ].map((opt, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <Checkbox checked={opt.checked} onCheckedChange={v => opt.set(!!v)} />
                  <Label className="text-sm text-primary cursor-pointer">{opt.label}</Label>
                </div>
                {opt.sub && <p className="text-xs text-muted-foreground ml-6">{opt.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button onClick={handleGenerate} disabled={generating} className="gap-2">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Generate PDF
        </Button>
      </div>
    </AdminLayout>
  );
};

export default PdfCatalog;
