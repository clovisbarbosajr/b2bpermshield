import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCw } from "lucide-react";

type Log = {
  id: string;
  user_email: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  details: any;
  created_at: string;
};

const ACTION_COLORS: Record<string, string> = {
  created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  updated: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  deleted: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const ENTITY_LABELS: Record<string, string> = {
  product:    "Product",
  customer:   "Customer",
  order:      "Order",
  inventory:  "Inventory",
  production: "Production",
};

// Renderiza os `details` (jsonb) de forma legível. Ajuste de estoque tem formato
// dedicado (qty antes → depois); o resto cai no genérico "chave: valor".
const DetailsLine = ({ details }: { details: any }) => {
  if (!details || typeof details !== "object") return null;
  if (details.qty_before !== undefined && details.qty_after !== undefined) {
    const diff = Number(details.difference ?? details.qty_after - details.qty_before);
    return (
      <div className="text-xs text-muted-foreground mt-0.5">
        Qty <strong>{details.qty_before} → {details.qty_after}</strong> ({diff > 0 ? `+${diff}` : diff})
        {details.category ? <> · {details.category}</> : null}
        {details.reference ? <> · Ref {details.reference}</> : null}
        {details.memo ? <> · {details.memo}</> : null}
      </div>
    );
  }
  const pairs = Object.entries(details).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (pairs.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground mt-0.5">
      {pairs.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}
    </div>
  );
};

const PAGE_SIZE = 50;

const ActivityLogs = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  // Usuários que já aparecem nos logs — alimenta o dropdown "User" (filtro por usuário).
  const [users, setUsers] = useState<{ email: string; name: string | null }[]>([]);

  useEffect(() => {
    // Paginado: `.limit(2000)` NAO funcionava — o PostgREST corta em 1000
    // (db-max-rows) sem erro. O dropdown so enxergava os 1000 logs mais
    // recentes, entao quem parou de mexer no sistema sumia do filtro e as acoes
    // dele ficavam inauditaveis. Piorava sozinho conforme a tabela crescia.
    // `.order("id")` junto do created_at: a paginacao por OFFSET precisa de
    // ordem estavel, senao pula ou repete linha entre as paginas.
    const fetchUsers = async () => {
      // Caminho bom: RPC com DISTINCT no banco — devolve 1 linha por usuario.
      // Varrer a tabela inteira daqui so pra montar um dropdown seria pior que o
      // bug original: `activity_logs` so cresce, e a tela travaria abrindo
      // centenas de requests a cada montagem.
      const viaRpc = await (supabase as any).rpc("activity_log_users");
      if (!viaRpc.error && Array.isArray(viaRpc.data)) {
        setUsers(viaRpc.data
          .filter((r: any) => r?.user_email)
          .map((r: any) => ({ email: r.user_email, name: r.user_name ?? null }))
          .sort((a: any, b: any) => a.email.localeCompare(b.email)));
        return;
      }
      // Fallback enquanto o SQL da RPC nao tiver sido rodado: le os logs mais
      // RECENTES, com teto. Nao e a lista completa (usuario muito antigo pode
      // faltar), mas tem custo previsivel e nao trava a tela.
      const TETO_PAGINAS = 6;
      const seen = new Map<string, string | null>();
      for (let pagina = 0; pagina < TETO_PAGINAS; pagina++) {
        const { data, error } = await (supabase as any)
          .from("activity_logs")
          .select("user_email, user_name")
          .not("user_email", "is", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) throw error;
        const linhas = data ?? [];
        linhas.forEach((r: any) => { if (r.user_email && !seen.has(r.user_email)) seen.set(r.user_email, r.user_name); });
        if (linhas.length === 0) break;
      }
      setUsers([...seen.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.email.localeCompare(b.email)));
    };
    // Sem o catch, uma falha aqui deixava o dropdown vazio em silencio — parecia
    // "nenhum usuario registrou acao".
    fetchUsers().catch((e) => { console.error(e); toast.error("Could not load the user filter."); });
  }, []);

  const fetchLogs = async (p = 1) => {
    setLoading(true);
    const from = (p - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = (supabase as any)
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (filterAction) q = q.eq("action", filterAction);
    if (filterEntity) q = q.eq("entity_type", filterEntity);
    if (filterUser) q = q.eq("user_email", filterUser);
    // `created_at` e timestamptz e a tela EXIBE em hora local, mas um literal sem
    // offset e resolvido pelo fuso da SESSAO (UTC no Supabase). O filtro e a
    // coluna ficavam em fusos diferentes: com o admin em UTC-5, "To = hoje"
    // escondia tudo que aconteceu depois das 19h — numa trilha de auditoria,
    // parece que a acao nunca foi feita. `toISOString()` do proprio limite do dia
    // LOCAL resolve: o navegador converte para o instante UTC correspondente.
    const inicioLocal = (d: string) => new Date(`${d}T00:00:00`).toISOString();
    const fimLocal = (d: string) => new Date(`${d}T23:59:59.999`).toISOString(); // .999: inclui o segundo inteiro
    if (filterFrom) q = q.gte("created_at", inicioLocal(filterFrom));
    if (filterTo) q = q.lte("created_at", fimLocal(filterTo));

    const { data, count, error } = await q;
    if (error) {
      // Antes o `if (!error)` sem `else` deixava a tela com o resultado ANTIGO e
      // a contagem antiga — dado velho passando por atual numa auditoria.
      console.error(error);
      toast.error("Could not load the activity log. Try again.");
      setLoading(false);
      return;
    }
    setLogs(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { fetchLogs(page); }, [page]);

  const handleSearch = () => { setPage(1); fetchLogs(1); };

  const handleClearFilters = () => {
    setFilterAction("");
    setFilterEntity("");
    setFilterUser("");
    setFilterFrom("");
    setFilterTo("");
    setPage(1);
    setTimeout(() => fetchLogs(1), 0);
  };

  const setQuickRange = (days: number) => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - days);
    // `toISOString()` converte para UTC ANTES de cortar: as 20h em UTC-5 a data
    // ISO ja e amanha, e a janela inteira deslizava um dia.
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFilterFrom(fmt(fromDate));
    setFilterTo(fmt(toDate));
  };

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) +
      " " + dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Activity Logs</h2>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => fetchLogs(page)}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Action</Label>
            <Select value={filterAction} onValueChange={v => setFilterAction(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={filterEntity} onValueChange={v => setFilterEntity(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="product">Product</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="order">Order</SelectItem>
                <SelectItem value="inventory">Inventory</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">User</Label>
            <Select value={filterUser || "all"} onValueChange={v => setFilterUser(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.email} value={u.email}>{u.name ? `${u.name} — ${u.email}` : u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="mt-1 w-40"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="mt-1 w-40"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { setQuickRange(7); }}>Last 7 days</Button>
            <Button size="sm" variant="outline" onClick={() => { setQuickRange(30); }}>Last 30 days</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const now = new Date();
              setFilterFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
              setFilterTo(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
            }}>This month</Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSearch} className="gap-1">
            <Search className="h-4 w-4" /> Search
          </Button>
          <Button size="sm" variant="outline" onClick={handleClearFilters}>
            Clear
          </Button>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground mb-2">{total} record(s) found</p>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(log.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{log.user_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{log.user_email || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? ""}`}>
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{log.entity_name || "—"}</div>
                    <DetailsLine details={log.details} />
                    {log.entity_id && (
                      <div className="text-xs text-muted-foreground font-mono">{log.entity_id.slice(0, 8)}…</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </Card>
      )}
    </AdminLayout>
  );
};

export default ActivityLogs;
