
-- 1) Update handle_new_user to NOT insert into clientes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', ''), NEW.email);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'cliente');

  RETURN NEW;
END;
$$;

-- 2) Add unique constraint on clientes.user_id to prevent duplicates
ALTER TABLE public.clientes ADD CONSTRAINT clientes_user_id_unique UNIQUE (user_id);
