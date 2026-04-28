import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_HEADERS = ["customer_email", "product_sku", "quantity", "price", "status", "po_number", "delivery_date"];
const TEMPLATE_ROW = ["john@acme.com", "PROD-001", "10", "45.90", "recebido", "PO-2024-001", "2024-12-31"];

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

type OrderGroup = {
  customerEmail: string;
  poNumber: string;
  status: string;
  deliveryDate: string;
  rows: Array<{ sku: string; quantity: number; price: number; rowNum: number }>;
};

const ImportOrders = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_orders_template.csv";
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

    // Fetch produtos sku→{id, nome, preco} map
    const { data: produtos } = await supabase.from("produtos").select("id, sku, nome, preco");
    const skuMap: Record<string, { id: string; nome: string; preco: number | null }> = {};
    (produtos ?? []).forEach((p: any) => { if (p.sku) skuMap[p.sku] = { id: p.id, nome: p.nome, preco: p.preco }; });

    // Group rows by customer_email + po_number
    const groups: Record<string, OrderGroup> = {};
    const groupRowErrors: Result[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r["customer_email"]?.trim();
      const sku = r["product_sku"]?.trim();
      const poNumber = r["po_number"]?.trim() || "";
      const key = `${email} / PO: ${poNumber || "(none)"}`;

      if (!email) {
        groupRowErrors.push({ row: i + 2, key, status: "error", message: "Missing customer_email" });
        continue;
      }
      if (!sku) {
        groupRowErrors.push({ row: i + 2, key, status: "error", message: "Missing product_sku" });
        continue;
      }

      const quantity = parseInt(r["quantity"]) || 1;
      const price = parseFloat(r["price"]);
      if (isNaN(price)) {
        groupRowErrors.push({ row: i + 2, key, status: "error", message: `Invalid price: ${r["price"]}` });
        continue;
      }

      const groupKey = `${email}|||${poNumber}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          customerEmail: email,
          poNumber,
          status: r["status"]?.trim() || "recebido",
          deliveryDate: r["delivery_date"]?.trim() || "",
          rows: [],
        };
      }
      groups[groupKey].rows.push({ sku, quantity, price, rowNum: i + 2 });
    }

    // Push row-level errors first
    res.push(...groupRowErrors);

    // Process each group (one pedido per group)
    for (const groupKey of Object.keys(groups)) {
      const group = groups[groupKey];
      const key = `${group.customerEmail} / PO: ${group.poNumber || "(none)"}`;

      const clienteId = emailMap[group.customerEmail];
      if (!clienteId) {
        res.push({ row: group.rows[0].rowNum, key, status: "error", message: `Customer not found: ${group.customerEmail}` });
        continue;
      }

      // Resolve items and compute totals
      let hasError = false;
      const items: Array<{ produto_id: string; nome: string; sku: string; quantidade: number; preco_unitario: number; subtotal: number }> = [];

      for (const item of group.rows) {
        const produto = skuMap[item.sku];
        if (!produto) {
          res.push({ row: item.rowNum, key, status: "error", message: `Product not found: ${item.sku}` });
          hasError = true;
          break;
        }
        const subtotal = item.quantity * item.price;
        items.push({ produto_id: produto.id, nome: produto.nome, sku: item.sku, quantidade: item.quantity, preco_unitario: item.price, subtotal });
      }

      if (hasError) continue;

      const subtotal = items.reduce((sum, it) => sum + it.subtotal, 0);
      const total = subtotal;
      const quantidadeTotal = items.reduce((sum, it) => sum + it.quantidade, 0);

      // Insert pedido
      const pedidoPayload: Record<string, unknown> = {
        cliente_id: clienteId,
        status: group.status,
        subtotal,
        total,
        quantidade_total: quantidadeTotal,
      };
      if (group.poNumber) pedidoPayload["po_number"] = group.poNumber;
      if (group.deliveryDate) pedidoPayload["delivery_date"] = group.deliveryDate;

      const { data: pedido, error: pedidoError } = await supabase
        .from("pedidos")
        .insert(pedidoPayload as any)
        .select("id")
        .single();

      if (pedidoError || !pedido) {
        res.push({ row: group.rows[0].rowNum, key, status: "error", message: pedidoError?.message ?? "Failed to create order" });
        continue;
      }

      // Insert pedido_itens
      const itensPayload = items.map((it) => ({
        pedido_id: pedido.id,
        produto_id: it.produto_id,
        nome_produto: it.nome,
        sku: it.sku || "",
        quantidade: it.quantidade,
        preco_unitario: it.preco_unitario,
        subtotal: it.subtotal,
      }));

      const { error: itensError } = await supabase.from("pedido_itens").insert(itensPayload as any);

      if (itensError) {
        res.push({ row: group.rows[0].rowNum, key, status: "error", message: `Order created but items failed: ${itensError.message}` });
      } else {
        res.push({ row: group.rows[0].rowNum, key, status: "ok", message: `Order created (${items.length} item${items.length !== 1 ? "s" : ""}, total R$ ${total.toFixed(2)})` });
      }
    }

    setResults(res);
    setImporting(false);
    const okOrd = res.filter((r) => r.status === "ok").length;
    const errOrd = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okOrd} orders`);
    supabase.from("import_logs").insert({ tipo: "orders", arquivo: file.name, registros: rows.length, erros: errOrd, status: errOrd === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Orders</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import historical orders via CSV. Rows with the same customer + PO number are grouped into one order.</p>
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
            <p><strong>Required:</strong> customer_email, product_sku, quantity, price</p>
            <p><strong>Optional:</strong> status (default: recebido), po_number, delivery_date</p>
            <p><strong>Grouping:</strong> Rows with the same customer_email + po_number become one order with multiple items.</p>
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
                <TableHead>Customer / PO</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => (
                <TableRow key={`${r.row}-${idx}`}>
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

export default ImportOrders;
