import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, CheckCircle, XCircle, Link2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { fetchAllRows } from "@/lib/fetchAllRows";
import { parseCSV } from "@/lib/csv";
// IMPORTA RELATED PRODUCTS do export de produtos do B2BWave.
// A API do B2BWave NÃO expõe related products (confirmado na documentação oficial),
// mas o export (Products > Export no admin deles) inclui as colunas:
//   - product_sku            (código do produto)
//   - b2b_product_id         (id do produto no B2BWave — preferido p/ casar)
//   - related_products       (códigos relacionados separados por vírgula: "SKU1,SKU2")
// Esta tela lê esse arquivo e popula produtos_relacionados.

// Parser CSV RFC-4180 (aspas, vírgula dentro de campo, quebra de linha em campo).
// O parser "split por vírgula" dos outros importers quebraria com o export real.

// Lê .xlsx/.xls (export do B2BWave) e devolve no MESMO formato do parseCSV:
// linhas como objetos com chaves de cabeçalho em minúsculas.
function parseXlsx(buf: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => String(h ?? "").trim().toLowerCase());
  return grid.slice(1)
    .filter((vals) => vals.some((c) => String(c ?? "").trim() !== ""))
    .map((vals) => {
      const r: Record<string, string> = {};
      headers.forEach((h, i) => { r[h] = String(vals[i] ?? "").trim(); });
      return r;
    });
}

type Result = { row: number; product: string; status: "ok" | "skip" | "error"; message: string };

