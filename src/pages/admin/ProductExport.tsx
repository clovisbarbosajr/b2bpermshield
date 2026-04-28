import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/export-csv";

const AdminProductExport = () => {
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [selectedPriceList, setSelectedPriceList] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedPrivacyGroup, setSelectedPrivacyGroup] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("tabelas_preco").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("privacy_groups").select("id, nome").eq("ativo", true).order("nome"),
    ]).then(([pl, cat, pg]) => {
      setPriceLists(pl.data ?? []);
      setCategories(cat.data ?? []);
      setPrivacyGroups(pg.data ?? []);
    });
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch products with category
      let query = supabase.from("produtos").select("*, categorias(nome)");
      if (selectedCategory !== "all") query = query.eq("categoria_id", selectedCategory);
      const { data: products, error } = await query;
      if (error) throw error;
      if (!products?.length) { toast.error("No products found"); setExporting(false); return; }

      // Fetch price list items if specific price list selected
      let priceMap: Record<string, Record<string, number>> = {};
      let priceListNames: string[] = [];

      if (selectedPriceList === "all") {
        const { data: allItems } = await supabase.from("tabela_preco_itens").select("produto_id, preco, tabela_preco_id, tabelas_preco(nome)");
        (allItems ?? []).forEach((item: any) => {
          const plName = item.tabelas_preco?.nome || item.tabela_preco_id;
          if (!priceMap[plName]) priceMap[plName] = {};
          priceMap[plName][item.produto_id] = item.preco;
          if (!priceListNames.includes(plName)) priceListNames.push(plName);
        });
      } else {
        const pl = priceLists.find(p => p.id === selectedPriceList);
        const plName = pl?.nome || selectedPriceList;
        priceListNames = [plName];
        const { data: items } = await supabase.from("tabela_preco_itens").select("produto_id, preco").eq("tabela_preco_id", selectedPriceList);
        priceMap[plName] = {};
        (items ?? []).forEach((item: any) => { priceMap[plName][item.produto_id] = item.preco; });
      }

      // If privacy group selected, filter by produto_acesso
      let filteredProducts = products;
      if (selectedPrivacyGroup) {
        const pg = privacyGroups.find(g => g.id === selectedPrivacyGroup);
        if (pg) {
          const { data: access } = await supabase.from("produto_acesso").select("produto_id").eq("grupo_nome", pg.nome);
          const accessIds = new Set((access ?? []).map(a => a.produto_id));
          filteredProducts = products.filter(p => accessIds.has(p.id));
        }
      }

      // Build export rows matching B2B Wave format
      const rows = filteredProducts.map(p => {
        const row: Record<string, any> = {
          product_sku: p.sku,
          category_path: (p.categorias as any)?.nome || "",
          product_name: p.nome,
          product_desc: p.descricao || "",
        };
        priceListNames.forEach(plName => {
          row[plName] = priceMap[plName]?.[p.id] ?? "";
        });
        Object.assign(row, {
          length: p.comprimento || "",
          width: p.largura || "",
          height: p.altura || "",
          brand: "",
          product_unit: p.unidade_venda,
          product_active: p.ativo ? 1 : 0,
          quantity: p.estoque_total,
          quantity_monitor: p.rastrear_estoque ? 1 : 0,
          can_backorder: p.permitir_backorder ? 1 : 0,
          minimum_quantity: p.quantidade_minima,
          maximum_quantity: p.quantidade_maxima || "",
          box_quantity: p.quantidade_caixa || "",
          barcode: p.barcode || "",
          reference_code: p.codigo_referencia || "",
          product_upc: p.codigo_upc || "",
        });
        return row;
      });

      // Log export
      await supabase.from("export_logs").insert({ tipo: "Products", status: "concluido", registros: rows.length });

      const plLabel = selectedPriceList === "all" ? "All-PriceLists" : priceLists.find(p => p.id === selectedPriceList)?.nome || "PriceList";
      const catLabel = selectedCategory === "all" ? "All-Categories" : categories.find(c => c.id === selectedCategory)?.nome || "Category";
      exportToCSV(rows, `${catLabel}-${plLabel}`);
      toast.success(`${rows.length} products exported`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setExporting(false);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Products export</h2>
      </div>
      <div className="space-y-5 max-w-4xl">
        <div>
          <Label className="text-primary">Price List *</Label>
          <Select value={selectedPriceList} onValueChange={setSelectedPriceList}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {priceLists.map(pl => <SelectItem key={pl.id} value={pl.id}>{pl.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-primary">Category *</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-primary">Privacy group</Label>
          <Select value={selectedPrivacyGroup || "__none__"} onValueChange={v => setSelectedPrivacyGroup(v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Choose privacy group" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Choose privacy group</SelectItem>
              {privacyGroups.map(pg => <SelectItem key={pg.id} value={pg.id}>{pg.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleExport} disabled={exporting} className="bg-primary">
          {exporting ? "Exporting..." : "Export"}
        </Button>
      </div>
    </AdminLayout>
  );
};

export default AdminProductExport;
