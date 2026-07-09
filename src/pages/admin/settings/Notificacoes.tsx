import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { toast } from 'sonner';
import { Mail, MessageSquare, Phone, Loader2, Save, Send, Trash2, Plus, Bell, Pencil, X } from 'lucide-react';

// Tabelas novas (ainda não nos types gerados) -> client sem tipo aqui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const CHANNELS = [
  { id: 'email', label: 'Email', icon: Mail, provider: 'Resend', placeholder: 'INWISE <noreply@inwisepro.com>', field: 'from' },
  { id: 'sms', label: 'SMS', icon: MessageSquare, provider: 'Twilio', placeholder: '', field: 'from_number' },
  { id: 'whatsapp', label: 'WhatsApp', icon: Phone, provider: 'Twilio', placeholder: '', field: 'from_number' },
] as const;

const EVENT_LABELS: Record<string, string> = {
  new_order: 'New order',
  order_status: 'Order status change',
  new_customer: 'New customer / registration',
  account_approved: 'Customer account approved',
  low_stock: 'Low stock',
};

type Channel = { id: string; enabled: boolean; config: any };
type EventRow = {
  id: string; enabled: boolean; channels: string[]; notify_admin: boolean;
  notify_customer: boolean; template_email: string; template_sms: string;
  template_whatsapp: string; extra: any;
};
type Recipient = {
  id: string; label: string; email: string | null; phone: string | null;
  whatsapp: string | null; active: boolean;
};

// Emojis comuns pra inserir nos templates (barra de atalho).
const EMOJIS = ['✅', '✔️', '🎉', '📦', '🚚', '🛒', '💰', '⚠️', '❌', '👍', '📩', '⭐', '🔔', '⏳'];

