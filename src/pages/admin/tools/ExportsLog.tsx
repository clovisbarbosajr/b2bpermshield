import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const ExportsLog = () => {
  const [exports, setExports] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("exports");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const [e, i] = await Promise.all([
        supabase.from("export_logs").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      // Os dois `error` eram descartados: qualquer falha pintava "No exports yet." /
      // "No imports yet." — indistinguivel de "nunca exportaram nada", numa tela de
      // AUDITORIA. Era a unica tela do lote sem nenhum tratamento de erro.
      setErro(e.error || i.error ? (e.error ?? i.error)!.message : null);
      setExports(e.error ? [] : (e.data ?? []));
      setImports(i.error ? [] : (i.data ?? []));
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
      {erro && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Could not load the logs.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This does NOT mean nothing was exported or imported — the log could not be read.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          {/* "List" nao dizia de que. E o `bg-primary` na aba de imports era um
              realce HARDCODED: a classe-base do TabsTrigger e
              `data-[state=active]:bg-background`, que tem especificidade MAIOR —
              entao o primary so vencia com a aba DESLIGADA. O realce apontava para
              a aba errada. */}
          <TabsTrigger value="exports">Exports</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
        </TabsList>

        <TabsContent value="exports">
          {/* O SELECT SAIU, e com ele o corte silencioso. Ele nao era "tamanho de
              pagina": nao ha paginacao nesta tela. Alimentava `slice(0, pageSize)`
              sobre linhas ja cortadas em `limit(100)`, entao com o padrao 25 as
              linhas 26 a 100 ficavam invisiveis, nas DUAS abas, sem nenhum controle
              para chegar nelas — e o seletor so aparecia numa delas. Ocultacao de
              dado numa tela de auditoria. Mostrar as 100 e dizer que sao 100 e
              menos codigo e mais verdade. Quem precisa de historico completo tem
              `Imports Log`, que pagina de verdade. */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  {/* Era "Started at" / "Ended at" e as DUAS mostravam
                    * `created_at` — a mesma data duas vezes, como se o export
                    * tivesse durado zero. `export_logs` nao tem hora de termino;
                    * tem `registros`, que era o dado util e nao aparecia. */}
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {erro ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Could not read the log — see the message above.</TableCell></TableRow>
                ) : exports.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No exports yet.</TableCell></TableRow>
                ) : exports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.tipo}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell className="text-right">{r.registros ?? 0}</TableCell>
                    <TableCell><Badge variant={r.status === "concluido" || r.status === "Finished" ? "default" : "secondary"}>{r.status ?? "Finished"}</Badge></TableCell>
                    {/* COLUNA "Download" REMOVIDA. `arquivo_url` nunca e populada: o
                        unico gravador de `export_logs` (`ProductExport.tsx:193`) nao
                        manda a coluna, e o export e blob no navegador — nao existe
                        arquivo guardado para a URL apontar. Era um botao que, por
                        construcao, mostrava "—" em 100% das linhas.

                        Persistir o export no Storage (com link reutilizavel e
                        retencao) e decisao do dono, e esta na batelada. */}
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
                {erro ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Could not read the log — see the message above.</TableCell></TableRow>
                ) : imports.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No imports yet.</TableCell></TableRow>
                ) : imports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.tipo}</TableCell>
                    <TableCell>{r.arquivo_nome ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>{r.registros_total ?? 0} ({r.registros_sucesso ?? 0} ok / {r.registros_erro ?? 0} err)</TableCell>
                    <TableCell>{/* `"concluido"` e o valor do EXPORT. Os seis importadores gravam
                        `success`/`partial`/`failed`, entao esta comparacao era falsa em
                        100% das linhas reais — inclusive para `failed`, que saia cinza.
                        A cor tinha deixado de significar qualquer coisa. `ImportsLog`
                        ja tratava os tres certo, sobre a MESMA tabela. */}
                    <Badge variant={r.status === "success" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status ?? "pending"}</Badge></TableCell>
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
