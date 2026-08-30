import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { parseCSV } from "@/lib/csv";
import { nadaFoiEscrito } from "@/lib/linhaAfetada";
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
const TEMPLATE_ROW = ["Impermeabilizantes", "Produtos Químicos", "Linha completa de impermeabilizantes", "1"];

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

    // Fetch all existing categories for parent lookup.
    // PAGINADO e com o erro LIDO. Antes era `const { data } = await ...select()`:
    // o `error` ia para o lixo e o PostgREST ainda cortava em 1000 linhas sem
    // avisar. Leitura falhando = mapa vazio = TODA linha com `parent_name` saia
    // como "Parent category not found" — mentira, a categoria pai existe.
    // DOIS mapas, montados da MESMA leitura, porque as duas perguntas sao diferentes:
    //
    //  * `porNome` resolve `parent_name` — e o CSV so tem o NOME do pai, nunca o avo.
    //    O bloco mais abaixo ja dizia que existem homonimas de proposito ("One Plus"
    //    em 3 estados) e que "nome + pai identifica". Mesmo assim isto era
    //    `nameMap[nome] = id` ultimo-vence: 40 subcategorias apontando para
    //    `parent_name=One Plus` iam TODAS para a que veio por ultimo na paginacao,
    //    com "Created" verde. Nome homonimo agora RECUSA a linha, do mesmo jeito que
    //    `ImportCustomerPrices` recusa SKU repetido — o arquivo nao tem como
    //    desempatar, e escolher por conta propria e o defeito.
    //
    //  * `porChave` responde "esta categoria ja existe?" por (nome, pai), que era a
    //    unica metade ja correta — e substitui o SELECT por linha. Ele fazia
    //    `.eq("nome", name)`, case-SENSITIVE (`categorias.nome` e TEXT puro, sem
    //    `citext` nem `COLLATE` em nenhuma migration), enquanto o mapa do pai era
    //    minusculo: as duas metades da mesma decisao usavam criterios diferentes, e
    //    um CSV com "produtos quimicos" nao achava "Produtos Quimicos" e criava uma
    //    irma duplicada, visivel no menu e vazia.
    //
    // Falha FECHADO continua valendo: `fetchAllRows` LANCA e o `catch` cancela a
    // importacao inteira antes de gravar qualquer linha.
    const porNome = new Map<string, string>();
    const nomeAmbiguo = new Set<string>();
    const porChave = new Map<string, string>();
    const chaveAmbigua = new Set<string>();
    const chaveDe = (nome: string, paiId: string | null) =>
      `${nome.trim().toLowerCase()}|${paiId ?? ""}`;
    try {
      const existingCats = await fetchAllRows<{ id: string; nome: string; parent_id: string | null }>((from, to) =>
        supabase.from("categorias").select("id, nome, parent_id")
          .order("id", { ascending: true }).range(from, to));
      for (const c of existingCats) {
        const n = c.nome.trim().toLowerCase();
        if (porNome.has(n) && porNome.get(n) !== c.id) nomeAmbiguo.add(n);
        else porNome.set(n, c.id);

        const k = chaveDe(c.nome, c.parent_id);
        if (porChave.has(k) && porChave.get(k) !== c.id) chaveAmbigua.add(k);
        else porChave.set(k, c.id);
      }
    } catch (e: any) {
      toast.error("Could not read existing categories — import cancelled: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r["name"]?.trim();

      if (!name) {
        res.push({ row: linhaDoArquivo(r, i), name: "—", status: "error", message: "Missing name" });
        continue;
      }

      const parentName = r["parent_name"]?.trim();
      let categoriaPaiId: string | null = null;

      if (parentName) {
        const pn = parentName.toLowerCase();
        if (nomeAmbiguo.has(pn)) {
          res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: `More than one category is named "${parentName}" — the file cannot say which one is the parent` });
          continue;
        }
        categoriaPaiId = porNome.get(pn) ?? null;
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

      // O caso que o `maybeSingle()` cobria com PGRST116 — mais de uma categoria
      // com este (nome, pai) — continua RECUSADO, agora no mapa e sem ida ao banco.
      const chave = chaveDe(name, categoriaPaiId);
      if (chaveAmbigua.has(chave)) {
        res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: "More than one category already has this name under this parent — nothing written; merge them first" });
        continue;
      }
      const existenteId = porChave.get(chave) ?? null;

      // MESMO VICIO DO IMPORT DE VARIANTES: campo de CRIAR aplicado ao ATUALIZAR.
      // `ativo: true` e `descricao: ... || null` iam no UPDATE mesmo quando o
      // arquivo nao trazia essas colunas. Um CSV so com `name,parent_name,ordem`
      // (o fluxo normal de reordenar o menu) REPUBLICAVA na loja as categorias
      // desativadas de proposito — e desativar assim e coisa que o proprio sistema
      // faz em massa (`20260320204242:34`, `SET ativo = false WHERE b2bwave_id IS
      // NULL`), com `ativo` sendo o filtro de visibilidade do catalogo
      // (`20260701130000_privacy_view_as_target.sql:56`) — e apagava TODAS as
      // descricoes, tudo com "Updated" verde.
      const temDescricao = String(r["description"] ?? "").trim() !== "";
      // `nome` e `parent_id` sao a CHAVE pela qual esta linha foi encontrada — nao
      // sao dado a atualizar. Deixa-los no payload do UPDATE reintroduzia o mesmo
      // vicio pelo outro lado: agora que o match e case-insensitive, um CSV com
      // "produtos quimicos" casa "Produtos Quimicos" e RENOMEAVA a categoria para o
      // caixa da planilha — mudando o rotulo do menu da loja inteira, com "Updated"
      // verde. No UPDATE so vai o que o arquivo veio mudar.
      const campos: any = {
        ...(temDescricao ? { descricao: r["description"] } : {}),
        ...(temOrdem ? { ordem: ordemParsed } : {}),
      };

      // UPDATE sem nenhum campo e erro no PostgREST, e "nada a mudar" e um desfecho
      // legitimo: a linha existe e o arquivo nao trouxe coluna nova nenhuma.
      if (existenteId && Object.keys(campos).length === 0) {
        res.push({ row: linhaDoArquivo(r, i), name, status: "ok", message: "Already on file — nothing to change" });
        porChave.set(chave, existenteId);
        continue;
      }

      const { data: gravada, error } = existenteId
        ? await supabase.from("categorias").update(campos).eq("id", existenteId).select("id").maybeSingle()
        : await supabase.from("categorias").insert({ ...campos, nome: name, parent_id: categoriaPaiId, descricao: temDescricao ? r["description"] : null, ativo: true }).select("id").maybeSingle();

      if (error) {
        res.push({ row: linhaDoArquivo(r, i), name, status: "error", message: error.message });
      } else if (existenteId && nadaFoiEscrito(gravada, error)) {
        // RLS FILTRA o UPDATE em vez de levantar erro, e outro admin pode ter
        // apagado a categoria entre o SELECT do inicio da importacao e este
        // UPDATE. Nos dois casos o PostgREST devolve `error: null` com zero linha
        // e a tela dizia "Updated". Aqui `gravada` vem de `maybeSingle()`, entao
        // e objeto ou `null` — nao array.
        res.push({
          row: linhaDoArquivo(r, i), name, status: "error",
          message: "This category is no longer there for you to update — nothing was written",
        });
      } else {
        // Deixa a categoria disponível como PAI para as linhas seguintes do CSV.
        if (gravada?.id) {
          const n = name.toLowerCase();
          if (porNome.has(n) && porNome.get(n) !== gravada.id) nomeAmbiguo.add(n);
          else porNome.set(n, gravada.id);
          porChave.set(chave, gravada.id);
        }
        res.push({ row: linhaDoArquivo(r, i), name, status: "ok", message: existenteId ? "Updated" : "Created" });
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
