import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, CheckCircle, XCircle, SkipForward } from "lucide-react";
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
const TEMPLATE_HEADERS = ["customer_email", "product_sku", "quantity", "price", "status", "po_number", "delivery_date"];
const TEMPLATE_ROW = ["john@acme.com", "PROD-001", "10", "45.90", "submitted", "PO-2024-001", "2024-12-31"];

// `skip` e um TERCEIRO desfecho, e nao um "ok" nem um "error": o pedido ja existia
// e nada foi feito. Juntar com qualquer um dos dois mentiria no relatorio — "ok"
// contaria como importado o que nao foi, e "error" mandaria o operador investigar
// um comportamento correto.
type Result = { row: number; key: string; status: "ok" | "error" | "skip"; message: string };

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
    let rows: Record<string, string>[];
    try {
      // Arquivo corrompido ou ilegivel lancava aqui sem toast nenhum — o usuario
      // soltava o CSV e nao acontecia nada, sem explicacao.
      rows = parseCSV(await file.text());
    } catch (e: any) {
      toast.error("Could not read this file: " + (e?.message ?? String(e)));
      return;
    }
    if (rows.length === 0) { toast.error("No data rows found"); return; }

    setImporting(true);
    const res: Result[] = [];
    // `suprimiu`: o `finally` so pode SOLTAR o que foi levantado. A supressao e
    // contada por referencia no banco — soltar sem ter levantado decrementa o
    // contador de OUTRO lote e derruba a protecao dele.
    let suprimiu = false;
    let abortou = false;
    // LINHAS de CSV que ENTRARAM. Um contador so, e o de erro sai por
    // SUBTRACAO (`rows.length - linhasOk`) no `finally`.
    //
    // A soma caso a caso ja quebrou DUAS vezes aqui: primeiro contando pedidos
    // onde o total conta linhas, depois esquecendo um dos quatro erros de grupo
    // ("Product not found") e os grupos nao processados apos uma excecao. Nos
    // dois casos a tela de Imports (`ExportsLog.tsx`, que renderiza
    // `{total} ({sucesso} ok / {erro} err)` na mesma celula) mostrou numeros que
    // nao fecham — e a segunda versao mostrava ZERO erros numa importacao em que
    // nada entrou.
    //
    // Por subtracao nao ha caso a esquecer: tudo que nao entrou conta como nao
    // entrado, seja erro de linha, erro de grupo ou grupo que a excecao impediu
    // de tentar. E o que o dono precisa saber ao abrir o registro: de N linhas do
    // arquivo, quantas estao no banco.
    let linhasOk = 0;
    // O `try` abre AQUI, nao depois da supressao. Os dois `fetchAllRows` abaixo
    // LANCAM de verdade (`fetchAllRows.ts` faz `throw` em erro de RLS ou rede) e
    // ficavam fora de qualquer protecao: a tela travava em "Importing..." para
    // sempre, sem toast, sem tabela. A versao anterior protegeu o laco — que usa
    // `await supabase.from(...)` e praticamente nao lanca — e deixou descoberto
    // justamente o ponto que lanca.
    try {

    // Fetch clientes emailâ†’id map
    // PAGINADO: sem isto, do milesimo cliente em diante o pedido historico era
    // descartado com "Customer not found" — e pedido historico nao tem de onde
    // voltar depois que o B2BWave for desligado.
    const clientes = await fetchAllRows<any>((from, to) =>
      supabase.from("clientes").select("id, email")
        .order("id", { ascending: true }).range(from, to));
    const emailMap: Record<string, string> = {};
    (clientes ?? []).forEach((c: any) => { emailMap[c.email] = c.id; });

    // Fetch produtos skuâ†’{id, nome, preco} map
    const produtos = await fetchAllRows<any>((from, to) =>
      supabase.from("produtos").select("id, sku, nome, preco")
        .order("id", { ascending: true }).range(from, to));
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
        groupRowErrors.push({ row: linhaDoArquivo(r, i), key, status: "error", message: "Missing customer_email" });
        continue;
      }
      if (!sku) {
        groupRowErrors.push({ row: linhaDoArquivo(r, i), key, status: "error", message: "Missing product_sku" });
        continue;
      }

      // `parseInt(x) || 1` transformava lixo em 1 SEM AVISAR: "abc" virava 1,
      // "0" virava 1, "10 caixas" virava 10. Num import de pedido historico isso
      // e quantidade errada gravada como se fosse certa — e o preco, na linha
      // seguinte, JA era validado com isNaN. Faltou so a quantidade.
      const quantityRaw = String(r["quantity"] ?? "").trim();
      const quantity = Number(quantityRaw);
      if (!Number.isInteger(quantity) || quantity < 1) {
        groupRowErrors.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `Invalid quantity "${quantityRaw}" — must be a whole number of 1 or more` });
        continue;
      }
      // O MESMO defeito da quantidade, uma linha acima, so que em dinheiro:
      // `parseFloat` le o PREFIXO e joga o resto fora sem reclamar. "45,90"
      // entre aspas (planilha pt-BR) vira 45; "45x" vira 45; "1.2.3" vira 1.2.
      // Preco errado gravado como se fosse certo num pedido historico — que nao
      // tem de onde voltar depois que o B2BWave for desligado.
      //
      // `Number` recusa a string INTEIRA. A celula vazia e tratada a parte
      // porque `Number("")` e 0, e preco zero vindo de celula em branco seria a
      // mesma mentira com outro numero (`parseFloat("")` dava NaN e era pego).
      const priceRaw = String(r["price"] ?? "").trim();
      const price = priceRaw === "" ? NaN : Number(priceRaw);
      if (!Number.isFinite(price)) {
        groupRowErrors.push({ row: linhaDoArquivo(r, i), key, status: "error", message: `Invalid price "${priceRaw}"` });
        continue;
      }

      const groupKey = `${email}|||${poNumber}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          customerEmail: email,
          poNumber,
          status: r["status"]?.trim() || "submitted",
          deliveryDate: r["delivery_date"]?.trim() || "",
          rows: [],
        };
      }
      groups[groupKey].rows.push({ sku, quantity, price, rowNum: i + 2 });
    }

    // Push row-level errors first
    res.push(...groupRowErrors);

    // REGRA NUMERO UM (a mesma do topo de `b2bwave-sync/index.ts`): operacao em
    // MASSA suprime notificacao ANTES de comecar — e a pergunta e QUAL GATILHO
    // ela acorda, nao qual tabela ela toca.
    //
    // Esta tela nao grava em `produtos`, entao passava por inofensiva. Nao e:
    // cada `pedido_itens.insert` abaixo dispara o gatilho de reserva, que faz
    // `UPDATE produtos SET estoque_reservado = estoque_reservado + qtd` — e
    // `estoque_reservado` e coluna vigiada por `trg_low_stock_notify`. Uma
    // planilha de 200 linhas reserva estoque de ate 200 produtos, e cada
    // cruzamento do limite vira um alerta. Este e a tela de ajuste de inventario
    // eram os dois caminhos de massa sem NENHUMA das duas chaves; os dois foram
    // fechados na mesma leva.
    //
    // Piso de 30 min, nao 10: `desde` e COMPARTILHADO e fica ancorado no PRIMEIRO
    // lote da sequencia. Se um sync orfao abriu a sequencia ha 110 minutos, esta
    // chamada herda aquele `desde` e o silencio morre em 10 — no meio da
    // importacao. O SQL ja limita em 120, entao pedir mais nao custa nada.
    const minutosSup = Math.max(30, Math.ceil(Object.keys(groups).length / 100) * 5);
    const { error: supErr } = await supabase.rpc("set_suppress_stock_notify" as any, {
      _on: true, _minutos: minutosSup,
    });
    if (supErr) {
      // Falhar aqui ABORTA antes de criar qualquer pedido. Melhor a planilha nao
      // subir do que subir disparando alerta por produto. O `finally` cuida do
      // `setImporting(false)`, e `suprimiu` continua false — nada a soltar.
      // `abortou` para que o `import_logs` registre `failed`, e nao `partial`:
      // nenhum pedido foi criado, e o registro de auditoria tem que dizer isso.
      abortou = true;
      toast.error("Could not pause stock alerts — nothing was imported. " + supErr.message);
      return;
    }
    suprimiu = true;

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

      // JA IMPORTADO? So da para saber quando ha `po_number`.
      //
      // O defeito: rodar a mesma planilha duas vezes criava os pedidos de novo. E
      // o caminho para isso e comum — o relatorio marca `partial` quando alguma
      // linha falha, o operador corrige o arquivo e reimporta o TODO, porque nao
      // ha como reimportar so a linha que faltou.
      //
      // `po_number` e a unica identidade que a planilha carrega. Sem ele, dois
      // pedidos iguais do mesmo cliente sao indistinguiveis de um pedido repetido
      // de verdade — e recusar seria pior que duplicar. Por isso a checagem so
      // roda quando a coluna vem preenchida, e o relatorio diz isso.
      //
      // TETO CONHECIDO: e checagem no cliente, nao UNIQUE no banco. Dois
      // operadores subindo a mesma planilha ao mesmo tempo passam os dois. O
      // conserto definitivo e `UNIQUE (cliente_id, po_number)` em `pedidos`, que
      // exige SQL e decisao do dono (pedido sem PO teria que virar NULL, nao "").
      if (group.poNumber) {
        const { data: jaExiste, error: checagemErr } = await supabase
          .from("pedidos")
          .select("id, numero")
          .eq("cliente_id", clienteId)
          .eq("po_number", group.poNumber)
          .limit(1)
          .maybeSingle();
        if (checagemErr) {
          // NAO cria as cegas: seguir aqui e exatamente o caminho que duplica.
          res.push({
            row: group.rows[0].rowNum, key, status: "error",
            message: `Could not check whether this PO was already imported, so nothing was created: ${checagemErr.message}`,
          });
          continue;
        }
        if (jaExiste) {
          res.push({
            row: group.rows[0].rowNum, key, status: "skip",
            message: `PO ${group.poNumber} already imported for this customer (order #${jaExiste.numero ?? jaExiste.id}) — skipped`,
          });
          continue;
        }
      }

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
        // Traduz o erro do gatilho: a mensagem crua do Postgres num relatorio de
        // importacao nao diz ao operador o que fazer.
        const amigavel = /ITEM_NEEDS_VARIANT/i.test(itensError.message)
          ? "a product in this order has options (size/color) and the CSV has no variant column — import it through the product page"
          : itensError.message;

        // PEDIDO SEM ITEM NAO PODE FICAR. Antes a linha dizia "Order created but
        // items failed" e ia embora: sobrava no banco um pedido com ZERO itens,
        // carregando o `total`/`subtotal` que a planilha mandou (o recalculo do
        // `fn_pedido_total_appside` so roda no AFTER INSERT dos itens) e no status
        // que o CSV pediu — inclusive `complete`. Um pedido de valor fantasma na
        // fila e no historico do cliente, e o operador reimportava a planilha
        // corrigida, criando outro.
        //
        // Apagar direto, e nao pela RPC `pedido_rollback_checkout`: ela exige
        // status `submitted` (`ROLLBACK_ADVANCED`), e aqui o CSV escolhe o status.
        // Justamente o orfao marcado `complete` — o pior — ela recusaria.
        //
        // Seguro: os itens NAO entraram, entao nao houve reserva de estoque
        // (`trg_reserve_stock_on_order_item` e no INSERT do item), e o ajuste por
        // status e AFTER UPDATE, nao INSERT. Nao ha o que devolver.
        const { error: limpezaErr } = await supabase.from("pedidos").delete().eq("id", pedido.id);
        res.push({
          row: group.rows[0].rowNum, key, status: "error",
          message: limpezaErr
            // A mensagem TEM que mudar quando a limpeza falha: o operador precisa
            // saber que ficou lixo, senao ele reimporta e duplica.
            ? `Items failed (${amigavel}) — and the empty order could NOT be removed: ${limpezaErr.message}. Delete order ${pedido.id} by hand before importing again.`
            : `Items failed, nothing was imported for this order: ${amigavel}`,
        });
      } else {
        res.push({ row: group.rows[0].rowNum, key, status: "ok", message: `Order created (${items.length} item${items.length !== 1 ? "s" : ""}, total R$ ${total.toFixed(2)})` });
        linhasOk += group.rows.length;
      }
    }

    // O toast de sucesso mora DENTRO do `try`. Fora dele, uma excecao mostrava o
    // vermelho "Import stopped" e, logo em seguida, um verde "Imported 0 orders"
    // — os dois na tela ao mesmo tempo. E o defeito que o `BulkUpdateOrders.tsx`
    // ja documenta ter consertado, e que eu repeti aqui.
    toast.success(`Imported ${res.filter((r) => r.status === "ok").length} orders`);

    } catch (e: any) {
      // Sem `catch`, uma excecao virava rejeicao nao tratada: nenhum toast, e o
      // admin sem ideia de que a importacao parou no meio.
      abortou = true;
      // `row: 0` e sentinela: o CSV e base-1, entao zero nunca aponta para uma
      // linha do arquivo. O tipo `Result` exige numero, por isso nao da para
      // usar travessao aqui como no resto da tela.
      res.push({ row: 0, key: "—", status: "error", message: `Import stopped: ${e?.message ?? String(e)}` });
      toast.error("Import stopped: " + (e?.message ?? String(e)));
    } finally {
      // `setResults` no `finally`, nao depois dele: numa excecao ele nunca
      // rodava e a tabela ficava VAZIA — o admin perdia justamente o registro de
      // quais linhas tinham passado antes da falha. E o mesmo conserto que o
      // `BulkUpdateOrders.tsx` ja documenta ter feito; eu o desfiz aqui sem
      // perceber ao mover a linha para fora.
      setResults(res);
      // `setImporting(false)` antes da liberacao: se ela lancar (rede caindo,
      // sessao expirando numa planilha longa), a tela nao pode ficar presa em
      // "Importing".
      setImporting(false);
      if (suprimiu) {
        try {
          const { error } = await supabase.rpc("set_suppress_stock_notify" as any, { _on: false, _minutos: 0 });
          if (error) console.error("[import-orders] release stock suppression failed:", error.message);
        } catch (e) {
          // Nao aborta. Mas NAO e "a janela expira sozinha": com `n` orfao, o
          // gatilho continua mudo ate `desde + 120 minutos` — quem destrava e a
          // expressao de leitura do gatilho (20260826090000), nao a auto-cura do
          // setter, que so roda na proxima chamada com `_on = true`.
          console.error("[import-orders] release stock suppression threw:", e);
        }
      }

      // O registro de auditoria tambem mora no `finally`, e conta o que
      // REALMENTE entrou. Antes usava `rows.length - errOrd`: uma planilha de
      // 200 linhas que abortasse no primeiro grupo gravava
      // `registros_sucesso: 199`, porque a linha-fantasma do `catch` conta como
      // UM erro. O registro que o dono usa para auditar importacao mentia por
      // 199 — e mentia so no caso em que ele mais precisaria dele.
      const okOrd = res.filter((r) => r.status === "ok").length;
      const errOrd = res.filter((r) => r.status === "error").length;
      // `skip` fica de fora dos dois: nao entrou nada e nao houve falha.
      const skipOrd = res.filter((r) => r.status === "skip").length;
      supabase.from("import_logs").insert({
        tipo: "orders", arquivo_nome: file.name,
        // `total = sucesso + erro` fecha por construcao: erro e o que sobra.
        // `errOrd` (numero de linhas do relatorio `res`) fica so para decidir o
        // status — ele conta ITENS DE RELATORIO, nao linhas de CSV, e misturar as
        // duas unidades foi o defeito das duas versoes anteriores.
        registros_total: rows.length,
        registros_erro: Math.max(0, rows.length - linhasOk - skipOrd),
        registros_sucesso: linhasOk,
        // `failed` SO quando nada entrou. Marcar `failed` com 30 pedidos vivos
        // no banco e perigoso de um jeito especifico: o dono le "falhou", roda de
        // novo, e duplica os 30. `partial` e a verdade e e o que faz ele conferir
        // antes de repetir.
        //
        // Desde 28/ago ha checagem por `po_number` antes de criar, entao a
        // reimportacao PULA o que ja entrou — mas so nas linhas que trazem PO.
        // Linha sem `po_number` continua duplicando, e por isso este `partial`
        // segue importando.
        status: (abortou && okOrd === 0) ? "failed" : errOrd === 0 ? "success" : "partial",
      } as any).then(() => {}, () => {});
    }
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
          {/* `importing` trava a AREA inteira, nao so o botao. Antes so o
              `<Button>` interno estava desabilitado: clicar na moldura ou soltar
              um segundo arquivo disparava um `handleFile` concorrente, e os dois
              `setResults` corriam entre si — o admin veria o resultado de uma
              importacao e nao da outra. */}
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
            <p><strong>Optional:</strong> status (default: submitted), po_number, delivery_date</p>
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
              {results.some((r) => r.status === "skip") && (
                <span className="text-muted-foreground">{results.filter((r) => r.status === "skip").length} already imported</span>
              )}
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
                  <TableCell>{
                    r.status === "ok" ? <CheckCircle className="h-4 w-4 text-green-400" />
                    : r.status === "skip" ? <SkipForward className="h-4 w-4 text-muted-foreground" />
                    : <XCircle className="h-4 w-4 text-destructive" />
                  }</TableCell>
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