export default function Notificacoes() {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('notif_test_to') || '{}'); } catch { return {}; }
  });
  const setTest = (channel: string, val: string) =>
    setTestTo((prev) => {
      const next = { ...prev, [channel]: val };
      localStorage.setItem('notif_test_to', JSON.stringify(next));
      return next;
    });
  const [testRecipient, setTestRecipient] = useState<string>(() => localStorage.getItem('notif_test_email') || '');
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const toggleEdit = (id: string, on: boolean) =>
    setEditing((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  // Insere um emoji no template de e-mail do evento, na posição do cursor.
  const tplRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const insertEmoji = (evId: string, emoji: string) => {
    const ta = tplRefs.current[evId];
    const cur = events.find((e) => e.id === evId)?.template_email ?? '';
    const pos = ta ? (ta.selectionStart ?? cur.length) : cur.length;
    const next = cur.slice(0, pos) + emoji + cur.slice(pos);
    setEvents(events.map((x) => (x.id === evId ? { ...x, template_email: next } : x)));
    // Recoloca o cursor após o emoji.
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + emoji.length; } });
  };

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [c, e, r] = await Promise.all([
      sb.from('notification_channels').select('*').order('id'),
      sb.from('notification_events').select('*').order('id'),
      sb.from('notification_recipients').select('*').order('created_at'),
    ]);
    setChannels((c.data as Channel[]) ?? []);
    setEvents((e.data as EventRow[]) ?? []);
    setRecipients((r.data as Recipient[]) ?? []);
    setLoading(false);
  }

  // MASTER SWITCH: liga/desliga o canal e PERSISTE na hora. O toggle de EMAIL também
  // controla os emails de pedido do send-email (flags configuracoes.email_on_*), pra
  // que desligar Email aqui pare TODO email — não só o notify-dispatch. Assim o
  // on/off é 100% pela interface, sem depender de deploy.
  async function toggleChannel(ch: Channel, enabled: boolean) {
    setChannels(channels.map((c) => (c.id === ch.id ? { ...c, enabled } : c)));
    const ops: Promise<any>[] = [
      sb.from('notification_channels').update({ enabled }).eq('id', ch.id),
    ];
    if (ch.id === 'email') {
      ops.push(sb.from('configuracoes').update({
        email_on_new_order: enabled,
        email_on_order_status: enabled,
        email_on_new_registration: enabled,
        email_on_approval: enabled,
        email_on_rejection: enabled,
      }).not('id', 'is', null));
    }
    const results = await Promise.all(ops);
    const err = results.find((r: any) => r?.error)?.error;
    const name = ch.id === 'email' ? 'Email' : ch.id.toUpperCase();
    toast[err ? 'error' : 'success'](err ? err.message : `${name} ${enabled ? 'enabled' : 'disabled'}`);
  }

  async function saveChannel(ch: Channel) {
    setSaving(true);
    const { error } = await sb.from('notification_channels')
      .update({ enabled: ch.enabled, config: ch.config }).eq('id', ch.id);
    setSaving(false);
    toast[error ? 'error' : 'success'](error ? error.message : `${ch.id} channel saved`);
  }

  async function sendTest(ch: Channel) {
    const channelId = ch.id;
    const to = (testTo[channelId] ?? '').trim();
    if (!to) { toast.error('Enter a test destination first.'); return; }
    if (channelId === 'email' && !to.includes('@')) { toast.error('Invalid email destination.'); return; }
    if (channelId !== 'email') {
      if (!isCompletePhone(to)) { toast.error('Incomplete destination number.'); return; }
      const from = ch.config?.from_number ?? '';
      if (from && from.replace(/\D/g, '') === to.replace(/\D/g, '')) {
        toast.error('The test destination cannot be the same as the sending number.'); return;
      }
    }
    const { data, error } = await sb.functions.invoke('notify-dispatch', {
      body: { event: 'new_order', test: { channel: channelId, to, message: 'Test notification ✅' } },
    });
    if (error || data?.error || data?.ok === false) {
      toast.error(`Failed: ${data?.error || error?.message || 'unknown error'}`);
    } else { toast.success('Test sent'); }
  }

  // Testa o template de e-mail de um evento, enviando pelo Resend (notify-dispatch).
  async function sendEventTest(ev: EventRow) {
    const to = testRecipient.trim();
    if (!to || !to.includes('@')) { toast.error('Enter a valid destination email.'); return; }
    const { data, error } = await sb.functions.invoke('notify-dispatch', {
      body: { event: ev.id, test: { channel: 'email', to, message: ev.template_email || `Test of event ${EVENT_LABELS[ev.id] ?? ev.id}` } },
    });
    if (error || data?.error || data?.ok === false) {
      toast.error(`Failed: ${data?.error || error?.message || 'unknown error'}`);
    } else { toast.success(`Test of "${EVENT_LABELS[ev.id] ?? ev.id}" sent to ${to}`); }
  }

  async function saveEvent(ev: EventRow) {
    setSaving(true);
    const { error } = await sb.from('notification_events').update({
      enabled: ev.enabled, channels: ev.channels, notify_admin: ev.notify_admin,
      notify_customer: ev.notify_customer, template_email: ev.template_email,
      template_sms: ev.template_sms, template_whatsapp: ev.template_whatsapp, extra: ev.extra,
    }).eq('id', ev.id);
    setSaving(false);
    toast[error ? 'error' : 'success'](error ? error.message : `Event "${EVENT_LABELS[ev.id]}" saved`);
  }

  async function addRecipient() {
    const { data, error } = await sb.from('notification_recipients')
      .insert({ label: 'New recipient', active: true }).select().single();
    if (error) return toast.error(error.message);
    setRecipients([...recipients, data as Recipient]);
  }
  async function saveRecipient(r: Recipient) {
    setSaving(true);
    const { error } = await sb.from('notification_recipients').update({
      label: r.label, email: r.email, phone: r.phone, whatsapp: r.whatsapp, active: r.active,
    }).eq('id', r.id);
    setSaving(false);
    toast[error ? 'error' : 'success'](error ? error.message : 'Recipient saved');
  }
  async function deleteRecipient(id: string) {
    const { error } = await sb.from('notification_recipients').delete().eq('id', id);
    if (error) return toast.error(error.message);
    setRecipients(recipients.filter((x) => x.id !== id));
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">Configure channels, events, and recipients.</p>
        </div>
      </div>

      <Tabs defaultValue="channels">
        <TabsList className="mb-4">
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="recipients">Recipients</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
        </TabsList>

        {/* CHANNELS */}
        <TabsContent value="channels" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The toggle is a master switch: turning a channel <strong>off</strong> pauses ALL sending on
            that channel (order emails, notifications, alerts) and is saved immediately. Turn it back on
            here when ready.
          </p>
          {CHANNELS.map((meta) => {
            const ch = channels.find((c) => c.id === meta.id);
            if (!ch) return null;
            const Icon = meta.icon;
            return (
              <Card key={meta.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        {meta.label}
                        <Badge variant={ch.enabled ? 'default' : 'secondary'} className={ch.enabled ? 'bg-green-600 hover:bg-green-600' : ''}>
                          {ch.enabled ? 'ON' : 'OFF'}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">via {meta.provider}</p>
                    </div>
                  </div>
                  <Switch checked={ch.enabled} onCheckedChange={(v) => toggleChannel(ch, v)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">{meta.field === 'from' ? 'Sender' : 'From number'}</Label>
                  {!editing.has(ch.id) ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                      <span className="text-sm truncate">{ch.config?.[meta.field] || <span className="text-muted-foreground italic">not set</span>}</span>
                      <Button size="sm" variant="ghost" className="gap-1.5 shrink-0" onClick={() => toggleEdit(ch.id, true)}>
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Button>
                    </div>
                  ) : (
                    <>
                      {meta.field === 'from' ? (
                        <Input value={ch.config?.[meta.field] ?? ''} placeholder={meta.placeholder}
                          onChange={(e) => setChannels(channels.map((c) => c.id === ch.id ? { ...c, config: { ...c.config, [meta.field]: e.target.value } } : c))} />
                      ) : (
                        <PhoneInput value={ch.config?.from_number ?? ''}
                          onChange={(v) => setChannels(channels.map((c) => c.id === ch.id ? { ...c, config: { ...c.config, from_number: v } } : c))} />
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" disabled={saving} className="gap-1.5" onClick={async () => { await saveChannel(ch); toggleEdit(ch.id, false); }}>
                          <Save className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { toggleEdit(ch.id, false); load(); }}>
                          <X className="w-3.5 h-3.5" /> Cancel
                        </Button>
                      </div>
                    </>
                  )}
                  <div className="pt-3 mt-2 border-t border-border space-y-2">
                    <Label className="text-xs">Test destination</Label>
                    {meta.id === 'email' ? (
                      <Input type="email" value={testTo[meta.id] ?? ''} placeholder="you@company.com" onChange={(e) => setTest(meta.id, e.target.value)} />
                    ) : (
                      <PhoneInput value={testTo[meta.id] ?? ''} onChange={(v) => setTest(meta.id, v)} />
                    )}
                    <Button size="sm" variant="outline" onClick={() => sendTest(ch)} className="gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Send test
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          <p className="text-xs text-muted-foreground">Secret keys (Resend / Twilio) live in the <strong>Edge Function secrets</strong>, not here.</p>
        </TabsContent>

        {/* TESTS — envia o e-mail de cada evento (via Resend) para um destino */}
        <TabsContent value="tests" className="space-y-4">
          <Card className="p-4">
            <Label className="text-xs">Recipient (for all tests)</Label>
            <Input type="email" className="mt-1 max-w-sm" placeholder="you@company.com" value={testRecipient}
              onChange={(e) => { setTestRecipient(e.target.value); localStorage.setItem('notif_test_email', e.target.value); }} />
            <p className="text-xs text-muted-foreground mt-1">All test emails go to this address, sent via <strong>Resend</strong>.</p>
          </Card>
          {events.map((ev) => (
            <Card key={ev.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{EVENT_LABELS[ev.id] ?? ev.id}</p>
                <p className="text-xs text-muted-foreground">Sends this event's email template.</p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => sendEventTest(ev)}>
                <Send className="w-3.5 h-3.5" /> Test
              </Button>
            </Card>
          ))}
        </TabsContent>

        {/* TEMPLATES — edita o corpo do e-mail de cada evento num lugar só */}
        <TabsContent value="templates" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Email body for each event. Available variables:&nbsp;
            <code className="text-xs">{'{order_id} {status} {total} {date} {items} {customer_name} {customer_company} {customer_email} {customer_phone}'}</code>
          </p>
          {events.map((ev) => (
            <Card key={ev.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{EVENT_LABELS[ev.id] ?? ev.id}</p>
                <Button size="sm" disabled={saving} className="gap-1.5 shrink-0" onClick={() => saveEvent(ev)}>
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((em) => (
                  <button key={em} type="button" title="Insert emoji"
                    className="rounded border border-border px-1.5 py-0.5 text-base hover:bg-muted transition-colors"
                    onClick={() => insertEmoji(ev.id, em)}>{em}</button>
                ))}
              </div>
              <Textarea rows={5} ref={(el) => { tplRefs.current[ev.id] = el; }}
                value={ev.template_email ?? ''} placeholder="Email body for this event..."
                onChange={(e) => setEvents(events.map((x) => (x.id === ev.id ? { ...x, template_email: e.target.value } : x)))} />
            </Card>
          ))}
        </TabsContent>

        {/* EVENTS */}
        <TabsContent value="events" className="space-y-4">
          {events.map((ev) => (
            <Card key={ev.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-medium">{EVENT_LABELS[ev.id] ?? ev.id}</p>
                <Switch checked={ev.enabled} onCheckedChange={(v) => setEvents(events.map((e) => (e.id === ev.id ? { ...e, enabled: v } : e)))} />
              </div>
              <div className="flex flex-wrap gap-4 mb-3">
                {CHANNELS.map((meta) => (
                  <label key={meta.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={ev.channels.includes(meta.id)}
                      onCheckedChange={(v) => setEvents(events.map((e) => e.id === ev.id ? { ...e, channels: v ? [...e.channels, meta.id] : e.channels.filter((x) => x !== meta.id) } : e))} />
                    {meta.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={ev.notify_admin} onCheckedChange={(v) => setEvents(events.map((e) => e.id === ev.id ? { ...e, notify_admin: !!v } : e))} /> Notify admin
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={ev.notify_customer} onCheckedChange={(v) => setEvents(events.map((e) => e.id === ev.id ? { ...e, notify_customer: !!v } : e))} /> Notify customer
                </label>
              </div>
              {ev.id === 'low_stock' && (
                <div className="mb-3 space-y-1.5">
                  <Label className="text-xs">Low stock threshold (≤)</Label>
                  <Input type="number" className="w-32" value={ev.extra?.low_stock_threshold ?? 5}
                    onChange={(e) => setEvents(events.map((x) => x.id === ev.id ? { ...x, extra: { ...x.extra, low_stock_threshold: Number(e.target.value) } } : x))} />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {(['email', 'sms', 'whatsapp'] as const).map((c) => (
                  <div key={c} className="space-y-1">
                    <Label className="text-xs capitalize">{c}</Label>
                    <Textarea rows={4} className="text-xs" value={(ev as any)[`template_${c}`]}
                      onChange={(e) => setEvents(events.map((x) => x.id === ev.id ? { ...x, [`template_${c}`]: e.target.value } : x))} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Variables: <code>{'{order_id} {status} {total} {date} {items} {customer_name} {customer_company} {customer_email} {customer_phone} {product_name} {quantity}'}</code>
              </p>
              <Button size="sm" className="mt-3 gap-1.5" disabled={saving} onClick={() => saveEvent(ev)}>
                <Save className="w-3.5 h-3.5" /> Save event
              </Button>
            </Card>
          ))}
        </TabsContent>

        {/* RECIPIENTS */}
        <TabsContent value="recipients" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Who receives the <Badge variant="secondary">admin</Badge> notifications. Customer ones use the order/registration's own data.
          </p>
          {recipients.map((r) => (
            <Card key={r.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Input value={r.label} placeholder="Label (e.g. Manager)"
                  onChange={(e) => setRecipients(recipients.map((x) => x.id === r.id ? { ...x, label: e.target.value } : x))} />
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={r.active} onCheckedChange={(v) => setRecipients(recipients.map((x) => x.id === r.id ? { ...x, active: v } : x))} />
                  <Button size="icon" variant="ghost" onClick={() => deleteRecipient(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Email</Label>
                  <Input value={r.email ?? ''} placeholder="you@company.com" onChange={(e) => setRecipients(recipients.map((x) => x.id === r.id ? { ...x, email: e.target.value } : x))} /></div>
                <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">SMS</Label>
                  <PhoneInput value={r.phone ?? ''} onChange={(v) => setRecipients(recipients.map((x) => x.id === r.id ? { ...x, phone: v } : x))} /></div>
                <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">WhatsApp</Label>
                  <PhoneInput value={r.whatsapp ?? ''} onChange={(v) => setRecipients(recipients.map((x) => x.id === r.id ? { ...x, whatsapp: v } : x))} /></div>
              </div>
              <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => saveRecipient(r)}><Save className="w-3.5 h-3.5" /> Save</Button>
            </Card>
          ))}
          <Button variant="outline" onClick={addRecipient} className="gap-1.5"><Plus className="w-4 h-4" /> Add recipient</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
