import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { parseCSV } from "@/lib/csv";
import { exportToCSV } from "@/lib/export-csv";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Download, Upload, Package, Users, DollarSign, FolderTree } from "lucide-react";

const AdminFerramentas = () => {
  const [exporting, setExporting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = async (table: string, filename: string) => {
    setExporting(table);
    try {
      // PAGINADO. Um `.select("*")` sem `.range()` volta com no MÁXIMO 1000
      // linhas e `error: null` — o CSV saía truncado com "exported" na tela.
      // `produtos` e `clientes` crescem sem teto (catálogo e base de clientes),
      // e o pior é o uso normal desta tela: exportar, editar no Excel,
      // reimportar. Com o corte, a volta reinsere só o pedaço lido.
      // `.order("id")`: `fetchAllRows` pagina com LIMIT/OFFSET, que sem ORDER BY
      // por coluna única pode repetir ou pular linha entre uma página e outra.
      const rows = await fetchAllRows<Record<string, any>>((from, to) =>
        supabase.from(table as any).select("*").order("id", { ascending: true }).range(from, to) as any);
      if (rows.length === 0) { toast.error("No data to export"); return; }
      exportToCSV(rows, filename);
      toast.success(`${rows.length} rows exported`);
    } catch (err: any) {
      // `fetchAllRows` LANÇA em erro. Sem este catch a tela ficava travada em
      // "Exporting..." sem dizer o que houve.
      toast.error("Export failed: " + (err?.message ?? String(err)));
    } finally {
      setExporting(null);
    }
  };

  const handleImportCsv = async (table: string, file: File) => {
    setImporting(true);
    try {
      // `parseCSV` compartilhado, no lugar do `split(",")` que estava aqui.
      // O antigo quebrava a linha na vírgula sem entender aspas, e é o próprio
      // Export desta tela que produz campos com vírgula dentro de aspas
      // (`"Rua A, 100"`, `"Acme, Inc"`). O resultado não era erro na tela: era
      // TODA coluna seguinte deslocada uma casa — preço lendo SKU — gravado
      // como se estivesse certo. Campo vazio (`a,,b`) tinha o mesmo efeito.
      const rows = parseCSV(await file.text()).map((r) => {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) obj[k] = v === "" ? null : v;
        // Remove id and timestamps to let DB generate them
        delete obj.id; delete obj.created_at; delete obj.updated_at;
        return obj;
      });
      if (rows.length === 0) { toast.error("CSV file is empty or has no data rows"); setImporting(false); return; }
      const { error } = await supabase.from(table as any).insert(rows as any);
      if (error) { toast.error("Import error: " + error.message); setImporting(false); return; }
      toast.success(`${rows.length} records imported to ${table}`);
    } catch (err: any) {
      toast.error("Failed to parse CSV: " + err.message);
    }
    setImporting(false);
  };

  // Sem `.csv` no nome: `exportToCSV` acrescenta data e extensão.
  const tools = [
    { table: "produtos", label: "Products", icon: Package, filename: "products" },
    { table: "categorias", label: "Categories", icon: FolderTree, filename: "categories" },
    { table: "clientes", label: "Clients", icon: Users, filename: "clients" },
    { table: "tabelas_preco", label: "Price Lists", icon: DollarSign, filename: "price-lists" },
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
