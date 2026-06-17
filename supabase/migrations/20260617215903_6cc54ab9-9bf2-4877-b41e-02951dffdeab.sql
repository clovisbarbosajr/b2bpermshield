
UPDATE auth.users
SET encrypted_password = crypt('Admin@1234', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email = 'jess@zapsupplies.com';

DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'cliente.teste@inwisepro.com';

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'cliente.teste@inwisepro.com', crypt('Cliente@1234', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nome":"Cliente Teste"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', 'cliente.teste@inwisepro.com', 'email_verified', true),
            'email', v_uid::text, now(), now(), now());
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt('Cliente@1234', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_uid;
  END IF;

  INSERT INTO public.profiles (user_id, nome, email)
  VALUES (v_uid, 'Cliente Teste', 'cliente.teste@inwisepro.com')
  ON CONFLICT (user_id) DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND role <> 'cliente';
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'cliente')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.clientes (user_id, nome, email, empresa, status, is_active)
  VALUES (v_uid, 'Cliente Teste', 'cliente.teste@inwisepro.com', 'Empresa Teste', 'ativo', true)
  ON CONFLICT (user_id) DO UPDATE SET status='ativo', is_active=true;
END $$;
