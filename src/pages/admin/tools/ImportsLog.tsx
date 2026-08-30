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
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
        .from("import_logs")
        .select("*", { count: "exact" })
        // Desempate unico: OFFSET sem ordem estavel repete/pula linha.
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);

      // Sem `else`, falha de leitura deixava `logs`/`total` INTACTOS. Duas
      // consequencias, as duas mentindo:
      //   1ª carga falha -> `total = 0` -> o cabecalho imprime "(0 total)" e o
      //   corpo "No imports yet.", indistinguivel de "nunca importaram nada" —
      //   numa tela de AUDITORIA, que e onde se confere o que entrou;
      //   falha ao PAGINAR -> `page` ja avancou (e o gatilho do efeito) e as
      //   linhas continuam as da pagina anterior: a pagina 1 rotulada "Page 2 of N".
      setErro(error ? error.message : null);
      if (error) { setLogs([]); setTotal(0); }
      else {
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
        <p className="mt-1 text-sm text-muted-foreground">History of all CSV import operations{erro ? "" : ` (${total} total)`}.</p>
      </div>

      {erro && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Could not load the imports log.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This does NOT mean nothing was imported — the log could not be read.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      )}

      {/* A barra sai junto com o erro: sem isto ela rotularia "Page 2 of N" sobre
          uma lista que nao e da pagina 2. */}
      {!erro && totalPages > 1 && (
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
              {erro ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Could not read the log — see the message above.
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No imports yet.
                  </TableCell>
                </TableRow>
              ) : logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</TableCell>
                  <TableCell className="text-sm capitalize">{log.tipo || log.type || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.arquivo_nome || "—"}</TableCell>
                  <TableCell className="text-right">{log.registros_total || 0}</TableCell>
                  <TableCell className="text-right">{log.registros_erro || 0}</TableCell>
                  <TableCell>
                    {/* "partial" e um resultado LEGITIMO (algumas linhas
                      * entraram, outras nao) e pintava de VERMELHO junto com as
                      * falhas totais. Os importadores gravam "success" ou
                      * "partial"; so falha de verdade merece vermelho. */}
                    <Badge variant={
                      (log.status === "success" || log.status === "ok") ? "default"
                        : log.status === "partial" ? "secondary"
                        : "destructive"
                    }>
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
