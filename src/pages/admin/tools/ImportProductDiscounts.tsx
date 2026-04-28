import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_HEADERS = ["product_sku", "discount_percent", "price_list_name"];
const TEMPLATE_ROW = ["PROD-001", "15", "Tabela Revendedores"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return row;
  });
}

type Result = { row: number; sku: string; status: "ok" | "error"; message: string };

const ImportProductDiscounts = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_product_discounts_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    // Fetch produtos sku→id map
    const { data: produtos } = await supabase.from("produtos").select("id, sku");
    const skuMap: Record<string, string> = {};
    (produtos ?? []).forEach((p: any) => { if (p.sku) skuMap[p.sku] = p.id; });

    // Fetch tabelas_preco nome→id map
    const { data: tabelas } = await supabase.from("tabelas_preco").select("id, nome");
    const tabelaMap: Record<string, string> = {};
    (tabelas ?? []).forEach((t: any) => { if (t.nome) tabelaMap[t.nome.toLowerCase()] = t.id; });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sku = r["product_sku"]?.trim();

      if (!sku) {
        res.push({ row: i + 2, sku: "—", status: "error", message: "Missing product_sku" });
        continue;
      }

      const produtoId = skuMap[sku];
      if (!produtoId) {
        res.push({ row: i + 2, sku, status: "error", message: `Product not found: ${sku}` });
        continue;
      }

      const discountPercent = parseFloat(r["discount_percent"]);
      if (isNaN(discountPercent)) {
        res.push({ row: i + 2, sku, status: "error", message: `Invalid discount_percent: ${r["discount_percent"]}` });
        continue;
      }

      const priceListName = r["price_list_name"]?.trim();

      if (priceListName) {
        const tabelaId = tabelaMap[priceListName.toLowerCase()];
        if (!tabelaId) {
          res.push({ row: i + 2, sku, status: "error", message: `Price list not found: ${priceListName}` });
          continue;
        }

        const { error } = await (supabase.from("tabela_preco_itens") as any).upsert(
          { tabela_preco_id: tabelaId, produto_id: produtoId, preco: null, desconto: discountPercent },
          { onConflict: "tabela_preco_id,produto_id" }
        );

        if (error) {
          res.push({ row: i + 2, sku, status: "error", message: error.message });
        } else {
          res.push({ row: i + 2, sku, status: "ok", message: `Discount set in price list "${priceListName}"` });
        }
      } else {
        // No price list: update product's base discount
        const { error } = await supabase.from("produtos").update({ desconto: discountPercent } as any).eq("id", produtoId);

        if (error) {
          res.push({ row: i + 2, sku, status: "error", message: error.message });
        } else {
          res.push({ row: i + 2, sku, status: "ok", message: `Base discount updated to ${discountPercent}%` });
        }
      }
    }

    setResults(res);
    setImporting(false);
    const okDis = res.filter((r) => r.status === "ok").length;
    const errDis = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okDis} of ${rows.length} discounts`);
    supabase.from("import_logs").insert({ tipo: "product_discounts", arquivo: file.name, registros: rows.length, erros: errDis, status: errDis === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Product Discounts</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import product discount rules via CSV.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Upload CSV</h3>
          <p className="mt-2 text-sm text-muted-foreground">Columns: <code className="text-xs bg-muted px-1 rounded">{TEMPLATE_HEADERS.join(", ")}</code></p>
          <div
            className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <div className="text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{fileName || "Drag & drop or click to browse"}</p>
              <Button variant="outline" className="mt-4 gap-2" disabled={importing}>
                <Upload className="h-4 w-4" />{importing ? "Importing..." : "Choose File"}
              </Button>
            </div>
          </div>
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </Card>
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Template</h3>
          <p className="mt-2 text-sm text-muted-foreground">Download the CSV template.</p>
          <Button variant="outline" className="mt-4 w-full gap-2" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download Template
          </Button>
          <div className="mt-4 rounded border p-3 text-xs text-muted-foreground space-y-1">
            <p><strong>Required:</strong> product_sku, discount_percent</p>
            <p><strong>Optional:</strong> price_list_name — if provided, applies to that price list; otherwise updates base product discount.</p>
          </div>
        </Card>
      </div>
      {results.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Import Results</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-green-400">{results.filter((r) => r.status === "ok").length} ok</span>
              <span className="text-destructive">{results.filter((r) => r.status === "error").length} errors</span>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.sku}</TableCell>
                  <TableCell>{r.status === "ok" ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default ImportProductDiscounts;
