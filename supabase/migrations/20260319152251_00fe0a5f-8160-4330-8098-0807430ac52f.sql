
-- Remove FK constraint so we can import customers without auth users
ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_user_id_fkey;