const ImportRelatedProducts = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState("");

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setResults([]);
    setSummary("");
    // Detecta o formato: .xlsx/.xls (export do B2BWave) ou .csv/.txt.
    const isXlsx = /\.x(ls|lsx)$/i.test(file.name);
    let rows: Record<string, string>[];
    try {
      // `XLSX.read` LANCA em arquivo corrompido, protegido por senha ou que so
      // tem a extensao de planilha — e `file.arrayBuffer()`/`file.text()`
      // rejeitam quando o arquivo sumiu entre o clique e a leitura. Sem este
      // `catch` virava rejeicao nao tratada: o admin escolhia o arquivo e NADA
      // acontecia, sem toast e sem explicacao.
      rows = isXlsx ? parseXlsx(await file.arrayBuffer()) : parseCSV(await file.text());
    } catch (e: any) {
      toast.error("Could not read this file: " + (e?.message ?? String(e)));
      return;
    }
    if (rows.length === 0) { toast.error("No data rows found"); return; }
    // A coluna de relacionados no export do B2BWave chama-se "related_products_buy_with"
    // (versões antigas: "related_products"). Aceita as duas.
    const relCol = "related_products_buy_with" in rows[0] ? "related_products_buy_with"
      : "related_products" in rows[0] ? "related_products" : null;
    if (!relCol) {
      toast.error('Related products column not found. Use the B2BWave product EXPORT file (Products > Export).');
      return;
    }

    setImporting(true);
    const res: Result[] = [];

    // Mapas locais: por b2bwave_id (preferido) e por sku (código pode repetir — 1º vence).
    // PAGINADO e com ERRO CHECADO.
    //
    // Antes: `.select()` solto, `error` descartado. O PostgREST corta em 1000
    // linhas SEM erro — do produto 1001 em diante o SKU nao era encontrado, todo
    // codigo relacionado virava "missing", `relIds` ficava vazio, e o `delete`
    // la embaixo APAGAVA os vinculos existentes sem recriar nada.
    //
    // `produtos_relacionados` nao tem outra fonte: a API do B2BWave nao expoe
    // related products, e o proprio sync foi proibido de tocar nessa tabela
    // depois de ja ter apagado tudo uma vez. Perder aqui e perder de vez.
    //
    // `fetchAllRows` LANCA em erro — falha de rede deixa de ser indistinguivel
    // de "tabela vazia".
    //
    // E o `throw` PRECISA de quem o pegue. Ele nao tinha: a chamada estava
    // solta, depois do `setImporting(true)`. Erro de leitura (RLS, sessao
    // expirada, rede) virava rejeicao nao tratada — a tela ficava presa em
    // "Importing..." PARA SEMPRE, sem toast, sem tabela, e so recarregando a
    // pagina para sair. O comentario acima ja dizia que a funcao lanca; ninguem
    // tinha escrito o `catch`.
    let produtos: any[];
    try {
      produtos = await fetchAllRows<any>((from, to) =>
        supabase.from("produtos").select("id, sku, b2bwave_id")
          .order("id", { ascending: true }).range(from, to));
    } catch (e: any) {
      // FALHA FECHADA: sem o catalogo completo, todo codigo relacionado viraria
      // "not found" e o import inteiro seria um relatorio de erro — no melhor
      // caso. Nada e lido pela metade, nada e apagado.
      setImporting(false);
      toast.error("Could not read products — nothing was changed: " + (e?.message ?? String(e)));
      return;
    }
    const byB2bId = new Map<string, string>();
    const bySku = new Map<string, string>();
    for (const p of (produtos ?? []) as any[]) {
      if (p.b2bwave_id) byB2bId.set(String(p.b2bwave_id), p.id);
      if (p.sku && !bySku.has(p.sku.toLowerCase())) bySku.set(p.sku.toLowerCase(), p.id);
    }

    let linked = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const label = r["product_name"] || r["product_sku"] || r["b2b_product_id"] || "—";
      // Produto principal: b2b_product_id (exato) > product_sku (código).
      const mainId = (r["b2b_product_id"] && byB2bId.get(r["b2b_product_id"]))
        || (r["product_sku"] && bySku.get(r["product_sku"].toLowerCase()))
        || null;
      if (!mainId) {
        res.push({ row: i + 2, product: label, status: "error", message: "Product not found locally" });
        continue;
      }
      // "-" é slot vazio no export do B2BWave — ignora. Códigos são product_sku de outros produtos.
      const relCodes = (r[relCol] ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
      // Sem relacionados no arquivo → garante lista vazia local (espelho fiel do B2BWave).
      const relIds: string[] = [];
      const missing: string[] = [];
      for (const code of relCodes) {
        const rid = bySku.get(code.toLowerCase());
        if (rid && rid !== mainId && !relIds.includes(rid)) relIds.push(rid);
        else if (!rid) missing.push(code);
      }
      // NAO APAGA ANTES DE SABER QUE VAI RECRIAR.
      //
      // O `delete` era a PRIMEIRA linha deste bloco, incondicional. Quando o
      // arquivo trazia codigos e NENHUM resolvia — linha 1001+ por causa da
      // truncagem, ou codigo errado no CSV — o fluxo caia no ramo "Related codes
      // not found" DEPOIS de ter apagado. A tela reportava erro e o dado ja
      // tinha ido, sem outra fonte de onde voltar.
      if (!relIds.length) {
        if (relCodes.length) {
          res.push({
            row: i + 2, product: label, status: "error",
            message: `Related codes not found: ${missing.join(", ")} — nothing was changed for this product.`,
          });
        } else {
          // Arquivo sem codigo nenhum para esta linha: NAO e ordem de limpar.
          // Antes isto contava como `cleared` — mas o delete ja tinha rodado, e
          // "sem codigo no arquivo" virava "apague os relacionados deste
          // produto". Agora nao mexe.
          res.push({ row: i + 2, product: label, status: "skip", message: "No related products in file — unchanged" });
        }
        continue;
      }

      // GUARDA O QUE VAI SER APAGADO, ANTES de apagar.
      //
      // Nao ha transacao aqui — delete e insert sao dois requests. Se o insert
      // falhar, os vinculos antigos ja se foram, e `produtos_relacionados` NAO tem
      // outra fonte: a API do B2BWave nao expoe related products, entao eles so
      // existem porque alguem importou este arquivo um dia.
      //
      // Uma foto do estado anterior nao substitui transacao, mas transforma "perdi
      // e nao sei o que era" em "perdi e tenho como devolver". A restauracao roda
      // no ramo de erro abaixo.
      const { data: antes, error: antesErr } = await supabase
        .from("produtos_relacionados")
        .select("produto_relacionado_id, comprar_junto")
        .eq("produto_id", mainId);
      if (antesErr) {
        // NAO apaga sem ter a foto. Preferir "nao mexi" a "apaguei e nao sei o que
        // era" — este arquivo e a unica fonte desses vinculos.
        res.push({ row: i + 2, product: label, status: "error", message: `Could not read existing links, nothing was changed: ${antesErr.message}` });
        continue;
      }

      // Erro no delete tambem PARA: seguir para o insert com o delete falhado
      // duplicaria os vinculos.
      const { error: delErr } = await supabase.from("produtos_relacionados").delete().eq("produto_id", mainId);
      if (delErr) {
        res.push({ row: i + 2, product: label, status: "error", message: `Could not clear existing links: ${delErr.message}` });
        continue;
      }

      const { error } = await supabase.from("produtos_relacionados").insert(
        relIds.map((rid) => ({ produto_id: mainId, produto_relacionado_id: rid, comprar_junto: false })),
      );
      if (error) {
        // O DELETE JA PASSOU. Nao ha transacao aqui — sao dois requests — entao
        // este ramo significa vinculos APAGADOS e NAO recriados, e
        // `produtos_relacionados` nao tem outra fonte (a API do B2BWave nao
        // expoe related products). "error.message" sozinho fazia o operador ler
        // "deu erro" e entender "nao mexeu"; o que aconteceu foi o contrario.
        // A mensagem tem que dizer o que perdeu e o que reimportar.
        // TENTA DEVOLVER o que a foto guardou. Se conseguir, o produto volta ao
        // estado anterior e a linha do relatorio para de ser uma perda.
        const restaurar = (antes ?? []).map((r: any) => ({
          produto_id: mainId,
          produto_relacionado_id: r.produto_relacionado_id,
          comprar_junto: r.comprar_junto,
        }));
        const { error: restErr } = restaurar.length > 0
          ? await supabase.from("produtos_relacionados").insert(restaurar)
          : { error: null as any };

        res.push({
          row: i + 2, product: label, status: "error",
          // A contagem agora EXISTE e e verdadeira — vem da foto, nao de
          // `relIds.length` (que era quantos eu IA CRIAR, nao quantos apaguei).
          // Uma versao anterior desta mensagem afirmava "N link(s) lost" com o
          // numero errado.
          message: restErr
            ? `Existing links were removed and could NOT be recreated, and restoring the previous ${restaurar.length} link(s) also failed — re-run this file for this product. ${error.message} / ${restErr.message}`
            : restaurar.length > 0
              ? `Import failed, but the previous ${restaurar.length} link(s) were restored — fix the file and try again. ${error.message}`
              : `Import failed and this product had no links before, so nothing was lost. ${error.message}`,
        });
        continue;
      }
      linked += relIds.length;
      res.push({
        row: i + 2, product: label, status: "ok",
        message: `${relIds.length} linked${missing.length ? ` · not found: ${missing.join(", ")}` : ""}`,
      });
    }

    setResults(res);
    setSummary(`${linked} link(s) created · ${res.filter((x) => x.status === "ok").length} product(s) with related · ${res.filter((x) => x.status === "error").length} error(s)`);
    setImporting(false);
    toast.success(`Import finished — ${linked} link(s) created`);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold flex items-center gap-2"><Link2 className="h-6 w-6" /> Import Related Products</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The B2BWave API does not expose related products — but the product <strong>export file</strong> does.
          In the B2BWave admin go to <strong>Products → Export</strong>, download the file (keep the
          <code className="mx-1">related_products</code> column) and upload it here.
        </p>
      </div>

      <Card className="p-6 mb-4">
        <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        <div className="flex items-center gap-3">
          <Button onClick={() => inputRef.current?.click()} disabled={importing} className="gap-1">
            <Upload className="h-4 w-4" /> {importing ? "Importing..." : "Upload B2BWave export (.xlsx or .csv)"}
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
        </div>
        {summary && <p className="mt-3 text-sm font-medium">{summary}</p>}
      </Card>

      {results.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-16">Row</TableHead><TableHead>Product</TableHead><TableHead className="w-20">Status</TableHead><TableHead>Details</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {results.filter((r) => r.status !== "skip").map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs text-muted-foreground">{r.row}</TableCell>
                  <TableCell className="text-sm font-medium">{r.product}</TableCell>
                  <TableCell>{r.status === "ok" ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}</TableCell>
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

export default ImportRelatedProducts;
