import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  product:  "Product",
  customer: "Customer",
  order:    "Order",
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
    if (filterUser.trim()) q = q.ilike("user_email", `%${filterUser.trim()}%`);
    if (filterFrom) q = q.gte("created_at", `${filterFrom}T00:00:00`);
    if (filterTo) q = q.lte("created_at", `${filterTo}T23:59:59`);

    const { data, count, error } = await q;
    if (!error) {
      setLogs(data ?? []);
      setTotal(count ?? 0);
    }
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
    const fmt = (d: Date) => d.toISOString().split("T")[0];
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
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">User email</Label>
            <Input
              className="mt-1"
              value={filterUser}
              onChange={e => setFilterUser(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Filter by user..."
            />
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
              setFilterTo(now.toISOString().split("T")[0]);
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
