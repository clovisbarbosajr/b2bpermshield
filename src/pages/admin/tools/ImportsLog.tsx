import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

const ImportsLog = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
        .from("import_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (!error) {
        setLogs(data ?? []);
        setTotal(count ?? 0);
      }
      setLoading(false);
    };
    fetch();
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const fmtDate = (d: string) => new Date(d).toLocaleString("en-US");

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Imports Log</h2>
        <p className="mt-1 text-sm text-muted-foreground">History of all CSV import operations ({total} total).</p>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-sm text-muted-foreground px-2">Page {page} of {totalPages}</span>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No imports yet.
                  </TableCell>
                </TableRow>
              ) : logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</TableCell>
                  <TableCell className="text-sm capitalize">{log.tipo || log.type || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.arquivo || log.file_name || "—"}</TableCell>
                  <TableCell className="text-right">{log.registros || log.records || 0}</TableCell>
                  <TableCell className="text-right">{log.erros || log.errors || 0}</TableCell>
                  <TableCell>
                    <Badge variant={(log.status === "success" || log.status === "ok") ? "default" : "destructive"}>
                      {log.status || "unknown"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AdminLayout>
  );
};

export default ImportsLog;
