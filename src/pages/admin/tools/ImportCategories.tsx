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

/** Numero da linha NO ARQUIVO, para o admin abrir a linha certa.
 *
 * `i + 2` supunha que o indice do array batia com o arquivo — e nao bate: linha
 * em branco e descartada pelo parser, e campo entre aspas pode ocupar varias
 * linhas. Num CSV vindo do Excel, que gosta das duas coisas, o numero reportado
 * mandava o admin para o lugar errado. `parseCSV` carimba `__linha` com o numero
 * real; o `i + 2` fica so como reserva para chamada que nao venha de la. */
const linhaDoArquivo = (r: any, i: number): number => r?.__linha ?? i + 2;
const TEMPLATE_HEADERS = ["name", "parent_name", "description", "ordem"];
const TEMPLATE_ROW = ["Impermeabilizantes", "Produtos QuÃ­micos", "Linha completa de impermeabilizantes", "1"];

type Result = { row: number; name: string; status: "ok" | "error"; message: string };

const ImportCategories = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_categories_template.csv";
    a.click();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
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

    // Fetch all existing categories for parent lookup.
    // PAGINADO e com o erro LIDO. Antes era `const { data } = await ...select()`:
    // o `error` ia para o lixo e o PostgREST ainda cortava em 1000 linhas sem
    // avisar. Leitura falhando = mapa vazio = TODA linha com `parent_name` saia
    // como "Parent category not found" — mentira, a categoria pai existe.
    const nameMap: Record<string, string> = {};
    try {
      const existingCats = await fetchAllRows<{ id: string; nome: string }>((from, to) =>
        supabase.from("categorias").select("id, nome")
          .order("id", { ascending: true }).range(from, to));
      for (const c of existingCats) nameMap[c.nome.toLowerCase()] = c.id;
    } catch (e: any) {
      toast.error("Could not read existing categories — import cancelled: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r["name"]?.trim();

      if (!name) {
        res.push({ row: linhaDoArquivo(r, i), name: "â€”", status: "error", message: "Missing name" });
        continue;
      }

      const parentName = r["parent_name"]?.trim();
      let categoriaPaiId: string | null = null;

      if (parentName) {
        categoriaPaiId = nameMap[parentName.toLowerCase()] ?? null;
        if (!categoriaPaiId) {
          res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: `Parent category not found: ${parentName}` });
          continue;
        }
      }

      // ANTES: `.upsert({...}, { onConflict: "nome" })`. Isso NUNCA funcionou —
      // `categorias` só tem o índice da chave primária (`categorias_pkey` em `id`),
      // sem UNIQUE em `nome` (confirmado no banco de produção em 03/ago). Sem o
      // índice, o Postgres rejeita TODA linha com 42P10 ("no unique or exclusion
      // constraint matching the ON CONFLICT specification") — a importação de
      // categorias estava 100% quebrada, não só quando `ordem` vinha vazia.
      //
      // E criar o UNIQUE em `nome` seria ERRADO: o sistema tem categorias
      // homônimas de propósito, em locais diferentes ("One Plus" em 3 estados) —
      // o próprio código de Produção comenta isso. Nome não identifica categoria;
      // nome + pai identifica.
      //
      // Então: procura por (nome, pai) e faz UPDATE ou INSERT. `ordem` em branco
      // é OMITIDA no insert (deixa o `DEFAULT 0` agir, `NOT NULL` em
      // 20260318182853:4) e não é tocada no update (preserva o valor atual).
      const ordemParsed = parseInt(String(r["ordem"] ?? "").trim(), 10);
      const temOrdem = Number.isFinite(ordemParsed);

      const buscaExistente = supabase.from("categorias").select("id").eq("nome", name);
      // O `error` desta busca era descartado. Falhando ela — inclusive com o
      // PGRST116 que o `maybeSingle()` devolve quando ja existe mais de uma
      // categoria com este (nome, pai) — `existente` vinha nulo e o codigo caia
      // no INSERT: a tela dizia "Created" e a importacao criava justamente a
      // DUPLICATA que este bloco existe para evitar. Falha FECHADO.
      const { data: existente, error: buscaErr } = categoriaPaiId
        ? await buscaExistente.eq("parent_id", categoriaPaiId).maybeSingle()
        : await buscaExistente.is("parent_id", null).maybeSingle();
      if (buscaErr) {
        res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: `Could not check whether this category already exists, nothing written: ${buscaErr.message}` });
        continue;
      }

      const campos: any = {
        nome: name,
        descricao: r["description"] || null,
        parent_id: categoriaPaiId,
        ativo: true,
        ...(temOrdem ? { ordem: ordemParsed } : {}),
      };

      const { data: gravada, error } = existente?.id
        ? await supabase.from("categorias").update(campos).eq("id", existente.id).select("id").maybeSingle()
        : await supabase.from("categorias").insert(campos).select("id").maybeSingle();

      if (error) {
        res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: error.message });
      } else {
        // Deixa a categoria disponível como PAI para as linhas seguintes do CSV.
        if (gravada?.id) nameMap[name.toLowerCase()] = gravada.id;
        res.push({ row: linhaDoArquivo(r, i), name, status: "ok", message: existente?.id ? "Updated" : "Created" });
      }
    }

    setResults(res);
    setImporting(false);
    const okCat = res.filter((r) => r.status === "ok").length;
    const errCat = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${okCat} of ${rows.length} categories`);
    supabase.from("import_logs").insert({ tipo: "categories", arquivo_nome: file.name, registros_total: rows.length, registros_erro: errCat, registros_sucesso: rows.length - errCat, status: errCat === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Categories</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import product categories via CSV.</p>
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
            <p><strong>Required:</strong> name</p>
            <p><strong>Optional:</strong> parent_name, description, ordem</p>
            <p><strong>Note:</strong> parent_name must match an existing or already-imported category name.</p>
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
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
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

export default ImportCategories;
