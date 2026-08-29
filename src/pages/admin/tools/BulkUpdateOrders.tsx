import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { parseCSV } from "@/lib/csv";

/** Numero da linha NO ARQUIVO, para o admin abrir a linha certa.
 *
 * `i + 2` supunha que o indice do array batia com o arquivo — e nao bate: linha
 * em branco e descartada pelo parser, e campo entre aspas pode ocupar varias
 * linhas. Num CSV vindo do Excel, que gosta das duas coisas, o numero reportado
 * mandava o admin para o lugar errado. `parseCSV` carimba `__linha` com o numero
 * real; o `i + 2` fica so como reserva para chamada que nao venha de la. */
const linhaDoArquivo = (r: any, i: number): number => r?.__linha ?? i + 2;
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
    // LIMPA O RESULTADO ANTERIOR ANTES DE LER O ARQUIVO NOVO.
    //
    // `setFileName` roda aqui em cima, e a tabela de resultados fica logo abaixo
    // da moldura. Sem isto, um arquivo que falha no parse deixava a tela com o
    // NOME do arquivo novo e as LINHAS do anterior — o toast some em segundos e
    // sobra a leitura errada. E a mesma "tela mentindo que carregou" que este
    // bloco veio matar, em escala menor.
    setResults([]);
    let rows: Record<string, string>[];
    try {
      // `file.text()` REJEITA quando o arquivo sumiu, foi renomeado ou o disco
      // falhou entre o clique e a leitura — comum com drag & drop. Sem este
      // `catch` virava rejeicao nao tratada: o admin soltava o CSV e NADA
      // acontecia, sem toast e sem explicacao. Mesmo conserto ja feito no
      // `ImportOrders.tsx`.
      rows = parseCSV(await file.text());
    } catch (e: any) {
      toast.error("Could not read this file: " + (e?.message ?? String(e)));
      return;
    }
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
    // Piso de 30 minutos, nao 10 — o mesmo que o `ImportOrders.tsx` ja usa, pela
    // mesma razao, e este arquivo tinha ficado para tras.
    //
    // `desde` e COMPARTILHADO e fica ancorado no PRIMEIRO incremento da
    // sequencia (20260826010000: `desde` so e renovado quando `_novo = 1`). Se um
    // lote orfao — tick de `cron_orders` que morreu sem decrementar — abriu a
    // sequencia ha 110 minutos, esta chamada HERDA aquele `desde`: o ramo
    // `n > 0` do gatilho vence em 10 minutos (`desde + 120`), e o unico silencio
    // que resta e a janela `ate`, que com 10 tambem morre em 10. Uma planilha de
    // 500 pedidos faz duas requisicoes por linha e passa disso com folga — e o
    // que sai do outro lado e o incidente de 25/ago: SMS por pedido, no meio do
    // lote. Com 30, `ate` sozinho cobre. O SQL ja limita em 120, entao pedir
    // mais nao custa nada.
    const minutos = Math.max(30, Math.ceil(rows.length / 100) * 5);
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
      // `parseInt` LE O PREFIXO e descarta o resto: "1001abc" vira 1001, "10.5"
      // vira 10, "1 001" vira 1. O numero errado nao dava erro nenhum — resolvia
      // para UM pedido existente, mudava o status DELE e reportava "Updated" em
      // verde. E mudanca de status baixa estoque e (quando o gatilho voltar)
      // avisa o cliente: um digito perdido na planilha manda "seu pedido foi
      // enviado" para quem nao pediu nada.
      //
      // `Number` recusa a string inteira; `Number.isInteger` corta o decimal que
      // `Number` aceitaria ("10.5"), e `orderNumberRaw` vazio ja e barrado
      // antes porque `Number("")` e 0 e passaria em `isInteger`.
      const orderNumber = Number(orderNumberRaw);

      if (!orderNumberRaw || !Number.isInteger(orderNumber)) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw || "—", status: "error", message: `Invalid or missing order_number "${orderNumberRaw ?? ""}"` });
        continue;
      }

      const status = r["status"]?.trim().toLowerCase();
      if (status && !VALID_STATUSES.includes(status)) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error", message: `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}` });
        continue;
      }

      const updatePayload: Record<string, string | number | null> = {};
      if (status) updatePayload["status"] = status;
      if (r["tracking_number"]?.trim()) updatePayload["tracking_number"] = r["tracking_number"].trim();
      if (r["delivery_date"]?.trim()) updatePayload["delivery_date"] = r["delivery_date"].trim();

      if (Object.keys(updatePayload).length === 0) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error", message: "No fields to update" });
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
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error", message: findErr.message });
        continue;
      }
      if (!matches || matches.length === 0) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error", message: `Order #${orderNumber} not found` });
        continue;
      }
      if (matches.length > 1) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error",
          message: `Ambiguous: ${matches.length} orders share number #${orderNumber}. Update them individually.` });
        continue;
      }

      const { error } = await supabase
        .from("pedidos")
        .update(updatePayload as any)
        .eq("id", (matches[0] as any).id);

      if (error) {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "error", message: error.message });
      } else {
        res.push({ row: linhaDoArquivo(r, i), orderNumber: orderNumberRaw, status: "ok", message: "Updated" });
      }
    }

    // O toast de sucesso fica DENTRO do try: fora dele, ele saia mesmo depois
    // de uma excecao — o admin via um toast vermelho e um verde ao mesmo tempo,
    // com a tabela em branco, e a importacao parcial era anunciada como sucesso.
    toast.success(`Updated ${res.filter((r) => r.status === "ok").length} of ${rows.length} orders`);
    } catch (e: any) {
      // Sem isto, uma excecao no laco destravava a tela SEM mensagem nenhuma e
      // sem o toast final: importacao parcial, silenciosa. O laco so usa
      // `await supabase.from(...)`, que nao lanca — mas "estreito" nao e
      // "impossivel", e o custo de saber e uma linha.
      toast.error("Bulk update stopped: " + (e?.message ?? String(e)));
    } finally {
      // `setResults` no `finally`, nao no `try`: numa excecao ele nunca rodava e
      // a tabela ficava VAZIA — o admin perdia justamente o registro de quais
      // linhas tinham passado antes da falha.
      setResults(res);
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
        // Nao aborta. Mas nao e "expira sozinha": com o contador orfao, o
        // gatilho segue mudo ate `desde + 120 minutos`.
        console.error("[bulk] release suppression threw:", e);
      }
    }
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
          {/* `importing` trava a AREA inteira, nao so o botao — o mesmo conserto
              que o `ImportOrders.tsx` ja tinha. So o `<Button>` interno estava
              desabilitado: clicar na moldura ou soltar um segundo arquivo
              disparava um `handleFile` concorrente. Dois lotes ao mesmo tempo
              partilham UM `res`? nao — cada um tem o seu, e o `setResults` do
              que terminar primeiro e apagado pelo outro: o admin fica com o
              relatorio de UM lote e os UPDATEs dos DOIS aplicados. */}
          <div
            className={`mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 ${importing ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-primary/50"}`}
            onClick={() => { if (!importing) inputRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (importing) return; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
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
