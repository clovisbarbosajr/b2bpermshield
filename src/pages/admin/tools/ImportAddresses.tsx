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
import { nadaFoiEscrito } from "@/lib/linhaAfetada";

/** Numero da linha NO ARQUIVO, para o admin abrir a linha certa.
 *
 * `i + 2` supunha que o indice do array batia com o arquivo — e nao bate: linha
 * em branco e descartada pelo parser, e campo entre aspas pode ocupar varias
 * linhas. Num CSV vindo do Excel, que gosta das duas coisas, o numero reportado
 * mandava o admin para o lugar errado. `parseCSV` carimba `__linha` com o numero
 * real; o `i + 2` fica so como reserva para chamada que nao venha de la. */
const linhaDoArquivo = (r: any, i: number): number => r?.__linha ?? i + 2;
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

    // ENDERECOS JA CADASTRADOS. Esta era a UNICA das quatro telas de importacao sem
    // deduplicacao — as outras tres tem (`variantesPorChave`, `(nome,pai)`,
    // `(cliente,produto)`). E o fluxo que duplica e o normal, nao o descuidado: o
    // admin sobe o arquivo, ve 40 linhas de "Customer not found", corrige os 40
    // e-mails e sobe o arquivo INTEIRO de novo — a tela nao oferece "so os que
    // falharam". Os 2.960 que ja tinham entrado entravam outra vez, e cada cliente
    // passava a ver o endereco em duplicata na lista do checkout.
    //
    // `complemento` ENTRA NA CHAVE. Sem ele, "123 Main St / Suite 100" e "123 Main
    // St / Suite 200" — mesmo predio, mesmo CEP, salas diferentes, que e a forma
    // normal de uma conta B2B — colidiam, e a segunda saia "Already on file" em
    // verde sem nunca entrar. Deduplicar demais e pior que nao deduplicar: perde
    // dado legitimo E diz que deu certo. `address2` esta no template.
    //
    // `Map` e nao `Set`: o id do endereco existente e necessario para o caso do
    // `is_primary` abaixo.
    const jaTem = new Map<string, string>();
    const chaveEndereco = (clienteId: string, logradouro: string, complemento: string, cep: string) =>
      [clienteId, logradouro, complemento, cep].map((s) => (s ?? "").trim().toLowerCase()).join("|");
    try {
      const existentes = await fetchAllRows<{ id: string; cliente_id: string; logradouro: string; complemento: string | null; cep: string }>((from, to) =>
        supabase.from("enderecos").select("id, cliente_id, logradouro, complemento, cep")
          .order("id", { ascending: true }).range(from, to) as any);
      for (const e of existentes) {
        if (e.cliente_id) jaTem.set(chaveEndereco(e.cliente_id, e.logradouro ?? "", e.complemento ?? "", e.cep ?? ""), e.id);
      }
    } catch (e: any) {
      toast.error("Could not read existing addresses — import cancelled: " + (e?.message ?? e));
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
        res.push({ row: linhaDoArquivo(r, i), email: email || "—", status: "error", message: "Customer not found" });
        continue;
      }

      // OS OBRIGATORIOS SAO OBRIGATORIOS DE VERDADE. `logradouro`, `cidade`,
      // `estado` e `cep` sao `NOT NULL` (`20260317043654:83-89`) — e string VAZIA
      // satisfaz `NOT NULL`. Com `|| ""`, um cabecalho divergente (`address_line1`
      // no lugar de `address`, `postal_code` no lugar de `zip` — o export do
      // B2BWave sai assim) gravava 3.000 enderecos EM BRANCO, a tela dizia
      // "Imported 3000 of 3000" e o `import_logs` registrava `success`. No portal
      // o cliente via linhas vazias na lista de entrega, e `Checkout.tsx`
      // pre-selecionava uma delas. A ajuda ao lado ja declarava esses campos como
      // "Required"; nada validava.
      const logradouro = (r["address"] ?? "").trim();
      const cidade = (r["city"] ?? "").trim();
      const estado = (r["state"] ?? "").trim();
      const cep = (r["zip"] ?? "").trim();
      const faltando = [
        !logradouro && "address", !cidade && "city", !estado && "state", !cep && "zip",
      ].filter(Boolean);
      if (faltando.length > 0) {
        res.push({ row: linhaDoArquivo(r, i), email, status: "error", message: `Missing required: ${faltando.join(", ")}` });
        continue;
      }

      const complemento = (r["address2"] ?? "").trim();
      const querPrincipal = (r["is_primary"] || "").toLowerCase() === "yes";
      const chave = chaveEndereco(clienteId, logradouro, complemento, cep);
      const existenteId = jaTem.get(chave);

      // "PRINCIPAL" NAO PODE SER DOIS, e a promocao vale para os DOIS caminhos —
      // endereco novo e endereco que ja estava na base. Nada desmarcava o principal
      // anterior e nao ha indice parcial unico em `enderecos`, entao dois
      // `principal = true` no mesmo cliente eram aceitos; `Checkout.tsx` escolhe com
      // `find(e => e.principal)` e o pre-selecionado virava o que o Postgres
      // devolvesse primeiro. O cliente mudou de endereco, o admin importou o novo
      // com `is_primary=yes`, a tela disse "Imported" — e parte dos pedidos
      // continuava saindo para o endereco velho, sem sinal nenhum no admin.
      // Duas escritas, e a PRIMEIRA ja desmarcou todos quando a segunda roda. Por
      // isso a segunda confirma a linha: o endereco pode ter sido apagado no meio do
      // lote (`portal/Conta.tsx:44` e `admin/CustomerEdit.tsx:787` deletam endereco,
      // e o `existenteId` vem de um snapshot lido ANTES do laco). Zero linhas ali
      // volta `error: null`, e sem esta checagem a tela dizia "set as primary" com o
      // cliente ficando SEM principal nenhum — o `find(e => e.principal)` do
      // `Checkout` nao acha nada e o fallback do endereco da empresa nao roda,
      // porque a lista nao esta vazia.
      //
      // Na PRIMEIRA escrita nao se checa linha afetada de proposito: zero linhas ali
      // e o caso normal — cliente com um endereco so. Checar viraria erro falso em
      // todo lote.
      const promoveAPrincipal = async (idDesteEndereco: string): Promise<{ message: string } | null> => {
        const { error: limpaErr } = await (supabase.from("enderecos") as any)
          .update({ principal: false }).eq("cliente_id", clienteId).neq("id", idDesteEndereco);
        if (limpaErr) return limpaErr;
        const { data: posto, error: poeErr } = await (supabase.from("enderecos") as any)
          .update({ principal: true }).eq("id", idDesteEndereco).select("id");
        if (poeErr) return poeErr;
        if (nadaFoiEscrito(posto, poeErr)) return { message: "the address no longer exists" };
        return null;
      };

      if (existenteId) {
        // O `continue` do dedupe descartava o `is_primary` em silencio — e o fluxo
        // que ele descartava e justamente o que motiva a dedupe: o admin ja tinha
        // importado o endereco, corrige a planilha marcando `is_primary=yes` e
        // resobe. A linha saia "ok" e o principal antigo continuava valendo.
        if (querPrincipal) {
          const err = await promoveAPrincipal(existenteId);
          if (err) {
            res.push({ row: linhaDoArquivo(r, i), email, status: "error", message: `Already on file, but the primary flag was not applied cleanly — check this customer's primary address: ${err.message}` });
            continue;
          }
          res.push({ row: linhaDoArquivo(r, i), email, status: "ok", message: "Already on file — set as primary" });
          continue;
        }
        res.push({ row: linhaDoArquivo(r, i), email, status: "ok", message: "Already on file — not imported again" });
        continue;
      }

      const { data: criado, error } = await (supabase.from("enderecos") as any).insert({
        cliente_id: clienteId,
        logradouro,
        complemento: complemento || null,
        cidade,
        estado,
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
        cep,
        principal: querPrincipal,
      }).select("id").single();

      if (error) {
        res.push({ row: linhaDoArquivo(r, i), email, status: "error", message: error.message });
        continue;
      }
      if (criado?.id) jaTem.set(chave, criado.id);

      if (querPrincipal && criado?.id) {
        const err = await promoveAPrincipal(criado.id);
        if (err) {
          res.push({ row: linhaDoArquivo(r, i), email, status: "error", message: `Address imported, but the primary flag was not applied cleanly — check this customer's primary address: ${err.message}` });
          continue;
        }
      }
      res.push({ row: linhaDoArquivo(r, i), email, status: "ok", message: "Imported" });
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
          <div className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50" onClick={() => { if (!importing) inputRef.current?.click(); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (importing) return; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
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
