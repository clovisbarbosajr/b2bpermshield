
-- Email column corrections — uses correct column names from 20260408000002 migration
-- email_reply_to added separately in 20260408225410 migration (already applied by Lovable)

-- Safe: only sets values, doesn't add columns (columns added by earlier migrations)
UPDATE public.configuracoes SET
  email_provider        = 'smtp',
  email_from            = 'PermShield B2B <automated@wiseitsolutions.us>',
  email_on_new_order    = true,
  email_on_approval     = true,
  email_on_order_status = true
WHERE id = (SELECT id FROM public.configuracoes LIMIT 1);

INSERT INTO public.configuracoes (
  email_provider, email_from, email_on_new_order, email_on_approval, email_on_order_status
)
SELECT 'smtp', 'PermShield B2B <automated@wiseitsolutions.us>', true, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes);
