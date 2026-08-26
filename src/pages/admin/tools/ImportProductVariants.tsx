import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { parseCSV } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetchAllRows";
const TEMPLATE_HEADERS = ["parent_sku", "variant_sku", "variant_name", "option_value", "price", "stock"];
const TEMPLATE_ROW = ["PROD-001", "PROD-001-AZ", "Azul 1L", "Azul", "45.90", "100"];

type Result = { row: number; sku: string; status: "ok" | "error"; message: string };

const ImportProductVariants = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_product_variants_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    // PAGINADO e com ERRO CHECADO. Antes era `.select()` solto: o PostgREST corta
    // em 1000 linhas SEM erro, entao do produto 1001 em diante o SKU do pai nao
    // era encontrado e a variante era descartada com "Parent product not found" —
    // mensagem mentirosa, porque o produto existe.
    let produtos: any[];
    let existentes: any[];
    try {
      produtos = await fetchAllRows<any>((from, to) =>
        supabase.from("produtos").select("id, sku")
          .order("id", { ascending: true }).range(from, to));
      // Variantes JA cadastradas, para nao duplicar (ver abaixo).
      existentes = await fetchAllRows<any>((from, to) =>
        supabase.from("produto_variantes").select("id, produto_id, codigo")
          .order("id", { ascending: true }).range(from, to));
    } catch (e: any) {
      toast.error("Could not read products/variants — import cancelled: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    const skuMap: Record<string, string> = {};
    produtos.forEach((p: any) => { if (p.sku) skuMap[p.sku] = p.id; });

    // NAO EXISTE UNIQUE em (produto_id, codigo) — o proprio ProductEdit comenta
    // isso. Sem este mapa, rodar o MESMO arquivo duas vezes duplicava todas as
    // variantes, e o carrinho passava a mostrar dois "Tam M" para o cliente
    // escolher, cada um com seu estoque.
    const variantesPorChave = new Map<string, string>();
    for (const v of existentes) {
      if (v.produto_id && v.codigo) {
        variantesPorChave.set(`${v.produto_id}|${String(v.codigo).trim().toLowerCase()}`, v.id);
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const parentSku = r["parent_sku"]?.trim();
      const variantSku = r["variant_sku"]?.trim();

      if (!parentSku || !variantSku) {
        res.push({ row: i + 2, sku: variantSku || "â€”", status: "error", message: "Missing parent_sku or variant_sku" });
        continue;
      }

      const parentId = skuMap[parentSku];
      if (!parentId) {
        res.push({ row: i + 2, sku: variantSku, status: "error", message: `Parent product not found: ${parentSku}` });
        continue;
      }

      const stockBruto = String(r["stock"] ?? "").trim();
      const stock = stockBruto === "" ? 0 : Number(stockBruto);
      if (!Number.isInteger(stock) || stock < 0) {
        res.push({ row: i + 2, sku: variantSku, status: "error", message: `Invalid stock "${stockBruto}"` });
        continue;
      }

      const chave = `${parentId}|${variantSku.trim().toLowerCase()}`;
      const jaExiste = variantesPorChave.get(chave);

      const dados: any = {
        produto_id: parentId,
        codigo: variantSku,
        valores_opcao: r["option_value"] ? [r["option_value"]] : [],
        quantidade: stock,
      };

      let error: any = null;
      if (jaExiste) {
        // ATUALIZA em vez de criar outra. Antes, reimportar o mesmo arquivo
        // duplicava a variante inteira.
        const r2 = await (supabase.from("produto_variantes") as any).update(dados).eq("id", jaExiste);
        error = r2.error;
      } else {
        const r2 = await (supabase.from("produto_variantes") as any).insert(dados).select("id").single();
        error = r2.error;
        // Duas linhas do MESMO arquivo com a mesma variante duplicariam entre si.
        if (!error && r2.data?.id) variantesPorChave.set(chave, r2.data.id);
      }

      if (error) {
        res.push({ row: i + 2, sku: variantSku, status: "error", message: error.message });
      } else {
        res.push({ row: i + 2, sku: variantSku, status: "ok", message: jaExiste ? "Updated" : "Inserted" });
      }
    }

    setResults(res);
    setImporting(false);
    const okVar = res.filter((r) => r.status === "ok").length;
    const errVar = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okVar} of ${rows.length} variants`);
    supabase.from("import_logs").insert({ tipo: "product_variants", arquivo_nome: file.name, registros_total: rows.length, registros_erro: errVar, registros_sucesso: rows.length - errVar, status: errVar === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Product Variants</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import product variant data via CSV.</p>
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
            <p><strong>Required:</strong> parent_sku, variant_sku</p>
            <p><strong>Optional:</strong> variant_name, option_value, price, stock (defaults to 0)</p>
            <p><strong>Note:</strong> parent_sku must match an existing product SKU.</p>
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
                <TableHead>Variant SKU</TableHead>
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

export default ImportProductVariants;
