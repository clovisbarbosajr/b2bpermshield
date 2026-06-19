-- ============================================================================
-- DEDUP de email nas notificações.
-- Antes: para um pedido, o `send-email` (HTML, Resend) E o `notify-dispatch`
-- (Resend) mandavam email → o cliente recebia DOIS emails.
-- Agora a divisão é limpa:
--   • EMAIL  = responsabilidade do `send-email` (Resend primário + Office365 fallback).
--   • SMS    = responsabilidade do `notify-dispatch` (Twilio).
-- Então removemos o canal 'email' dos eventos que TAMBÉM são disparados via
-- send-email (new_order, order_status, new_customer, account_approved). Esses
-- eventos passam a ser SMS-only no notify-dispatch. (low_stock e outros internos
-- mantêm email no notify-dispatch, pois não têm send-email correspondente.)
-- Reversível: re-adicionar 'email' aos channels desses eventos.
-- ============================================================================
UPDATE public.notification_events
SET channels = array_remove(channels, 'email')
WHERE id IN ('new_order', 'order_status', 'new_customer', 'account_approved');
