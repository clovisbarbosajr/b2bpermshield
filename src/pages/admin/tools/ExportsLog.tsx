import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";

const ExportsLog = () => {
  const [exports, setExports] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("exports");
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const fetchAll = async () => {
      const [e, i] = await Promise.all([
        supabase.from("export_logs").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      setExports(e.data ?? []);
      setImports(i.data ?? []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  if (loading) return <AdminLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="exports">List</TabsTrigger>
          <TabsTrigger value="imports" className="bg-primary text-primary-foreground">Imports</TabsTrigger>
        </TabsList>

        <TabsContent value="exports">
          <div className="flex items-center gap-2 mb-3">
            <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Started at</TableHead>
                  <TableHead>Ended at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No exports yet.</TableCell></TableRow>
                ) : exports.slice(0, pageSize).map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.tipo}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell><Badge variant={r.status === "concluido" || r.status === "Finished" ? "default" : "secondary"}>{r.status ?? "Finished"}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.arquivo_url && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={r.arquivo_url} download><Download className="h-4 w-4 mr-1" /> Download</a>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4 mr-1" /> Download
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="imports">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No imports yet.</TableCell></TableRow>
                ) : imports.slice(0, pageSize).map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.tipo}</TableCell>
                    <TableCell>{r.arquivo_nome ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>{r.registros_total ?? 0} ({r.registros_sucesso ?? 0} ok / {r.registros_erro ?? 0} err)</TableCell>
                    <TableCell><Badge variant={r.status === "concluido" ? "default" : "secondary"}>{r.status ?? "pending"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default ExportsLog;
