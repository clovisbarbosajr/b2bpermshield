-- ============================================================================
-- Sistema de Notificações multi-canal (Email/Resend, SMS/Twilio, WhatsApp/Twilio)
-- Portado do b2b-catalog-explorer. Usa a função de admin que JÁ existe no
-- permshield: public.has_role(auth.uid(), 'admin'). Não cria roles novas.
-- ============================================================================

-- ---- Canais ----------------------------------------------------------------
create table if not exists public.notification_channels (
  id          text primary key check (id in ('email', 'sms', 'whatsapp')),
  enabled     boolean not null default false,
  config      jsonb not null default '{}'::jsonb,  -- { "from": "..." } | { "from_number": "..." }
  updated_at  timestamptz not null default now()
);
alter table public.notification_channels enable row level security;
create policy "admin all channels" on public.notification_channels
  for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.notification_channels (id, enabled, config) values
  ('email',    true,  '{"from": "INWISE <noreply@inwisepro.com>"}'),
  ('sms',      false, '{"from_number": ""}'),
  ('whatsapp', false, '{"from_number": "+14155238886"}')
on conflict (id) do nothing;

-- ---- Eventos ---------------------------------------------------------------
create table if not exists public.notification_events (
  id                text primary key check (id in (
                      'new_order', 'order_status', 'new_customer', 'account_approved', 'low_stock')),
  enabled           boolean not null default true,
  channels          text[] not null default '{}',
  notify_admin      boolean not null default true,
  notify_customer   boolean not null default false,
  template_email    text not null default '',
  template_sms      text not null default '',
  template_whatsapp text not null default '',
  extra             jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);
alter table public.notification_events enable row level security;
create policy "admin all events" on public.notification_events
  for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.notification_events
  (id, enabled, channels, notify_admin, notify_customer, template_email, template_whatsapp, template_sms, extra) values
  ('new_order', true, '{email}', true, true,
    E'Novo pedido recebido\n\nPedido: #{order_id}\nData: {date}\n\nCliente: {customer_name}\nEmpresa: {customer_company}\nE-mail: {customer_email}\nTelefone: {customer_phone}\n\nItens:\n{items}\n\nTotal: {total}',
    E'*Novo pedido #{order_id}*\n{date}\n\nCliente: {customer_name} ({customer_company})\n\nItens:\n{items}\n\n*Total: {total}*',
    'Novo pedido #{order_id} - {customer_name} - Total {total}', '{}'),
  ('order_status', true, '{email}', false, true,
    E'Atualizacao de pedido\n\nPedido: #{order_id}\nNovo status: {status}\n\nCliente: {customer_name}\nTotal: {total}',
    E'*Pedido #{order_id}*\nNovo status: {status}\nCliente: {customer_name}',
    'Pedido #{order_id}: {status}', '{}'),
  ('new_customer', true, '{email}', true, false,
    E'Novo cadastro de cliente\n\nNome: {customer_name}\nEmpresa: {customer_company}\nE-mail: {customer_email}\nTelefone: {customer_phone}',
    E'*Novo cliente*\n{customer_name} ({customer_company})\nE-mail: {customer_email}',
    'Novo cliente: {customer_name} ({customer_company})', '{}'),
  ('account_approved', true, '{email}', false, true,
    E'Conta aprovada\n\nOla {customer_name}, sua conta foi aprovada! Voce ja pode fazer pedidos.',
    E'Ola {customer_name}, sua conta foi *aprovada*! Voce ja pode fazer pedidos.',
    'Conta aprovada, {customer_name}!', '{}'),
  ('low_stock', true, '{email}', true, false,
    E'Alerta de estoque baixo\n\nProduto: {product_name}\nQuantidade atual: {quantity}',
    E'*Estoque baixo*\n{product_name}: {quantity} unidade(s)',
    'Estoque baixo: {product_name} ({quantity})',
    '{"low_stock_threshold": 5}')
on conflict (id) do nothing;

-- ---- Destinatários (admin) -------------------------------------------------
create table if not exists public.notification_recipients (
  id          uuid primary key default gen_random_uuid(),
  label       text not null default '',
  email       text,
  phone       text,
  whatsapp    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.notification_recipients enable row level security;
create policy "admin all recipients" on public.notification_recipients
  for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ---- Log de envios ---------------------------------------------------------
create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  event       text not null,
  channel     text not null,
  recipient   text not null,
  status      text not null default 'sent',
  error       text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.notification_log enable row level security;
create policy "admin read log" on public.notification_log
  for select using (public.has_role(auth.uid(), 'admin'));
create index if not exists notification_log_created_at_idx on public.notification_log (created_at desc);

-- ---- updated_at automático (reusa a função existente do permshield) ---------
drop trigger if exists t_notif_channels_touch on public.notification_channels;
create trigger t_notif_channels_touch before update on public.notification_channels
  for each row execute function public.update_updated_at_column();
drop trigger if exists t_notif_events_touch on public.notification_events;
create trigger t_notif_events_touch before update on public.notification_events
  for each row execute function public.update_updated_at_column();
