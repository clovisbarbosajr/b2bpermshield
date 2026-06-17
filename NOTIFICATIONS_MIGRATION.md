# Migração do sistema de Notificações (do explorer → permshield)

Traz a estrutura de notificações validada no `b2b-catalog-explorer` (telas
Canais / Eventos / Destinatários + Histórico) para o permshield, **mesclando**
com o que ele já tem (templates, admin), e **adicionando SMS + WhatsApp (Twilio)**.

## Decisões (definidas com o cliente)
- **Email**: preferir **Resend** (o permshield usava SMTP; nova função usa Resend).
- **Canais**: Email (Resend) + SMS (Twilio) + WhatsApp (Twilio), ligáveis pelo admin.
- **UI**: usar as 3 telas do explorer (melhores) + Histórico, dentro do admin do permshield.
- **RLS/admin**: reutiliza `public.has_role(auth.uid(), 'admin')` (já existe no permshield).
- **Disparo**: nos próprios gatilhos do permshield (checkout, mudança de status, etc.) — inline, em tempo real. Sem polling.
- **Backup/espelho do B2BWave**: usar o do explorer (mais recente); remover `b2bwave-sync` depois.

## Fases
- [x] **F1 — Migração** das tabelas `notification_channels/events/recipients/log` (+ seed).
- [ ] **F2 — Edge Functions**: `_shared` (senders/dispatch/cors/auth) + `notify-dispatch`.
- [ ] **F3 — UI admin**: `Notificacoes.tsx` (3 abas) + `NotificacoesLog.tsx` (Histórico) + rota + menu.
- [ ] **F4 — Ligação nos eventos** do permshield (novo pedido, status, cliente).
- [ ] **F5 — Email→Resend**, remover `b2bwave-sync`, fix Vercel (`@import` no CSS), testes.

## Secrets necessários (Edge Functions)
`RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (reaproveitados do explorer).
