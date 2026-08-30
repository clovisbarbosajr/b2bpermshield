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
import { mapaSkuSemAmbiguidade } from "@/lib/mapaSku";

/** Numero da linha NO ARQUIVO, para o admin abrir a linha certa.
 *
 * `i + 2` supunha que o indice do array batia com o arquivo — e nao bate: linha
 * em branco e descartada pelo parser, e campo entre aspas pode ocupar varias
 * linhas. Num CSV vindo do Excel, que gosta das duas coisas, o numero reportado
 * mandava o admin para o lugar errado. `parseCSV` carimba `__linha` com o numero
 * real; o `i + 2` fica so como reserva para chamada que nao venha de la. */
const linhaDoArquivo = (r: any, i: number): number => r?.__linha ?? i + 2;
const TEMPLATE_HEADERS = ["customer_email", "product_sku", "price"];
const TEMPLATE_ROW = ["john@acme.com", "PROD-001", "89.90"];

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
    // LIMPA O RESULTADO ANTERIOR ANTES DE LER O ARQUIVO NOVO.
    //
    // `setFileName` roda aqui em cima, e a tabela de resultados fica logo abaixo
    // da moldura. Sem isto, um arquivo que falha no parse deixava a tela com o
    // NOME do arquivo novo e as LINHAS do anterior — o toast some em segundos e
    // sobra a leitura errada. E a mesma "tela mentindo que carregou" que este
    // bloco veio matar, em escala menor.
    setResults([]);
    // O PARSE PODE LANCAR, e este handler e chamado SOLTO do `onChange`/`onDrop`
    // (`if (f) handleFile(f)`), sem `.catch()`. Sem este `try`, um CSV com coluna
    // repetida — que `parseCSV` passou a recusar — virava rejeicao nao tratada: o
    // nome do arquivo aparecia na tela e NADA acontecia. Sem toast, sem erro, sem
    // spinner. Pior que o defeito que a recusa veio consertar.
    let rows: Record<string, string>[];
    try {
      const text = await file.text();
      rows = parseCSV(text);
    } catch (e: any) {
      toast.error("Could not read this file: " + (e?.message ?? String(e)));
      return;
    }
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];

    const emailMap: Record<string, string> = {};
    const emailAmbiguo = new Set<string>();
    const skuMap: Record<string, string> = {};
    const skuAmbiguo = new Set<string>();
    try {
      // Fetch clientes email→id map
      // PAGINADO: sem isto, do milesimo cliente em diante o e-mail nao era
      // encontrado e a linha do CSV era descartada com "Customer not found" —
      // mensagem mentirosa, porque o cliente existe.
      const clientes = await fetchAllRows<{ id: string; email: string | null }>((from, to) =>
        supabase.from("clientes").select("id, email")
          .order("id", { ascending: true }).range(from, to));
      // Casa em MINUSCULAS. O resto do sistema ja trata e-mail como identidade
      // sem caixa (`claim_customer_record()` casa com `lower(email) = _email`,
      // 20260619000000) e `ImportCustomers` deduplica assim. Comparando exato,
      // base com `John@Acme.com` e CSV com `john@acme.com` davam "Customer not
      // found" e o preco negociado simplesmente nao entrava.
      for (const c of clientes) {
        if (!c.email) continue;
        const k = c.email.trim().toLowerCase();
        // Duas linhas de `clientes` com o mesmo e-mail (nao ha UNIQUE em
        // `clientes.email`): qual delas receberia o preco seria sorteio. Marca e
        // recusa a linha em vez de cobrar do cadastro errado.
        if (emailMap[k] && emailMap[k] !== c.id) emailAmbiguo.add(k);
        else emailMap[k] = c.id;
      }

      // Fetch produtos sku→id map
      const produtos = await fetchAllRows<{ id: string; sku: string | null }>((from, to) =>
        supabase.from("produtos").select("id, sku")
          .order("id", { ascending: true }).range(from, to));
      // SKU REPETE de proposito: a UNIQUE de `produtos.sku` foi DROPADA em
      // 20260708140000 ("pra manter 1:1 com o original, a UNIQUE cai"). Com dois
      // produtos de mesmo SKU, o mapa guardava o ultimo da paginacao e o preco
      // negociado ia para um produto sorteado pela ordem de leitura — com "ok"
      // verde na tela. Recusa e mostra qual SKU esta duplicado.
      // Extraido para `mapaSku.ts` quando o mesmo caso apareceu em
      // `ImportProductVariants`, que resolve produto por SKU e NAO tinha a guarda.
      const m = mapaSkuSemAmbiguidade(produtos);
      Object.assign(skuMap, m.mapa);
      m.ambiguos.forEach((k) => skuAmbiguo.add(k));
    } catch (e: any) {
      // `fetchAllRows` LANCA quando a leitura falha, e ninguem pegava: a promessa
      // rejeitava fora do fluxo, `setImporting(false)` nunca rodava e a tela
      // ficava em "Importing..." para sempre, sem uma palavra de erro.
      toast.error("Could not read customers/products — import cancelled: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const emailBruto = r["customer_email"]?.trim();
      const sku = r["product_sku"]?.trim();
      const key = `${emailBruto} / ${sku}`;

      if (!emailBruto || !sku) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: "Missing customer_email or product_sku" });
        continue;
      }
      const email = emailBruto.toLowerCase();

      if (emailAmbiguo.has(email)) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `More than one customer record uses ${emailBruto} — merge them before importing prices` });
        continue;
      }

      const clienteId = emailMap[email];
      if (!clienteId) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `Customer not found: ${emailBruto}` });
        continue;
      }

      if (skuAmbiguo.has(sku)) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `More than one product uses SKU ${sku} — give them distinct codes before importing prices` });
        continue;
      }

      const produtoId = skuMap[sku];
      if (!produtoId) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `Product not found: ${sku}` });
        continue;
      }

      // `parseFloat` para no primeiro caractere invalido e devolve um numero
      // PLAUSIVEL: "1,234.56" vira 1 e "89,90" (virgula decimal, o jeito que a
      // planilha sai em pt-BR) vira 89. Nao e NaN, nao acusa nada — o cliente
      // passa a ser cobrado o preco errado com "Upserted" verde na tela. Aqui so
      // passa decimal puro e nao negativo.
      const precoBruto = (r["price"] ?? "").trim();
      if (!/^\d+(\.\d+)?$/.test(precoBruto)) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `Invalid price: ${r["price"]} (use a plain number like 89.90)` });
        continue;
      }
      const preco = parseFloat(precoBruto);

      // ANTES: `.upsert({...}, { onConflict: "cliente_id,produto_id" })`. NAO
      // existe UNIQUE (cliente_id, produto_id) em `produto_precos_cliente` — a
      // tabela tem so a PK em `id` (20260318202244:71-78) e nenhuma migration
      // acrescentou indice depois. Sem o indice o Postgres recusa TODA linha com
      // 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
      // specification"): esta importacao nunca gravou um preco desde que foi
      // escrita. Entao aqui e procurar e UPDATE ou INSERT explicito.
      const { data: existentes, error: buscaErr } = await supabase
        .from("produto_precos_cliente").select("id")
        .eq("cliente_id", clienteId).eq("produto_id", produtoId);
      if (buscaErr) {
        // Falha FECHADO: seguir para o insert criaria uma segunda linha de preco
        // para o mesmo par, e ai o servidor cobra a que ele achar primeiro.
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: buscaErr.message });
        continue;
      }
      if (!existentes) {
        // Sem erro E sem linhas nao e um estado que este select produz. Nao
        // inventa: nao afirma duplicata, so recusa em vez de arriscar o insert.
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: "Could not read the current custom price, nothing written" });
        continue;
      }
      if (existentes.length > 1) {
        // Sem o UNIQUE a tabela PODE ja ter duplicata. Atualizar uma so deixaria
        // a outra valendo, e `preco_para_cliente` faz `SELECT ... LIMIT 1` sem
        // ordem definida — qual preco vale seria sorteio.
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: "Duplicate custom-price rows for this customer/product — remove the extras before importing" });
        continue;
      }
      const jaTinha = existentes.length === 1;
      const { error } = jaTinha
        ? await supabase.from("produto_precos_cliente").update({ preco }).eq("id", existentes[0].id)
        : await supabase.from("produto_precos_cliente").insert({ cliente_id: clienteId, produto_id: produtoId, preco });

      if (error) {
        res.push({ row: linhaDoArquivo(r, i), key, status: "error", message: error.message });
      } else {
        res.push({ row: linhaDoArquivo(r, i), key, status: "ok", message: jaTinha ? "Updated" : "Created" });
      }
    }

    setResults(res);
    setImporting(false);
    const okPr = res.filter((r) => r.status === "ok").length;
    const errPr = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okPr} of ${rows.length} prices`);
    supabase.from("import_logs").insert({ tipo: "customer_prices", arquivo_nome: file.name, registros_total: rows.length, registros_erro: errPr, registros_sucesso: rows.length - errPr, status: errPr === 0 ? "success" : "partial" } as any).then(() => {});
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
            // TRAVA A AREA INTEIRA, nao so o botao de dentro: com `importing` a
            // moldura seguia clicavel e aceitando drop, e dois lotes concorrentes
            // liam "nao existe" para a mesma chave e inseriam os dois. Mesma trava
            // que `ImportProductVariants` e `BulkUpdateOrders` ja tinham.
            onClick={() => { if (!importing) inputRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (importing) return; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
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
