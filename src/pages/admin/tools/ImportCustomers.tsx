import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
const TEMPLATE_HEADERS = ["company", "name", "email", "phone", "address", "city", "state", "country", "zip", "website"];
const TEMPLATE_ROW = ["Acme Corp", "John Doe", "john@acme.com", "555-1234", "123 Main St", "New York", "NY", "United States", "10001", "acme.com"];

type Result = { row: number; email: string; status: "ok" | "error"; message: string };

const ImportCustomers = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "import_customers_template.csv";
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

    // Quem JÁ existe não pode ser rebaixado pela reimportação. Antes o upsert
    // mandava sempre status "pendente" + is_active false e nome/empresa com ""
    // default: reimportar a planilha (mesmo pra corrigir 1 linha) derrubava TODOS
    // os clientes aprovados pra pendente/inativo — perdiam acesso ao portal — e
    // apagava nome/empresa de quem não tinha essas colunas no CSV.
    // O DEDUPE tinha tres defeitos, e os TRES levavam a cadastro DUPLICADO —
    // e nao ha UNIQUE em `clientes.email` para segurar (a unica UNIQUE da tabela
    // e a de `user_id`).
    //
    //   1. `.in()` sem paginacao: o PostgREST corta em 1000 linhas SEM erro. Do
    //      milesimo cliente ja cadastrado em diante, `isExisting` virava false e
    //      o import criava linha nova.
    //   2. O `error` era descartado. `.in()` com milhares de e-mails estoura o
    //      tamanho da URL (e requisicao GET); o erro voltava, era ignorado, o
    //      conjunto ficava VAZIO e TODA linha do CSV virava INSERT — duplicata
    //      da base inteira numa tacada.
    //   3. `.in()` diferencia maiuscula de minuscula, mas a escrita usa
    //      `.ilike()`. Base com `John@Acme.com` e CSV com `john@acme.com` nao
    //      casavam no dedupe e criavam duplicata.
    //
    // Conserto: le a coluna INTEIRA, paginada, e compara em minusculas. Sao os
    // e-mails de todos os clientes — dezenas de KB, nao e caro, e e a unica
    // forma de nao depender do tamanho da URL nem do limite de 1000.
    // E-MAIL REPETIDO NA BASE RECUSA A LINHA, como ja fazem as telas irmas
    // (`ImportCustomerPrices` com este MESMO e-mail, `ImportCategories` com nome
    // de pai, `ImportProductVariants` com SKU, `BulkUpdateOrders` com numero de
    // pedido). Esta era a unica das seis que escrevia por filtro NAO UNICO.
    //
    // `clientes` nao tem UNIQUE em `email` — a unica da tabela e
    // `clientes_user_id_unique` (20260331183125:21) — e a duplicata nao e
    // hipotese: `b2bwave-sync/index.ts:57` registra que o cron ja encheu a base
    // de fichas duplicadas por isso. Com duas linhas no mesmo e-mail, o
    // `.ilike()` do UPDATE casa AS DUAS (filtro do PostgREST nao tem LIMIT) e
    // sobrescrevia nome, empresa, telefone e endereco das duas com a linha do
    // CSV — as duas fichas viravam a mesma, com UM "Updated" verde no relatorio.
    // O cadastro do outro cliente sumia sem sinal.
    //
    // A checagem tem que ser PRE-VOO: olhar `data.length > 1` depois do UPDATE
    // reportaria erro sobre estrago ja consumado. O `id` para isto ja estava
    // sendo lido aqui e jogado fora.
    const emailAmbiguo = new Set<string>();
    // E O UPDATE PASSA A SER POR `id`, nao por filtro de texto.
    //
    // Enquanto a escrita era `.ilike("email", ...)`, existiam DUAS nocoes de
    // "mesmo e-mail" no mesmo arquivo e elas divergiam: a chave aqui normaliza com
    // `trim()`, e `ilike` e case-insensitive mas NAO ignora espaco. A base tem as
    // duas grafias — `b2bwave-sync/index.ts:1901` grava `c.email || ""` sem trim —
    // e a divergencia dava erro nos dois sentidos: ficha ` john@x.com` com CSV
    // `john@x.com` casava zero linhas e a tela dizia "this customer is no longer
    // there" sobre um cliente que ESTA la (e, sendo ramo de UPDATE, ele nunca era
    // criado — toda reimportacao repetia o erro).
    //
    // O `id` ja estava sendo lido e jogado fora. Escrever por ele mata a
    // divergencia inteira, e de quebra dispensa o escape de `_`/`%` do LIKE, que
    // so existia porque o filtro era textual.
    const idPorEmail = new Map<string, string>();
    try {
      const todos = await fetchAllRows<{ id: string; email: string | null }>((from, to) =>
        supabase.from("clientes").select("id, email")
          .order("id", { ascending: true }).range(from, to));
      for (const c of todos) {
        if (!c.email) continue;
        const k = String(c.email).trim().toLowerCase();
        if (idPorEmail.has(k) && idPorEmail.get(k) !== c.id) emailAmbiguo.add(k);
        else idPorEmail.set(k, c.id);
      }
    } catch (e: any) {
      // FALHA ALTO. Seguir com o conjunto vazio significaria duplicar a base
      // inteira, calado. `fetchAllRows` lanca em erro justamente para isto.
      toast.error("Could not read existing customers — import cancelled so nothing gets duplicated: " + (e?.message ?? e));
      setImporting(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const email = r["email"]?.trim();
      if (!email) {
        res.push({ row: linhaDoArquivo(r, i), email: "—", status: "error", message: "Missing email" });
        continue;
      }
      const emailLc = email.toLowerCase();
      if (emailAmbiguo.has(emailLc)) {
        // O arquivo nao tem como desempatar, e escolher por conta propria seria
        // sobrescrever as DUAS fichas com a mesma linha.
        res.push({
          row: linhaDoArquivo(r, i), email, status: "error",
          message: `More than one customer record uses ${email} — merge them before importing`,
        });
        continue;
      }
      const isExisting = idPorEmail.has(emailLc);

      const payload: any = { email };
      // Só grava o que veio preenchido no CSV — coluna ausente/vazia não apaga o
      // dado que já está no cadastro.
      const put = (col: string, val: any) => {
        const v = typeof val === "string" ? val.trim() : val;
        if (v !== undefined && v !== null && v !== "") payload[col] = v;
      };
      put("nome", r["name"] || r["nome"]);
      put("empresa", r["company"] || r["empresa"]);
      put("telefone", r["phone"] || r["telefone"]);
      put("endereco", r["address"] || r["endereco"]);
      put("cidade", r["city"] || r["cidade"]);
      put("estado", r["state"] || r["estado"]);
      put("cep", r["zip"] || r["cep"]);
      put("website", r["website"]);
      if (isExisting) {
        put("pais", r["country"] || r["pais"]);
      } else {
        // Cliente NOVO entra como pendente/inativo (aprovação manual do admin).
        payload.nome = payload.nome ?? "";
        payload.empresa = payload.empresa ?? "";
        payload.pais = (r["country"] || r["pais"] || "United States");
        payload.status = "pendente";
        payload.is_active = false;
        // `clientes.user_id` e NOT NULL e NAO tem DEFAULT (20260317043654:68).
        // Sem ele todo INSERT morria com 23502 e esta importacao NUNCA criou um
        // cliente — o `payload: any` escondia a coluna faltando do `tsc`.
        // Importar sem login e o desenho: a FK para `auth.users` foi dropada de
        // proposito ("so we can import customers without auth users",
        // 20260319152251), e o sync do B2BWave faz exatamente isto
        // (supabase/functions/b2bwave-sync/index.ts:2005). No primeiro login,
        // `claim_customer_record()` casa por e-mail e troca pelo `auth.uid()`
        // real. Aleatorio tambem satisfaz o `clientes_user_id_unique`.
        payload.user_id = crypto.randomUUID();
      }

      // ANTES: `.upsert(payload, { onConflict: "email" })`. Mesmo defeito da
      // importação de categorias (confirmado no banco em 03/ago): `clientes` NÃO
      // tem UNIQUE em `email` — a única UNIQUE da tabela é `clientes_user_id_unique`
      // (20260331183125:21). A `UNIQUE (email)` que existe nas migrations é da
      // `company_contacts`, tabela DROPADA em 20260622000000. Sem o índice, o
      // Postgres rejeita toda linha com 42P10 e a importação de clientes estava
      // quebrada por inteiro.
      //
      // Não dá pra criar o UNIQUE sem decidir o que fazer com e-mails duplicados
      // que já existam na base — então aqui é UPDATE ou INSERT explícito, usando
      // o mapa `idPorEmail` que a tela já carregou acima.
      let error: any = null;
      let recusaSilenciosa = false;
      if (isExisting) {
        // Pelo `id` do snapshot, nao por `.ilike("email", ...)`. O filtro textual
        // divergia da chave que decidiu `isExisting` (ela normaliza com `trim()`,
        // `ilike` nao) e exigia escapar `_` e `%`, que sao curinga no LIKE e `_` e
        // comum em e-mail. `emailAmbiguo` ja recusou a linha acima quando o e-mail
        // tem mais de uma ficha, entao aqui o `id` e unico por construcao.
        const r2 = await supabase.from("clientes").update(payload)
          .eq("id", idPorEmail.get(emailLc)!).select("id");
        error = r2.error;
        // `idPorEmail` e um SNAPSHOT lido antes do laco. Entre a leitura e este
        // UPDATE o cliente pode ter sido apagado por outro admin, e RLS FILTRA o
        // UPDATE em vez de levantar erro. Nos dois casos vinha `error: null` com
        // zero linha e a tela dizia "Updated" — e como o e-mail continua no
        // snapshot, reimportar o arquivo NAO cria o cliente: ele nunca entra, e
        // toda execucao diz que atualizou.
        recusaSilenciosa = nadaFoiEscrito(r2.data, r2.error);
      } else {
        const r2 = await supabase.from("clientes").insert(payload).select("id");
        error = r2.error;
        // Duas linhas do MESMO arquivo com o mesmo e-mail duplicariam entre si,
        // porque o mapa so tem o que ja estava no banco. Registra o que acabou de
        // entrar — com o `id`, senao a segunda linha entraria no ramo de UPDATE
        // sem id nenhum para escrever.
        const novoId = r2.data?.[0]?.id;
        if (!error && novoId) idPorEmail.set(emailLc, novoId);
      }
      if (error) {
        res.push({ row: linhaDoArquivo(r, i), email, status: "error", message: error.message });
      } else if (recusaSilenciosa) {
        res.push({
          row: linhaDoArquivo(r, i), email, status: "error",
          message: "This customer is no longer there for you to update — nothing was written",
        });
      } else {
        res.push({ row: linhaDoArquivo(r, i), email, status: "ok", message: isExisting ? "Updated" : "Created" });
      }
    }

    setResults(res);
    setImporting(false);
    const ok = res.filter((r) => r.status === "ok").length;
    const errCount = res.filter((r) => r.status === "error").length;
    toast.success(`Imported ${ok} of ${rows.length} customers`);
    supabase.from("import_logs").insert({ tipo: "customers", arquivo_nome: file.name, registros_total: rows.length, registros_erro: errCount, registros_sucesso: rows.length - errCount, status: errCount === 0 ? "success" : "partial" } as any).then(() => {});
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Customers</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk import customer accounts via CSV.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Upload CSV</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Columns: <code className="text-xs bg-muted px-1 rounded">{TEMPLATE_HEADERS.join(", ")}</code>
          </p>
          <div
            className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <div className="text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{fileName || "Drag & drop or click to browse"}</p>
              <Button variant="outline" className="mt-4 gap-2" disabled={importing}>
                <Upload className="h-4 w-4" /> {importing ? "Importing..." : "Choose File"}
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
            <p><strong>Required:</strong> email</p>
            <p><strong>Optional:</strong> company, name, phone, address, city, state, country, zip, website</p>
            <p className="text-amber-400">Customers are imported as <em>pending</em>. Approve them in User Management.</p>
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
              <TableRow><TableHead>Row</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Message</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground text-xs">{r.row}</TableCell>
                  <TableCell className="text-sm">{r.email}</TableCell>
                  <TableCell>
                    {r.status === "ok"
                      ? <CheckCircle className="h-4 w-4 text-green-400" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                  </TableCell>
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

export default ImportCustomers;
