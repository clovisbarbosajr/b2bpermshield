-- ============================================================================
-- Templates de notificação em INGLÊS (o sistema é all-English). Os defaults
-- foram semeados em PT (20260617210000). Traduz os 5 eventos × 3 canais.
-- Variáveis preservadas: {order_id} {status} {total} {date} {items}
-- {customer_name} {customer_company} {customer_email} {customer_phone}
-- {product_name} {quantity}.
-- ============================================================================

UPDATE public.notification_events SET
  template_email    = E'New order received\n\nOrder: #{order_id}\nDate: {date}\n\nCustomer: {customer_name}\nCompany: {customer_company}\nEmail: {customer_email}\nPhone: {customer_phone}\n\nItems:\n{items}\n\nTotal: {total}',
  template_whatsapp = E'*New order #{order_id}*\n{date}\n\nCustomer: {customer_name} ({customer_company})\n\nItems:\n{items}\n\n*Total: {total}*',
  template_sms      = 'New order #{order_id} - {customer_name} - Total {total}'
WHERE id = 'new_order';

UPDATE public.notification_events SET
  template_email    = E'Order update\n\nOrder: #{order_id}\nNew status: {status}\n\nCustomer: {customer_name}\nTotal: {total}',
  template_whatsapp = E'*Order #{order_id}*\nNew status: {status}\nCustomer: {customer_name}',
  template_sms      = 'Order #{order_id}: {status}'
WHERE id = 'order_status';

UPDATE public.notification_events SET
  template_email    = E'New customer registration\n\nName: {customer_name}\nCompany: {customer_company}\nEmail: {customer_email}\nPhone: {customer_phone}',
  template_whatsapp = E'*New customer registration*\nName: {customer_name}\nCompany: {customer_company}',
  template_sms      = 'New customer: {customer_name} ({customer_company})'
WHERE id = 'new_customer';

UPDATE public.notification_events SET
  template_email    = E'Account approved\n\nHello {customer_name}, your account has been approved! You can now place orders.',
  template_whatsapp = E'Hello {customer_name}, your account has been *approved*! You can now place orders.',
  template_sms      = 'Account approved, {customer_name}!'
WHERE id = 'account_approved';

UPDATE public.notification_events SET
  template_email    = E'Low stock alert\n\nProduct: {product_name}\nCurrent quantity: {quantity}',
  template_whatsapp = E'*Low stock* {product_name}: {quantity} unit(s)',
  template_sms      = 'Low stock: {product_name} ({quantity})'
WHERE id = 'low_stock';
