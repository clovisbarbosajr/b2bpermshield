import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { parseCSV } from "@/lib/csv";
const TEMPLATE_HEADERS = ["order_number", "status", "tracking_number", "delivery_date"];
const TEMPLATE_ROW = ["1001", "complete", "BR123456789", "2024-12-31"];

const VALID_STATUSES = ["submitted", "ready_for_pickup", "partial", "on_hold", "sent", "complete", "cancelled"];

type Result = { row: number; orderNumber: string; status: "ok" | "error"; message: string };

const BulkUpdateOrders = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bulk_update_orders_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    // REGRA NUMERO UM (a mesma escrita no topo de `b2bwave-sync/index.ts`):
    // operacao em MASSA sobre pedidos suprime notificacao ANTES de comecar.
    // Este laco faz um UPDATE de status por linha — sem isto, uma planilha de
    // 500 pedidos vira 500 SMS no momento em que o gatilho de status for
    // religado. Foi assim que o incidente de 25/ago aconteceu, só que pelo sync.
    //
    // A janela cobre o lote inteiro com folga. A supressao e contada por
    // referencia no banco (20260826010000), entao ligar aqui nao atrapalha um
    // sync que esteja rodando, nem o sync desliga a nossa.
    const minutos = Math.max(10, Math.ceil(rows.length / 100) * 5);
    const { error: supErr } = await supabase.rpc("set_suppress_order_notify" as any, {
      _on: true, _minutos: minutos,
    });
    if (supErr) {
      // Falhar aqui ABORTA. Rodar o lote sem supressao e o cenario do incidente:
      // melhor a planilha nao subir do que subir disparando mensagem.
      setImporting(false);
      toast.error("Could not pause notifications — nothing was updated. " + supErr.message);
      return;
    }

    try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const orderNumberRaw = r["order_number"]?.trim();
      const orderNumber = parseInt(orderNumberRaw);

      if (!orderNumberRaw || isNaN(orderNumber)) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw || "—", status: "error", message: "Invalid or missing order_number" });
        continue;
      }

      const status = r["status"]?.trim().toLowerCase();
      if (status && !VALID_STATUSES.includes(status)) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error", message: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}` });
        continue;
      }

      const updatePayload: Record<string, string | number | null> = {};
      if (status) updatePayload["status"] = status;
      if (r["tracking_number"]?.trim()) updatePayload["tracking_number"] = r["tracking_number"].trim();
      if (r["delivery_date"]?.trim()) updatePayload["delivery_date"] = r["delivery_date"].trim();

      if (Object.keys(updatePayload).length === 0) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error", message: "No fields to update" });
        continue;
      }

      // `pedidos.numero` NÃO é único (a migration do sync diz isso explicitamente,
      // e já houve colisão real entre numeração nativa e ids do B2BWave). Antes o
      // update era `.eq("numero", ...)`: uma linha do CSV alterava TODOS os pedidos
      // com aquele número — inclusive o de outro cliente — e reportava "Updated"
      // em verde (só o caso "nenhum encontrado" era tratado).
      // Agora: resolve o número para UM id antes; ambiguidade vira erro, sem tocar
      // em nada.
      const { data: matches, error: findErr } = await supabase
        .from("pedidos").select("id").eq("numero", orderNumber);

      if (findErr) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error", message: findErr.message });
        continue;
      }
      if (!matches || matches.length === 0) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error", message: `Order #${orderNumber} not found` });
        continue;
      }
      if (matches.length > 1) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error",
          message: `Ambiguous: ${matches.length} orders share number #${orderNumber}. Update them individually.` });
        continue;
      }

      const { error } = await supabase
        .from("pedidos")
        .update(updatePayload as any)
        .eq("id", (matches[0] as any).id);

      if (error) {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "error", message: error.message });
      } else {
        res.push({ row: i + 2, orderNumber: orderNumberRaw, status: "ok", message: "Updated" });
      }
    }

    setResults(res);
    } catch (e: any) {
      // Sem isto, uma excecao no laco destravava a tela SEM mensagem nenhuma e
      // sem o toast final: importacao parcial, silenciosa. O laco so usa
      // `await supabase.from(...)`, que nao lanca — mas "estreito" nao e
      // "impossivel", e o custo de saber e uma linha.
      toast.error("Bulk update stopped: " + (e?.message ?? String(e)));
    } finally {
      // `setImporting(false)` PRIMEIRO. Na versao anterior ele vinha depois do
      // `await`, e um `.then()` sem tratamento de rejeicao (rede caindo, sessao
      // expirando num lote longo) lancava dentro do `finally`: a tela ficava
      // presa em "Updating..." ate recarregar, e a excecao ainda mascarava o
      // erro original do `try`.
      setImporting(false);
      try {
        const { error } = await supabase.rpc("set_suppress_order_notify" as any, { _on: false, _minutos: 0 });
        if (error) console.error("[bulk] release suppression failed:", error.message);
      } catch (e) {
        // Nao aborta: a janela de supressao expira sozinha.
        console.error("[bulk] release suppression threw:", e);
      }
    }
    toast.success(`Updated ${res.filter((r) => r.status === "ok").length} of ${rows.length} orders`);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Bulk Update Orders</h2>
        <p className="mt-1 text-sm text-muted-foreground">Update multiple orders at once via CSV upload.</p>
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
                <Upload className="h-4 w-4" />{importing ? "Updating..." : "Choose File"}
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
            <p><strong>Required:</strong> order_number</p>
            <p><strong>Optional:</strong> status, tracking_number, delivery_date</p>
            <p><strong>Valid statuses:</strong> {VALID_STATUSES.join(", ")}</p>
            <p><strong>delivery_date format:</strong> YYYY-MM-DD</p>
          </div>
        </Card>
      </div>
      {results.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Update Results</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-green-400">{results.filter((r) => r.status === "ok").length} ok</span>
              <span className="text-destructive">{results.filter((r) => r.status === "error").length} errors</span>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.orderNumber}</TableCell>
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

export default BulkUpdateOrders;
