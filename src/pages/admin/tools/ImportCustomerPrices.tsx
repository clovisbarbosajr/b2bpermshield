import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_HEADERS = ["customer_email", "product_sku", "price"];
const TEMPLATE_ROW = ["john@acme.com", "PROD-001", "89.90"];

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

type Result = { row: number; key: string; status: "ok" | "error"; message: string };

const ImportCustomerPrices = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_customer_prices_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    // Fetch clientes email→id map
    const { data: clientes } = await supabase.from("clientes").select("id, email");
    const emailMap: Record<string, string> = {};
    (clientes ?? []).forEach((c: any) => { emailMap[c.email] = c.id; });

    // Fetch produtos sku→id map
    const { data: produtos } = await supabase.from("produtos").select("id, sku");
    const skuMap: Record<string, string> = {};
    (produtos ?? []).forEach((p: any) => { if (p.sku) skuMap[p.sku] = p.id; });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r["customer_email"]?.trim();
      const sku = r["product_sku"]?.trim();
      const key = `${email} / ${sku}`;

      if (!email || !sku) {
        res.push({ row: i + 2, key, status: "error", message: "Missing customer_email or product_sku" });
        continue;
      }

      const clienteId = emailMap[email];
      if (!clienteId) {
        res.push({ row: i + 2, key, status: "error", message: `Customer not found: ${email}` });
        continue;
      }

      const produtoId = skuMap[sku];
      if (!produtoId) {
        res.push({ row: i + 2, key, status: "error", message: `Product not found: ${sku}` });
        continue;
      }

      const preco = parseFloat(r["price"]);
      if (isNaN(preco)) {
        res.push({ row: i + 2, key, status: "error", message: `Invalid price: ${r["price"]}` });
        continue;
      }

      const { error } = await supabase.from("produto_precos_cliente").upsert(
        { cliente_id: clienteId, produto_id: produtoId, preco },
        { onConflict: "cliente_id,produto_id" }
      );

      if (error) {
        res.push({ row: i + 2, key, status: "error", message: error.message });
      } else {
        res.push({ row: i + 2, key, status: "ok", message: "Upserted" });
      }
    }

    setResults(res);
    setImporting(false);
    const okPr = res.filter((r) => r.status === "ok").length;
    const errPr = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okPr} of ${rows.length} prices`);
    supabase.from("import_logs").insert({ tipo: "customer_prices", arquivo: file.name, registros: rows.length, erros: errPr, status: errPr === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Customer Prices</h2>
        <p className="mt-1 text-sm text-muted-foreground">Upload a CSV to set custom pricing per customer.</p>
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
          <p className="mt-2 text-sm text-muted-foreground">Download the CSV template to see the required format.</p>
          <Button variant="outline" className="mt-4 w-full gap-2" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download Template
          </Button>
          <div className="mt-4 rounded border p-3 text-xs text-muted-foreground space-y-1">
            <p><strong>Required:</strong> customer_email, product_sku, price</p>
            <p><strong>Note:</strong> price must be a valid number (e.g. 89.90). Existing entries are overwritten.</p>
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
                <TableHead>Customer / SKU</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.key}</TableCell>
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

export default ImportCustomerPrices;
