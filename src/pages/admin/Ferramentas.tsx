import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Download, Upload, Package, Users, DollarSign, FolderTree } from "lucide-react";

const AdminFerramentas = () => {
  const [exporting, setExporting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const downloadCsv = (data: any[], filename: string) => {
    if (data.length === 0) { toast.error("No data to export"); return; }
    const headers = Object.keys(data[0]);
    const csv = [headers.join(","), ...data.map((row) => headers.map((h) => {
      const val = row[h] ?? "";
      return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
    }).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (table: string, filename: string) => {
    setExporting(table);
    const { data, error } = await supabase.from(table as any).select("*");
    if (error) { toast.error(error.message); setExporting(null); return; }
    downloadCsv(data ?? [], filename);
    toast.success(`${filename} exported`);
    setExporting(null);
  };

  const handleImportCsv = async (table: string, file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("CSV file is empty or has no data rows"); setImporting(false); return; }
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const obj: Record<string, any> = {};
        headers.forEach((h, i) => { obj[h] = values[i] === "" ? null : values[i]; });
        // Remove id and timestamps to let DB generate them
        delete obj.id; delete obj.created_at; delete obj.updated_at;
        return obj;
      });
      const { error } = await supabase.from(table as any).insert(rows as any);
      if (error) { toast.error("Import error: " + error.message); setImporting(false); return; }
      toast.success(`${rows.length} records imported to ${table}`);
    } catch (err: any) {
      toast.error("Failed to parse CSV: " + err.message);
    }
    setImporting(false);
  };

  const tools = [
    { table: "produtos", label: "Products", icon: Package, filename: "products.csv" },
    { table: "categorias", label: "Categories", icon: FolderTree, filename: "categories.csv" },
    { table: "clientes", label: "Clients", icon: Users, filename: "clients.csv" },
    { table: "tabelas_preco", label: "Price Lists", icon: DollarSign, filename: "price-lists.csv" },
  ];

  return (
    <AdminLayout>
      <h2 className="mb-6 font-display text-2xl font-semibold">Tools</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((t) => (
          <Card key={t.table}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2"><t.icon className="h-5 w-5 text-accent" /></div>
              <CardTitle className="text-base">{t.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-1"
                disabled={exporting === t.table}
                onClick={() => handleExport(t.table, t.filename)}
              >
                <Download className="h-4 w-4" /> {exporting === t.table ? "Exporting..." : "Export CSV"}
              </Button>
              <label className="flex-1">
                <div className="flex h-10 cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted/50">
                  <Upload className="h-4 w-4" /> {importing ? "Importing..." : "Import CSV"}
                </div>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportCsv(t.table, file);
                    e.target.value = "";
                  }}
                />
              </label>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Import Guidelines</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>• Export first to see the expected CSV format for each data type.</p>
          <p>• The <code>id</code>, <code>created_at</code>, and <code>updated_at</code> columns are auto-generated — they will be ignored during import.</p>
          <p>• For products: required fields are <code>nome</code> and <code>sku</code>.</p>
          <p>• For clients: required fields are <code>nome</code>, <code>email</code>, and <code>user_id</code>.</p>
          <p>• Duplicate SKUs or emails will cause import errors.</p>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default AdminFerramentas;
