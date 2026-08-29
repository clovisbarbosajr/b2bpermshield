import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, History } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const EVENT_LABELS: Record<string, string> = {
  new_order: 'Novo pedido', order_status: 'Status do pedido', new_customer: 'Novo cliente',
  account_approved: 'Conta aprovada', low_stock: 'Estoque baixo', test: 'Teste',
};

type Log = { id: string; event: string; channel: string; recipient: string; status: string; error: string | null; created_at: string };

export default function NotificacoesLog() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  // Esta e a tela onde se confere o que foi ENVIADO. Descartando o `error`, uma
  // leitura que falha virava lista vazia e a tela afirmava "Nenhuma notificacao
  // enviada ainda" — a mentira mais cara possivel justamente aqui, depois dos
  // 1.508 SMS de 25/ago. Falha de leitura tem que aparecer como falha.
  const [erro, setErro] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErro(null);
    const { data, error } = await sb.from('notification_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { setErro(error.message); setLogs([]); }
    else setLogs((data as Log[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div><h1 className="text-2xl font-bold">Histórico de notificações</h1><p className="text-sm text-muted-foreground">Últimos 200 envios.</p></div>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : erro ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-semibold">Não consegui ler o histórico</p>
          <p className="text-muted-foreground">{erro}</p>
          <p className="text-muted-foreground mt-1">Isto NÃO quer dizer que nada foi enviado — quer dizer que a leitura falhou.</p>
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">Nenhuma notificação enviada ainda.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Quando</TableHead><TableHead>Evento</TableHead><TableHead>Canal</TableHead><TableHead>Destino</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-sm">{EVENT_LABELS[l.event] ?? l.event}</TableCell>
                  <TableCell className="text-sm capitalize">{l.channel}</TableCell>
                  <TableCell className="text-xs">{l.recipient}</TableCell>
                  <TableCell><Badge variant={l.status === 'sent' ? 'secondary' : 'destructive'} title={l.error ?? ''}>{l.status === 'sent' ? 'enviado' : 'falhou'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
