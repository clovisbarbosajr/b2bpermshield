
-- Sets Reply-To for Jessika and provider to smtp
-- Run AFTER all other migrations are applied
-- SMTP credentials (host, port, username, password) are stored as Supabase Secrets, NOT here

UPDATE public.configuracoes SET
  email_provider  = 'smtp',
  email_from      = 'PermShield B2B <automated@wiseitsolutions.us>',
  email_reply_to  = 'jess@zapsupplies.com'
WHERE id = (SELECT id FROM public.configuracoes LIMIT 1);
