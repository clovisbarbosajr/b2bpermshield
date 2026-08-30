import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, History } from 'lucide-react';
import { classificaLog, CANAL_SEM_ENVIO, type ClasseLog } from '@/lib/classificaLog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const EVENT_LABELS: Record<string, string> = {
  new_order: 'Novo pedido', order_status: 'Status do pedido', new_customer: 'Novo cliente',
  account_approved: 'Conta aprovada', low_stock: 'Estoque baixo', test: 'Teste',
};

const CLASSE_UI: Record<ClasseLog, { texto: string; variant: 'secondary' | 'destructive' | 'outline' }> = {
  enviado: { texto: 'enviado', variant: 'secondary' },
  // Recusa DELIBERADA (canal desligado, teto, cliente sem telefone) não é
  // avaria: é o sistema obedecendo. Vermelho aqui fazia a tela sinalizar uma
  // pane de notificação em massa que não existe.
  recusado: { texto: 'recusado', variant: 'outline' },
  sistema: { texto: 'sistema', variant: 'outline' },
  falhou: { texto: 'falhou', variant: 'destructive' },
};

type Log = { id: string; event: string; channel: string; recipient: string; status: string; error: string | null; created_at: string };

export default function NotificacoesLog() {
  const [envios, setEnvios] = useState<Log[]>([]);
  const [sistema, setSistema] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  // Esta e a tela onde se confere o que foi ENVIADO. Descartando o `error`, uma
  // leitura que falha virava lista vazia e a tela afirmava "Nenhuma notificacao
  // enviada ainda" — a mentira mais cara possivel justamente aqui, depois dos
  // 1.508 SMS de 25/ago. Falha de leitura tem que aparecer como falha.
  const [erro, setErro] = useState<string | null>(null);
  // Guarda de ordem. Ha um botao "Atualizar": dois cliques com rede lenta faziam
  // a resposta ATRASADA sobrescrever a mais nova. O caso caro nao e trocar 200
  // linhas por 200 quase iguais — e a leitura velha BEM-SUCEDIDA chegando depois
  // de uma que falhou e apagando o banner de erro, exatamente a mentira que o
  // comentario acima diz que esta tela existe para impedir.
  const cargaSeq = useRef(0);

  async function load() {
    const minha = ++cargaSeq.current;
    setLoading(true);
    setErro(null);
    // DOIS baldes, e nao um `.limit(200)` cego. O `notification_log` e usado
    // tambem como barramento de auditoria do `b2bwave-sync` e das travas SQL,
    // que gravam `channel = '-'` — linhas que nunca foram tentativa de entrega.
    // Numa janela unica, uma limpeza de pedidos fantasma (uma linha por pedido,
    // `b2bwave-sync/index.ts:3106`) enchia as 200 posicoes sozinha e NENHUM
    // envio real aparecia, sob um cabecalho dizendo "Ultimos 200 envios".
    const [entregas, diagnostico] = await Promise.all([
      sb.from('notification_log').select('*').neq('channel', CANAL_SEM_ENVIO)
        .order('created_at', { ascending: false }).limit(200),
      sb.from('notification_log').select('*').eq('channel', CANAL_SEM_ENVIO)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (minha !== cargaSeq.current) return;
    const falha = entregas.error ?? diagnostico.error;
    if (falha) { setErro(falha.message); setEnvios([]); setSistema([]); }
    else {
      setEnvios((entregas.data as Log[]) ?? []);
      setSistema((diagnostico.data as Log[]) ?? []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const linhas = (ls: Log[]) => ls.map((l) => {
    const ui = CLASSE_UI[classificaLog(l)];
    return (
      <TableRow key={l.id}>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString('pt-BR')}</TableCell>
        <TableCell className="text-sm">{EVENT_LABELS[l.event] ?? l.event}</TableCell>
        <TableCell className="text-sm capitalize">{l.channel}</TableCell>
        <TableCell className="text-xs">{l.recipient}</TableCell>
        <TableCell><Badge variant={ui.variant} title={l.error ?? ''}>{ui.texto}</Badge></TableCell>
        {/* O motivo era so `title=` — tooltip de hover, que nao existe em toque
            e nao aparece em varredura visual. Quem le a tela precisa do motivo
            na tela, senao a conclusao errada ja foi tirada. */}
        <TableCell className="text-xs text-muted-foreground max-w-xs break-words">{l.error ?? ''}</TableCell>
      </TableRow>
    );
  });

  const cabecalho = (
    <TableHeader><TableRow>
      <TableHead>Quando</TableHead><TableHead>Evento</TableHead><TableHead>Canal</TableHead>
      <TableHead>Destino</TableHead><TableHead>Status</TableHead><TableHead>Motivo</TableHead>
    </TableRow></TableHeader>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Histórico de notificações</h1>
            <p className="text-sm text-muted-foreground">Últimas 200 tentativas de entrega. <strong>Recusado</strong> é o sistema obedecendo (canal desligado, teto por hora, cliente sem telefone) — não é avaria.</p>
          </div>
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
      ) : (
        <>
          {envios.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">Nenhuma tentativa de entrega registrada ainda.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>{cabecalho}<TableBody>{linhas(envios)}</TableBody></Table>
            </div>
          )}
          {sistema.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold mb-1">Registros do sistema</h2>
              {/* A legenda dizia "não são notificação: nunca houve canal nem
                  destinatário". Metade é falsa: recusa de CONFIGURAÇÃO do próprio
                  dispatch (evento desligado, sem canal marcado, sem destinatário
                  ativo) também é gravada com canal `-` e cai aqui. "O evento está
                  desligado e ninguém foi avisado" não é ruído de sync. */}
              <p className="text-xs text-muted-foreground mb-3">Travas SQL, diagnóstico do sync do B2BWave e recusas de configuração (evento desligado, sem canal marcado, sem destinatário ativo). Nenhuma chegou a ser tentativa de entrega — mas as de configuração explicam por que um aviso esperado não saiu. Últimos {sistema.length}.</p>
              <div className="rounded-lg border border-border overflow-x-auto">
                <Table>{cabecalho}<TableBody>{linhas(sistema)}</TableBody></Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
