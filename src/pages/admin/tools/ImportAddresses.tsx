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
const TEMPLATE_HEADERS = ["customer_email", "address", "address2", "city", "state", "country", "zip", "is_primary"];
const TEMPLATE_ROW = ["john@acme.com", "123 Main St", "Suite 100", "New York", "NY", "United States", "10001", "yes"];

type Result = { row: number; email: string; status: "ok" | "error"; message: string };

const ImportAddresses = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_addresses_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    // Le a base INTEIRA de e-mails, igual ao `ImportCustomers`. O `.in(emails)`
    // que estava aqui tinha dois furos, e os dois davam a MESMA mensagem falsa
    // ("Customer not found") para cliente que existe:
    //   * sem `.range()`, o PostgREST corta em 1000 e do 1001 em diante a chave
    //     nao entra no mapa;
    //   * o `error` nao era destruturado, entao uma planilha grande estourando o
    //     tamanho da URL (414) devolvia zero e a importacao INTEIRA falhava
    //     dizendo que nenhum dos clientes existe.
    // Baixar so a coluna `email` de todos custa dezenas de KB e nao depende nem do
    // tamanho da URL nem do limite de linhas.
    const emailMap: Record<string, string> = {};
    try {
      const todos = await fetchAllRows<{ id: string; email: string | null }>((from, to) =>
        supabase.from("clientes").select("id, email")
          .order("id", { ascending: true }).range(from, to));
      for (const c of todos) {
        if (c.email) emailMap[String(c.email).trim().toLowerCase()] = c.id;
      }
    } catch (e: any) {
      // FALHA ALTO. Seguir com o mapa vazio marcaria a planilha inteira como
      // "Customer not found" — erro que parece dado ruim e nao e.
      toast.error("Could not read customers — import cancelled: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r["customer_email"]?.trim();
      // `toLowerCase` dos dois lados: o mapa e montado em minusculas. Sem isto,
      // "Joao@Acme.com" na planilha nao acha "joao@acme.com" no banco.
      const clienteId = email ? emailMap[email.toLowerCase()] : undefined;

      if (!clienteId) {
        res.push({ row: i + 2, email: email || "â€”", status: "error", message: "Customer not found" });
        continue;
      }

      const { error } = await (supabase.from("enderecos") as any).insert({
        cliente_id: clienteId,
        logradouro: r["address"] || "",
        complemento: r["address2"] || null,
        cidade: r["city"] || "",
        estado: r["state"] || "",
        // `pais` FOI REMOVIDO — a coluna nunca existiu em `enderecos`.
        //
        // Como o campo era sempre preenchido (`|| "United States"`), TODA linha
        // voltava `PGRST204` e esta ferramenta nunca importou um endereco sequer.
        // O `as any` no `.from("enderecos")` e o que impedia o `tsc` de acusar.
        //
        // O `country` da planilha fica sem destino: `enderecos` nao tem coluna de
        // pais e `clientes.pais` e um valor SO por cliente — escrever ali a partir
        // de um import de endereco faria a ultima linha da planilha ganhar de
        // todas as outras. Se o dono quiser guardar isso, e decisao de produto.
        cep: r["zip"] || "",
        principal: (r["is_primary"] || "").toLowerCase() === "yes",
      });

      if (error) {
        res.push({ row: i + 2, email, status: "error", message: error.message });
      } else {
        res.push({ row: i + 2, email, status: "ok", message: "Imported" });
      }
    }

    setResults(res);
    setImporting(false);
    const okAddr = res.filter((r) => r.status === "ok").length;
    const errAddr = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okAddr} of ${rows.length} addresses`);
    supabase.from("import_logs").insert({ tipo: "addresses", arquivo_nome: file.name, registros_total: rows.length, registros_erro: errAddr, registros_sucesso: rows.length - errAddr, status: errAddr === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Addresses</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import customer addresses via CSV.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Upload CSV</h3>
          <p className="mt-2 text-sm text-muted-foreground">Columns: <code className="text-xs bg-muted px-1 rounded">{TEMPLATE_HEADERS.join(", ")}</code></p>
          <div className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            <div className="text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{fileName || "Drag & drop or click to browse"}</p>
              <Button variant="outline" className="mt-4 gap-2" disabled={importing}><Upload className="h-4 w-4" />{importing ? "Importing..." : "Choose File"}</Button>
            </div>
          </div>
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </Card>
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Template</h3>
          <p className="mt-2 text-sm text-muted-foreground">Download the CSV template.</p>
          <Button variant="outline" className="mt-4 w-full gap-2" onClick={downloadTemplate}><Download className="h-4 w-4" /> Download Template</Button>
          <div className="mt-4 rounded border p-3 text-xs text-muted-foreground space-y-1">
            <p><strong>Required:</strong> customer_email, address, city, state, zip</p>
            <p><strong>Optional:</strong> address2, is_primary (yes/no)</p>
            {/* `country` continua no template para o export do B2BWave colar sem
                edicao, mas nao e gravado: `enderecos` nao tem coluna de pais. */}
            <p><strong>Ignored:</strong> country (no country column on addresses)</p>
          </div>
        </Card>
      </div>
      {results.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Import Results</h3>
            <div className="flex gap-3 text-xs"><span className="text-green-400">{results.filter((r) => r.status === "ok").length} ok</span><span className="text-destructive">{results.filter((r) => r.status === "error").length} errors</span></div>
          </div>
          <Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
            <TableBody>{results.map((r) => (<TableRow key={r.row}><TableCell className="text-muted-foreground text-xs">{r.row}</TableCell><TableCell className="text-sm">{r.email}</TableCell><TableCell>{r.status === "ok" ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell><TableCell className="text-xs text-muted-foreground">{r.message}</TableCell></TableRow>))}</TableBody></Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default ImportAddresses;
