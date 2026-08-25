import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Download } from "lucide-react";
import { toast } from "sonner";
import { ORDER_STATUSES, statusLabel, statusBadge as statusBadgeClass } from "@/lib/orderStatuses";
import { formatOpcao } from "@/lib/variants";

const STATUS_OPTIONS = [{ value: "", label: "Please select..." }, ...ORDER_STATUSES];

const statusBadge = (status: string) => (
  <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${statusBadgeClass(status)}`}>
    {statusLabel(status).toUpperCase()}
  </span>
);

const PAGE_SIZE = 10;
// Teto do PostgREST (`db-max-rows`) no Supabase. Serve pra saber se o export
// veio truncado e avisar o cliente.
const EXPORT_CAP = 1000;

const Pedidos = () => {
  const { user, impersonatedCustomer } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [reordering, setReordering] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reference, setReference] = useState("");
  const [applied, setApplied] = useState({ fromDate: "", toDate: "", status: "", reference: "" });

  const fmtDate = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  };
  const fmtDateShort = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  // Load cliente ID once
  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;
      const q = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id").eq("user_id", user!.id).maybeSingle();
      const { data } = await q;
      setClienteId(data?.id ?? null);
    };
    fetch();
  }, [user, impersonatedCustomer]);

  // Load orders
  useEffect(() => {
    if (!clienteId) { setLoading(false); return; }
    const fetchOrders = async () => {
      setLoading(true);
      let q = supabase.from("pedidos").select("*", { count: "exact" })
        .eq("cliente_id", clienteId)
        // Desempate unico: OFFSET sem ordem estavel repete/pula linha entre
        // paginas — o cliente veria o mesmo pedido duas vezes, ou nenhuma.
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      // `created_at` e timestamptz e a tela exibe em hora LOCAL; literal sem
      // offset e resolvido no fuso da sessao (UTC). Converter o limite do dia
      // local para ISO alinha filtro e exibicao — senao o cliente filtra "ate
      // hoje" e nao ve o pedido que acabou de fazer.
      if (applied.fromDate) q = q.gte("created_at", new Date(`${applied.fromDate}T00:00:00`).toISOString());
      if (applied.toDate) q = q.lte("created_at", new Date(`${applied.toDate}T23:59:59.999`).toISOString());
      if (applied.status && applied.status !== "_all") q = q.eq("status", applied.status as any);
      if (applied.reference) q = q.ilike("po_number", `%${applied.reference}%`);

      const { data, count } = await q;
      setPedidos(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    };
    fetchOrders();
  }, [clienteId, page, applied]);

  const handleSearch = () => {
    setPage(1);
    setApplied({ fromDate, toDate, status: statusFilter, reference });
  };

  const handleClear = () => {
    setFromDate(""); setToDate(""); setStatusFilter(""); setReference("");
    setPage(1);
    setApplied({ fromDate: "", toDate: "", status: "", reference: "" });
  };

  const handleReorder = async (pedidoId: string) => {
    setReordering(pedidoId);
    const { data: itens } = await supabase.from("pedido_itens").select("*").eq("pedido_id", pedidoId);
    if (!itens || itens.length === 0) { toast.error("No items found"); setReordering(null); return; }
    const productIds = itens.map((i: any) => i.produto_id);
    // A variante agora tem coluna própria (`pedido_itens.variante_id`). Sem isso o
    // re-order remontava o item só com `produto_id` e o cliente repetia o pedido
    // recebendo o produto errado (o tamanho/cor só existia no texto do nome).
    const variantIds = itens.map((i: any) => i.variante_id).filter(Boolean) as string[];

    // TUDO em lotes de 100 e com o erro CHECADO.
    //
    // Antes: `.in("id", productIds)` sem lote (mesmo problema de URL que motivou
    // o lote no catalogo), `{ data: prods }` sem `error` (falha ali esvaziava o
    // mapa, todo item caia no `continue`, e a funcao retornava sem toast), e a
    // checagem de variante cortada em 100 — ou seja, protegia so os 100
    // primeiros produtos e deixava o resto exatamente como estava. Buraco que eu
    // mesmo abri na rodada anterior.
    const emLotes = async <T,>(ids: string[], f: (lote: string[]) => any): Promise<T[] | null> => {
      const out: T[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await f(ids.slice(i, i + 100));
        if (error) { console.error(error); return null; }
        out.push(...((data ?? []) as T[]));
      }
      return out;
    };

    const prods = await emLotes<any>(productIds as string[], (lote) => supabase.from("produtos")
      .select("id, preco, estoque_total, estoque_reservado, quantidade_minima, unidade_venda, imagem_url")
      .in("id", lote));
    const vars = variantIds.length
      ? await emLotes<any>(variantIds, (lote) => supabase.from("produto_variantes")
          .select("id, produto_id, codigo, quantidade, imagem_url, valores_opcao, ativo").in("id", lote))
      : [];
    if (prods === null || vars === null) {
      toast.error("Could not load the products. Please try again.");
      setReordering(null);
      return;
    }
    const prodMap = new Map((prods ?? []).map((p: any) => [p.id, p]));
    const varMap = new Map((vars ?? []).map((v: any) => [v.id, v]));

    // Quais destes produtos TEM variante hoje. Pedido importado do B2BWave nao
    // guarda `variante_id`, entao sem esta consulta o "buy again" mandaria o
    // produto-pai (sem tamanho/cor, com o preco do pai) sem nenhum aviso.
    const idsProd = [...prodMap.keys()] as string[];
    const todasVariantes = await emLotes<any>(idsProd, (lote) => supabase
      .from("produto_variantes").select("produto_id").eq("ativo", true).in("produto_id", lote));
    // Falha aqui NAO pode virar "nenhum tem variante" — seria o pedido errado
    // outra vez. Aborta o re-order e avisa (e libera o botao).
    if (todasVariantes === null) {
      toast.error("Could not check product options. Please try again.");
      setReordering(null);
      return;
    }
    const produtosComVariante = new Set<string>(todasVariantes.map((r: any) => r.produto_id));
    let added = 0;
    const perdidos: string[] = [];
    // `as any`: `variante_id` foi adicionada em 20260802130000 e os types gerados
    // do Supabase (src/integrations/supabase/types.ts) ainda não foram regerados
    // contra o schema novo. Sem o cast, o tsc reclama de coluna inexistente.
    for (const item of (itens as any[])) {
      const prod = prodMap.get(item.produto_id);
      if (!prod) continue;
      const v = item.variante_id ? varMap.get(item.variante_id) : null;
      // Variante apagada ou desativada desde o pedido original: não dá pra repetir
      // essa linha (adicionar sem variante mandaria o produto errado de novo).
      if (item.variante_id && (!v || v.ativo === false)) { perdidos.push(item.nome_produto); continue; }
      // Pedido IMPORTADO do B2BWave nao tem `variante_id` (o sync nunca grava).
      // Se o produto tem variante hoje, repetir a linha "sem variante" manda o
      // produto-pai, com o preco do pai — o mesmo pedido errado que a guarda
      // acima existe para evitar, pela outra ponta.
      if (!item.variante_id && (produtosComVariante?.has(item.produto_id) ?? false)) {
        perdidos.push(item.nome_produto); continue;
      }
      const dispProduto = (prod.estoque_total ?? 0) - (prod.estoque_reservado ?? 0);
      const disponivel = v ? Math.min(dispProduto, v.quantidade ?? 0) : dispProduto;
      addItem({
        produto_id: item.produto_id,
        variante_id: item.variante_id ?? null,
        variante_label: v ? formatOpcao(v.valores_opcao) || v.codigo : null,
        nome: item.nome_produto,
        sku: v?.codigo || item.sku || "",
        preco: prod.preco ?? item.preco_unitario,
        quantidade: Math.min(item.quantidade, Math.max(disponivel, prod.quantidade_minima ?? 1)),
        unidade_venda: prod.unidade_venda ?? "UN",
        quantidade_minima: prod.quantidade_minima ?? 1,
        estoque_disponivel: disponivel, // estoque REAL (antes inflava p/ 99 e furava a validação)
        imagem_url: v?.imagem_url || prod.imagem_url || null,
      });
      added++;
    }
    if (added > 0) toast.success(`${added} item(s) added to cart`);
    if (perdidos.length) {
      toast.error(`Not re-ordered (option no longer available): ${[...new Set(perdidos)].join(", ")}`);
    }
    if (added === 0) { setReordering(null); return; }
    navigate("/portal/carrinho");
    setReordering(null);
  };

  // Campo CSV com aspas: sem isso, um po_number/status com vírgula quebrava as colunas.
  const csvCell = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleExport = async () => {
    if (!clienteId || exporting) return;
    setExporting(true);
    try {
      // Antes exportava só a página atual (.range) — o botão diz "Export" e o
      // cliente achava que tinha baixado o histórico inteiro. Agora traz TODOS
      // os pedidos que casam com os filtros aplicados.
      let q = supabase.from("pedidos")
        .select("numero, created_at, delivery_date, total, quantidade_total, status")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });

      if (applied.fromDate) q = q.gte("created_at", applied.fromDate);
      if (applied.toDate) q = q.lte("created_at", applied.toDate + "T23:59:59");
      if (applied.status && applied.status !== "_all") q = q.eq("status", applied.status as any);
      if (applied.reference) q = q.ilike("po_number", `%${applied.reference}%`);

      const { data, error } = await q;
      if (error) { toast.error("Export failed"); return; }
      const linhas = data ?? [];
      if (linhas.length === 0) { toast.error("Nothing to export"); return; }

      const rows = [
        ["ID", "Date", "Delivery Date", "Total", "Quantity", "Status"],
        ...linhas.map((p: any) => [
          p.numero, fmtDate(p.created_at), fmtDateShort(p.delivery_date ?? ""),
          Number(p.total).toFixed(2), p.quantidade_total ?? "", statusLabel(p.status),
        ]),
      ];
      const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "order-history.csv";
      a.click();
      // Revogar na hora cancelava o download em alguns navegadores (o blob morria
      // antes de a gravação começar).
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      // PostgREST corta em `db-max-rows` (1000 no Supabase). Se vier exatamente no
      // limite, o arquivo pode estar incompleto — avisa em vez de fingir que veio tudo.
      if (linhas.length >= EXPORT_CAP) {
        toast.warning(`Exported the ${linhas.length} most recent orders (limit). Narrow the date range to get the rest.`);
      } else {
        toast.success(`${linhas.length} order(s) exported`);
      }
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1, 2, 3, 4, 5, 6, 7);
      if (totalPages > 8) pages.push("...", totalPages - 1, totalPages);
    }
    return pages;
  };

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground border-b pb-3">
        <button onClick={() => navigate("/portal")} className="hover:text-primary">Home</button>
        <span>|</span>
        <span className="text-foreground font-medium">Order history</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Order History</h2>
        <Button variant="outline" size="sm" className="gap-1" onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4" /> {exporting ? "EXPORTING..." : "EXPORT"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-card rounded-lg border">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">From Date</p>
          <Input type="date" className="h-8 w-36 text-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">To Date</p>
          <Input type="date" className="h-8 w-36 text-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Status</p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="Please select..." /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value || "_all"}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Reference</p>
          <Input className="h-8 w-32 text-sm" placeholder="#" value={reference} onChange={e => setReference(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()} />
        </div>
        <button onClick={handleClear} className="text-sm text-muted-foreground hover:text-foreground underline">CLEAR</button>
        <Button size="sm" onClick={handleSearch}>SEARCH</Button>
      </div>

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">‹</button>
          {pageNumbers().map((n, i) =>
            n === "..." ? (
              <span key={i} className="px-2 py-1 text-sm text-muted-foreground">...</span>
            ) : (
              <button
                key={i}
                onClick={() => setPage(Number(n))}
                className={`px-2.5 py-1 text-sm rounded ${page === n ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >{n}</button>
            )
          )}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">›</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center py-16">
          <ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No orders found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                {["ID", "DATE", "DELIVERY DATE", "TOTAL", "QUANTITY", "STATUS", "LAST UPDATE", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pedidos.map(p => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{p.numero}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(p.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDateShort(p.delivery_date ?? "")}</td>
                  <td className="px-4 py-3 font-medium">${Number(p.total).toFixed(2)}</td>
                  <td className="px-4 py-3">{p.quantidade_total ?? "-"}</td>
                  <td className="px-4 py-3">{statusBadge(p.status)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(p.updated_at ?? p.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/portal/pedidos/${p.id}`)}>
                        VIEW
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                        disabled={reordering === p.id}
                        onClick={() => handleReorder(p.id)}
                      >
                        {reordering === p.id ? "..." : "RE-ORDER"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 mt-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">‹</button>
          {pageNumbers().map((n, i) =>
            n === "..." ? (
              <span key={i} className="px-2 py-1 text-sm text-muted-foreground">...</span>
            ) : (
              <button
                key={i}
                onClick={() => setPage(Number(n))}
                className={`px-2.5 py-1 text-sm rounded ${page === n ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >{n}</button>
            )
          )}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-2 py-1 text-sm rounded hover:bg-muted">›</button>
        </div>
      )}
    </PortalLayout>
  );
};

export default Pedidos;
