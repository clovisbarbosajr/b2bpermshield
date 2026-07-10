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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/RichTextEditor';
import { toast } from 'sonner';
import {
  Mail, MessageSquare, Phone, Loader2, Save, Send, Trash2, Plus, Bell, Pencil, X,
  Image as ImageIcon, Eye, RefreshCw, FileText,
} from 'lucide-react';

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

// ─── Order Confirmation Email — variáveis disponíveis ────────────────────────
const EMAIL_ORDER_VARIABLES = [
  { var: '{{companyName}}',     desc: 'Your company name' },
  { var: '{{companyAddress}}',  desc: 'Your company address' },
  { var: '{{companyEmail}}',    desc: 'Your company email' },
  { var: '{{orderNumber}}',     desc: 'Order number' },
  { var: '{{orderDate}}',       desc: 'Order date' },
  { var: '{{poNumber}}',        desc: 'PO Number' },
  { var: '{{deliveryDate}}',    desc: 'Requested delivery date' },
  { var: '{{customerCompany}}', desc: 'Customer company name' },
  { var: '{{customerName}}',    desc: 'Customer contact name' },
  { var: '{{customerEmail}}',   desc: 'Customer email' },
  { var: '{{customerAddress}}', desc: 'Delivery address' },
  { var: '{{itemsTable}}',      desc: 'HTML table of order items (auto-generated)' },
  { var: '{{subtotal}}',        desc: 'Order subtotal' },
  { var: '{{discount}}',        desc: 'Discount amount' },
  { var: '{{shippingCosts}}',   desc: 'Shipping costs' },
  { var: '{{salesTax}}',        desc: 'Sales tax' },
  { var: '{{grossTotal}}',      desc: 'Gross total' },
  { var: '{{notes}}',           desc: 'Order notes / comments' },
];

const DEFAULT_ORDER_EMAIL_TEMPLATE = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #1a3a6b;">Order Confirmation — #{{orderNumber}}</h2>
  <p>Dear {{customerName}},</p>
  <p>Thank you for your order! Below are your order details:</p>

  <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 4px 8px; font-weight: bold;">Order #:</td><td style="padding: 4px 8px;">{{orderNumber}}</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: bold;">Order Date:</td><td style="padding: 4px 8px;">{{orderDate}}</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: bold;">PO Number:</td><td style="padding: 4px 8px;">{{poNumber}}</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: bold;">Delivery Date:</td><td style="padding: 4px 8px;">{{deliveryDate}}</td></tr>
  </table>

  <h3>Items Ordered</h3>
  {{itemsTable}}

  <table style="width:100%; border-collapse: collapse; margin-top: 16px;">
    <tr><td style="padding: 4px 8px; text-align: right; font-weight: bold;">Subtotal:</td><td style="padding: 4px 8px; text-align: right; width: 120px;">{{subtotal}}</td></tr>
    <tr><td style="padding: 4px 8px; text-align: right; font-weight: bold;">Discount:</td><td style="padding: 4px 8px; text-align: right;">{{discount}}</td></tr>
    <tr><td style="padding: 4px 8px; text-align: right; font-weight: bold;">Shipping:</td><td style="padding: 4px 8px; text-align: right;">{{shippingCosts}}</td></tr>
    <tr><td style="padding: 4px 8px; text-align: right; font-weight: bold;">Sales Tax:</td><td style="padding: 4px 8px; text-align: right;">{{salesTax}}</td></tr>
    <tr style="border-top: 2px solid #333;"><td style="padding: 8px; text-align: right; font-weight: bold; font-size: 1.1em;">Gross Total:</td><td style="padding: 8px; text-align: right; font-weight: bold; font-size: 1.1em;">{{grossTotal}}</td></tr>
  </table>

  <p style="margin-top: 24px; color: #555;">{{notes}}</p>

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
  <p style="font-size: 12px; color: #888;">{{companyName}} | {{companyAddress}} | {{companyEmail}}</p>
