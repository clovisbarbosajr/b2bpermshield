-- ============================================================================
-- Política SMS-only do INWISE PRO (decisão 2026-06-18)
-- Notificações por Email + SMS; WhatsApp DESABILITADO.
-- IMPORTANTE: isto é uma mudança de CONFIG (o mesmo que os toggles da tela
-- Notifications → Canais gravam). O CÓDIGO de envio (senders.ts / sendWhatsapp)
-- NÃO é tocado — o WhatsApp continua existindo, só desligado. 100% reversível
-- religando o canal no toggle.
-- Twilio toll-free aprovado: +18665805796 (conta INWISEPRO AC101802...).
-- ============================================================================

-- WhatsApp OFF (canal) — não apaga, só desliga o toggle.
UPDATE public.notification_channels
SET enabled = false
WHERE id = 'whatsapp';

-- SMS ON + número toll-free aprovado.
UPDATE public.notification_channels
SET enabled = true,
    config = jsonb_set(COALESCE(config, '{}'::jsonb), '{from_number}', '"+18665805796"')
WHERE id = 'sms';

-- Eventos: remove 'whatsapp' e adiciona 'sms' nos canais (text[]), deduplicado.
-- Mantém 'email'. Resultado típico: {email, sms}.
UPDATE public.notification_events
SET channels = (
  SELECT array_agg(DISTINCT ch ORDER BY ch)
  FROM unnest(array_append(array_remove(channels, 'whatsapp'), 'sms')) AS ch
);
