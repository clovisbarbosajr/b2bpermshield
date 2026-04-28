import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_HEADERS = ["company", "name", "email", "phone", "address", "city", "state", "country", "zip", "website"];
const TEMPLATE_ROW = ["Acme Corp", "John Doe", "john@acme.com", "555-1234", "123 Main St", "New York", "NY", "United States", "10001", "acme.com"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return row;
  });
}

type Result = { row: number; email: string; status: "ok" | "error"; message: string };

const ImportCustomers = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_customers_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r["email"]?.trim();
      if (!email) {
        res.push({ row: i + 2, email: "—", status: "error", message: "Missing email" });
        continue;
      }

      const payload: any = {
        email,
        nome: r["name"] || r["nome"] || "",
        empresa: r["company"] || r["empresa"] || "",
        telefone: r["phone"] || r["telefone"] || null,
        endereco: r["address"] || r["endereco"] || null,
        cidade: r["city"] || r["cidade"] || null,
        estado: r["state"] || r["estado"] || null,
        pais: r["country"] || r["pais"] || "United States",
        cep: r["zip"] || r["cep"] || null,
        website: r["website"] || null,
        status: "pendente",
        is_active: false,
      };

      const { error } = await supabase.from("clientes").upsert(payload, { onConflict: "email" });
      if (error) {
        res.push({ row: i + 2, email, status: "error", message: error.message });
      } else {
        res.push({ row: i + 2, email, status: "ok", message: "Imported" });
      }
    }

    setResults(res);
    setImporting(false);
    const ok = res.filter((r) => r.status === "ok").length;
    const errCount = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${ok} of ${rows.length} customers`);
    supabase.from("import_logs").insert({ tipo: "customers", arquivo: file.name, registros: rows.length, erros: errCount, status: errCount === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Customers</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import customer accounts via CSV.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Upload CSV</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Columns: <code className="text-xs bg-muted px-1 rounded">{TEMPLATE_HEADERS.join(", ")}</code>
          </p>
          <div
            className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <div className="text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{fileName || "Drag & drop or click to browse"}</p>
              <Button variant="outline" className="mt-4 gap-2" disabled={importing}>
                <Upload className="h-4 w-4" /> {importing ? "Importing..." : "Choose File"}
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
            <p><strong>Required:</strong> email</p>
            <p><strong>Optional:</strong> company, name, phone, address, city, state, country, zip, website</p>
            <p className="text-amber-400">Customers are imported as <em>pending</em>. Approve them in User Management.</p>
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
              <TableRow><TableHead>Row</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Message</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.email}</TableCell>
                  <TableCell>
                    {r.status === "ok"
                      ? <CheckCircle className="h-4 w-4 text-green-400" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                  </TableCell>
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

export default ImportCustomers;