</div>`;

// ─── Order PDF — variáveis disponíveis ────────────────────────────────────────
const PDF_VARIABLES = [
  { var: '{{orderNumber}}',     desc: 'Order number' },
  { var: '{{orderDate}}',       desc: 'Order date' },
  { var: '{{poNumber}}',        desc: 'PO Number' },
  { var: '{{deliveryDate}}',    desc: 'Requested delivery date' },
  { var: '{{customerName}}',    desc: 'Customer company name' },
  { var: '{{customerEmail}}',   desc: 'Customer email' },
  { var: '{{customerAddress}}', desc: 'Delivery address' },
  { var: '{{companyName}}',     desc: 'Your company name' },
  { var: '{{companyAddress}}',  desc: 'Your company address' },
  { var: '{{companyEmail}}',    desc: 'Your company email' },
  { var: '{{itemsRows}}',       desc: 'HTML table rows for items (auto-generated)' },
  { var: '{{subtotal}}',        desc: 'Order subtotal' },
  { var: '{{discount}}',        desc: 'Discount amount' },
  { var: '{{tax}}',             desc: 'Sales tax' },
  { var: '{{grossTotal}}',      desc: 'Gross total' },
  { var: '{{notes}}',           desc: 'Order notes / comments' },
];

// Só o low_stock realmente sai por email pelo notify-dispatch hoje (os outros 4
// eventos tiveram o canal 'email' removido na dedup — quem manda email de verdade
// pra new_order/order_status/new_customer/account_approved é o send-email, com o
// template da aba Email acima). Mantido aqui só pra não confundir quem for editar.
const EMAIL_CHANNEL_LIVE: Record<string, boolean> = {
  new_order: false, order_status: false, new_customer: false, account_approved: false, low_stock: true,
};

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

  // ── Aba Email: logo, template do email de pedido, template do PDF ──
  const [configId, setConfigId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPosition, setLogoPosition] = useState<'left' | 'center' | 'right'>('left');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [emailOrderTemplate, setEmailOrderTemplate] = useState('');
  const [emailOrderOriginal, setEmailOrderOriginal] = useState('');
  const [emailOrderSaving, setEmailOrderSaving] = useState(false);
  const [emailOrderPreviewHtml, setEmailOrderPreviewHtml] = useState('');
  const [emailOrderPreviewing, setEmailOrderPreviewing] = useState(false);
  const [showHtmlSource, setShowHtmlSource] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState('');
  const [pdfOriginal, setPdfOriginal] = useState('');
  const [pdfSaving, setPdfSaving] = useState(false);
  const [pdfPreviewHtml, setPdfPreviewHtml] = useState('');
  const [pdfPreviewing, setPdfPreviewing] = useState(false);

  // Insere um emoji no template do evento (email/sms/whatsapp), na posição do cursor.
  const tplRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const insertEmoji = (evId: string, field: 'email' | 'sms' | 'whatsapp', emoji: string) => {
    const key = `${evId}:${field}`;
    const col = `template_${field}` as const;
    const ta = tplRefs.current[key];
    const cur = (events.find((e) => e.id === evId) as any)?.[col] ?? '';
    const pos = ta ? (ta.selectionStart ?? cur.length) : cur.length;
    const next = cur.slice(0, pos) + emoji + cur.slice(pos);
    setEvents(events.map((x) => (x.id === evId ? { ...x, [col]: next } : x)));
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + emoji.length; } });
  };

  // Envolve o texto SELECIONADO do campo WhatsApp com a marcação do próprio app
  // (*negrito*, _itálico_, ~tachado~) — é o único "rich text" que o WhatsApp
  // entende; SMS não suporta formatação nenhuma, por isso não existe pro SMS.
  const wrapWhatsappSelection = (evId: string, marker: string) => {
    const key = `${evId}:whatsapp`;
    const ta = tplRefs.current[key];
    const cur = events.find((e) => e.id === evId)?.template_whatsapp ?? '';
    const start = ta?.selectionStart ?? cur.length;
    const end = ta?.selectionEnd ?? cur.length;
    const selected = cur.slice(start, end) || 'text';
    const next = cur.slice(0, start) + marker + selected + marker + cur.slice(end);
    setEvents(events.map((x) => (x.id === evId ? { ...x, template_whatsapp: next } : x)));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = start + marker.length;
      ta.selectionEnd = start + marker.length + selected.length;
    });
  };

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [c, e, r, cfg] = await Promise.all([
      sb.from('notification_channels').select('*').order('id'),
      sb.from('notification_events').select('*').order('id'),
      sb.from('notification_recipients').select('*').order('created_at'),
      sb.from('configuracoes')
        .select('id, email_order_template, pdf_order_template, email_logo_url, email_logo_position')
        .limit(1).maybeSingle(),
    ]);
    setChannels((c.data as Channel[]) ?? []);
    setEvents((e.data as EventRow[]) ?? []);
    setRecipients((r.data as Recipient[]) ?? []);
    setConfigId(cfg.data?.id ?? null);
    setEmailOrderTemplate(cfg.data?.email_order_template ?? '');
    setEmailOrderOriginal(cfg.data?.email_order_template ?? '');
    setPdfTemplate(cfg.data?.pdf_order_template ?? '');
    setPdfOriginal(cfg.data?.pdf_order_template ?? '');
    setLogoUrl(cfg.data?.email_logo_url ?? '');
    setLogoPosition((cfg.data?.email_logo_position ?? 'left') as 'left' | 'center' | 'right');
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

  // ── Logo do cabeçalho do email ──
  const buildLogoHeaderHtml = () => {
    if (!logoUrl) return '';
    const justify = logoPosition === 'center' ? 'center' : logoPosition === 'right' ? 'flex-end' : 'flex-start';
    return `<div style="display:flex;justify-content:${justify};margin-bottom:16px;"><img src="${logoUrl}" alt="Logo" style="max-height:64px;max-width:280px;" /></div>`;
  };

  async function handleLogoUpload(file: File) {
    setLogoUploading(true);
    const ext = file.name.split('.').pop();
    const path = `settings/email-logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file);
    if (error) { toast.error('Upload failed: ' + error.message); setLogoUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path);
    setLogoUrl(publicUrl);
    setLogoUploading(false);
  }

  async function handleLogoSave() {
    if (!configId) { toast.error('Configuration not found'); return; }
    setLogoSaving(true);
    const { error } = await sb.from('configuracoes')
      .update({ email_logo_url: logoUrl || null, email_logo_position: logoPosition }).eq('id', configId);
    toast[error ? 'error' : 'success'](error ? error.message : 'Logo saved');
    setLogoSaving(false);
  }

  const handleLogoRemove = () => setLogoUrl('');

  // ── Template do email de confirmação de pedido (cliente) ──
  async function handleEmailOrderSave() {
    if (!configId) { toast.error('Configuration not found'); return; }
    setEmailOrderSaving(true);
    const { error } = await sb.from('configuracoes')
      .update({ email_order_template: emailOrderTemplate || null }).eq('id', configId);
    if (error) toast.error('Error saving: ' + error.message);
    else { setEmailOrderOriginal(emailOrderTemplate); toast.success('Email template saved'); }
    setEmailOrderSaving(false);
  }

  const handleEmailOrderReset = () => {
    if (!confirm('Reset to the system default email template?')) return;
    setEmailOrderTemplate('');
  };

  async function handleEmailOrderPreview() {
    setEmailOrderPreviewing(true);
    const { data: pedido } = await sb.from('pedidos').select('*, pedido_itens(*)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!pedido) { toast.error('No orders found to preview. Place a test order first.'); setEmailOrderPreviewing(false); return; }
    const { data: cliente } = await sb.from('clientes').select('*').eq('id', pedido.cliente_id).maybeSingle();
    const { data: cfg } = await sb.from('configuracoes').select('nome_empresa, endereco, email_contato').limit(1).maybeSingle();

    const tpl = emailOrderTemplate || DEFAULT_ORDER_EMAIL_TEMPLATE;
    const itemsRows = (pedido.pedido_itens ?? []).map((it: any) =>
      `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${it.sku ?? ''}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${it.nome_produto}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(it.preco_unitario).toFixed(2)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${it.quantidade}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(it.subtotal).toFixed(2)}</td></tr>`
    ).join('');
    const itemsTable = `<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">SKU</th><th style="padding:6px 8px;text-align:left;">Product</th><th style="padding:6px 8px;text-align:right;">Price</th><th style="padding:6px 8px;text-align:right;">Qty</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead><tbody>${itemsRows}</tbody></table>`;
    const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US') : '-';
    const vars: Record<string, string> = {
      companyName: cfg?.nome_empresa ?? '', companyAddress: cfg?.endereco ?? '', companyEmail: cfg?.email_contato ?? '',
      orderNumber: String(pedido.numero ?? ''), orderDate: fmt(pedido.created_at), poNumber: pedido.po_number ?? '',
      deliveryDate: pedido.delivery_date ? fmt(pedido.delivery_date) : '-',
      customerCompany: cliente?.empresa ?? '', customerName: cliente?.nome ?? '', customerEmail: cliente?.email ?? '',
      customerAddress: [cliente?.endereco, cliente?.cidade, cliente?.estado].filter(Boolean).join(', '),
      itemsTable, subtotal: `$${Number(pedido.subtotal ?? 0).toFixed(2)}`,
      discount: pedido.desconto ? `-$${Number(pedido.desconto).toFixed(2)}` : '$0.00',
      shippingCosts: pedido.shipping_costs ? `$${Number(pedido.shipping_costs).toFixed(2)}` : '$0.00',
      salesTax: pedido.sales_tax ? `$${Number(pedido.sales_tax).toFixed(2)}` : '$0.00',
      grossTotal: `$${Number(pedido.total ?? 0).toFixed(2)}`, notes: pedido.observacoes ?? '',
    };
    const rendered = Object.entries(vars).reduce((html, [key, val]) => html.split(`{{${key}}}`).join(val), tpl);
    setEmailOrderPreviewHtml(buildLogoHeaderHtml() + rendered);
    setEmailOrderPreviewing(false);
  }

  // ── Template do PDF do pedido ──
  async function handlePdfSave() {
    if (!configId) { toast.error('Configuration not found'); return; }
    setPdfSaving(true);
    const { error } = await sb.from('configuracoes').update({ pdf_order_template: pdfTemplate || null }).eq('id', configId);
    if (error) toast.error('Error saving: ' + error.message);
    else { setPdfOriginal(pdfTemplate); toast.success('PDF template saved'); }
    setPdfSaving(false);
  }

  const handlePdfReset = () => {
    if (!confirm('Reset to the system default PDF template? Your custom template will be cleared.')) return;
    setPdfTemplate('');
  };

  async function handlePdfPreview() {
    setPdfPreviewing(true);
    const { data: pedido } = await sb.from('pedidos').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!pedido?.id) { toast.error('No orders found to preview. Place a test order first.'); setPdfPreviewing(false); return; }
    const { data, error } = await sb.functions.invoke('generate-pdf', { body: { pedido_id: pedido.id } });
    if (error || !data?.html) toast.error('Failed to generate preview: ' + (error?.message || 'unknown error'));
    else setPdfPreviewHtml(data.html);
    setPdfPreviewing(false);
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
          <TabsTrigger value="email">Email</TabsTrigger>
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

        {/* TEMPLATES — ÚNICO lugar pra escrever a mensagem de cada evento (email/SMS/WhatsApp).
            A aba Events cuida só de LIGAR o evento e escolher canais/quem recebe. */}
        <TabsContent value="templates" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Write the SMS / WhatsApp message sent for each event. Email content moved to the
            dedicated <strong>Email</strong> tab. Available variables:&nbsp;
            <code className="text-xs">{'{order_id} {status} {total} {date} {items} {customer_name} {customer_company} {customer_email} {customer_phone} {product_name} {quantity}'}</code>
          </p>
          {events.map((ev) => (
            <Card key={ev.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{EVENT_LABELS[ev.id] ?? ev.id}</p>
                <Button size="sm" disabled={saving} className="gap-1.5 shrink-0" onClick={() => saveEvent(ev)}>
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
              </div>
              {(['sms', 'whatsapp'] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label className="text-xs capitalize">{field}</Label>
                  {field === 'whatsapp' && (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" title="Bold (*text*)"
                        className="rounded border border-border px-2 py-0.5 text-xs font-bold hover:bg-muted transition-colors"
                        onClick={() => wrapWhatsappSelection(ev.id, '*')}>B</button>
                      <button type="button" title="Italic (_text_)"
                        className="rounded border border-border px-2 py-0.5 text-xs italic hover:bg-muted transition-colors"
                        onClick={() => wrapWhatsappSelection(ev.id, '_')}>I</button>
                      <button type="button" title="Strikethrough (~text~)"
                        className="rounded border border-border px-2 py-0.5 text-xs line-through hover:bg-muted transition-colors"
                        onClick={() => wrapWhatsappSelection(ev.id, '~')}>S</button>
                      <span className="text-[10px] text-muted-foreground self-center ml-1">
                        Select text first — WhatsApp's own markup, no size/color available.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {EMOJIS.map((em) => (
                      <button key={em} type="button" title="Insert emoji"
                        className="rounded border border-border px-1.5 py-0.5 text-sm hover:bg-muted transition-colors"
                        onClick={() => insertEmoji(ev.id, field, em)}>{em}</button>
                    ))}
                  </div>
                  <Textarea rows={field === 'email' ? 5 : 3}
                    ref={(el) => { tplRefs.current[`${ev.id}:${field}`] = el; }}
                    value={(ev as any)[`template_${field}`] ?? ''}
                    placeholder={`${field.toUpperCase()} message for this event...`}
                    onChange={(e) => setEvents(events.map((x) => (x.id === ev.id ? { ...x, [`template_${field}`]: e.target.value } : x)))} />
                </div>
              ))}
            </Card>
          ))}
        </TabsContent>

        {/* EMAIL — logo, template do email de pedido (cliente), template do PDF,
            e os textos por-evento que antes ficavam na aba Templates. Consolidado
            aqui (2026-07-10): antes existia uma página separada (Email Templates,
            fora do menu) desconectada do envio real — ver docs/EMAIL-CONSOLIDACAO.md. */}
        <TabsContent value="email" className="space-y-4">
          {/* Logo */}
          <Card className="p-4 space-y-3">
            <p className="font-medium flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Email Logo</p>
            <p className="text-xs text-muted-foreground">
              Appears at the top of the order confirmation email. Choose where it aligns.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {logoUrl && (
                <img src={logoUrl} alt="Logo preview" className="h-14 max-w-[200px] rounded border border-border bg-white object-contain p-1" />
              )}
              <Input type="file" accept="image/*" className="max-w-xs" disabled={logoUploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
              {logoUrl && (
                <Button variant="ghost" size="icon" className="text-destructive" onClick={handleLogoRemove} title="Remove logo">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Select value={logoPosition} onValueChange={(v) => setLogoPosition(v as 'left' | 'center' | 'right')}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Position" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="gap-1.5" onClick={handleLogoSave} disabled={logoSaving || logoUploading}>
                <Save className="w-3.5 h-3.5" /> {logoSaving ? 'Saving...' : 'Save Logo'}
              </Button>
            </div>
          </Card>

          {/* Order Confirmation Email (customer) */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="font-medium flex items-center gap-2"><Mail className="w-4 h-4" /> Order Confirmation Email (Customer)</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowHtmlSource((s) => !s)}>
                  {showHtmlSource ? 'Visual editor' : 'Edit HTML source'}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleEmailOrderPreview} disabled={emailOrderPreviewing}>
                  <Eye className="w-3.5 h-3.5" /> {emailOrderPreviewing ? 'Loading...' : 'Preview'}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={handleEmailOrderReset}>
                  <RefreshCw className="w-3.5 h-3.5" /> Reset to default
                </Button>
                <Button size="sm" className="gap-1.5" onClick={handleEmailOrderSave} disabled={emailOrderSaving}>
                  <Save className="w-3.5 h-3.5" /> {emailOrderSaving ? 'Saving...' : 'Save Template'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the email sent when a customer places an order. Leave blank to use the system
              default. Use <code>{'{{variable}}'}</code> placeholders below.
            </p>
            {showHtmlSource ? (
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[360px]"
                value={emailOrderTemplate} onChange={(e) => setEmailOrderTemplate(e.target.value)} spellCheck={false}
                placeholder="Leave blank to use the system default template. Paste full HTML here to customize..."
              />
            ) : (
              <RichTextEditor value={emailOrderTemplate || DEFAULT_ORDER_EMAIL_TEMPLATE} onChange={setEmailOrderTemplate} minHeight={360} />
            )}
            {emailOrderTemplate !== emailOrderOriginal && (
              <p className="text-xs text-amber-600">Unsaved changes — click Save Template to apply.</p>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Available variables</summary>
              <div className="grid gap-1 sm:grid-cols-2 mt-2">
                {EMAIL_ORDER_VARIABLES.map((v) => (
                  <div key={v.var} className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">{v.var}</code>
                    <span>{v.desc}</span>
                  </div>
                ))}
              </div>
            </details>
            {emailOrderPreviewHtml && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Preview (most recent order)</p>
                  <Button variant="ghost" size="sm" onClick={() => setEmailOrderPreviewHtml('')}>Close</Button>
                </div>
                <iframe srcDoc={emailOrderPreviewHtml} className="w-full rounded border border-border bg-white" style={{ height: 500 }} title="Email Preview" />
              </div>
            )}
          </Card>

          {/* Order PDF Template */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="font-medium flex items-center gap-2"><FileText className="w-4 h-4" /> Order PDF Template</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePdfPreview} disabled={pdfPreviewing}>
                  <Eye className="w-3.5 h-3.5" /> {pdfPreviewing ? 'Loading...' : 'Preview'}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={handlePdfReset}>
                  <RefreshCw className="w-3.5 h-3.5" /> Reset to default
                </Button>
                <Button size="sm" className="gap-1.5" onClick={handlePdfSave} disabled={pdfSaving}>
                  <Save className="w-3.5 h-3.5" /> {pdfSaving ? 'Saving...' : 'Save PDF Template'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              HTML layout used for the order PDF (currently the admin's print/preview — not yet attached
              to the customer email automatically). Leave blank to use the system default.
            </p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[300px]"
              value={pdfTemplate} onChange={(e) => setPdfTemplate(e.target.value)} spellCheck={false}
              placeholder="Leave blank to use the system default template. Paste full HTML here to customize..."
            />
            {pdfTemplate !== pdfOriginal && (
              <p className="text-xs text-amber-600">Unsaved changes — click Save PDF Template to apply.</p>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Available variables</summary>
              <div className="grid gap-1 sm:grid-cols-2 mt-2">
                {PDF_VARIABLES.map((v) => (
                  <div key={v.var} className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">{v.var}</code>
                    <span>{v.desc}</span>
                  </div>
                ))}
              </div>
            </details>
            {pdfPreviewHtml && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Preview (most recent order)</p>
                  <Button variant="ghost" size="sm" onClick={() => setPdfPreviewHtml('')}>Close</Button>
                </div>
                <iframe srcDoc={pdfPreviewHtml} className="w-full rounded border border-border" style={{ height: 600 }} title="PDF Preview" />
              </div>
            )}
          </Card>

          {/* Per-event plain-text email messages — relocated from the old Templates tab */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Per-event email messages (plain text)</p>
            <p className="text-xs text-muted-foreground">
              Only <strong>Low stock</strong> actually sends email through this text today — the other
              4 events' customer/admin emails go through the Order Confirmation template above (or a
              fixed template in code, not yet editable here). Kept editable for when those get wired up.
            </p>
            {events.map((ev) => (
              <Card key={ev.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {EVENT_LABELS[ev.id] ?? ev.id}
                    {!EMAIL_CHANNEL_LIVE[ev.id] && <Badge variant="secondary" className="text-[10px]">not live yet</Badge>}
                  </p>
                  <Button size="sm" variant="outline" disabled={saving} className="gap-1.5" onClick={() => saveEvent(ev)}>
                    <Save className="w-3.5 h-3.5" /> Save
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {EMOJIS.map((em) => (
                    <button key={em} type="button" title="Insert emoji"
                      className="rounded border border-border px-1.5 py-0.5 text-sm hover:bg-muted transition-colors"
                      onClick={() => insertEmoji(ev.id, 'email', em)}>{em}</button>
                  ))}
                </div>
                <Textarea rows={4}
                  ref={(el) => { tplRefs.current[`${ev.id}:email`] = el; }}
                  value={ev.template_email ?? ''}
                  placeholder="EMAIL message for this event..."
                  onChange={(e) => setEvents(events.map((x) => (x.id === ev.id ? { ...x, template_email: e.target.value } : x)))} />
              </Card>
            ))}
          </div>
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
              <p className="text-[11px] text-muted-foreground mb-3">Message content is edited in the <strong>Templates</strong> tab.</p>
              <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => saveEvent(ev)}>
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
