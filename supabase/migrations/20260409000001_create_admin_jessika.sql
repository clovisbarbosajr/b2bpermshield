-- ============================================================
-- Admin user: Jessika (jess@zapsupplies.com)
--
-- ⚠️  DO NOT create auth users via SQL INSERT into auth.users.
--     Newer Supabase versions require users to be created via:
--       - Supabase Dashboard → Authentication → Users → Add user
--       - OR Supabase Admin API (supabase.auth.admin.createUser)
--     Creating via raw SQL corrupts the auth state.
--
-- This migration ONLY assigns the admin role.
-- The user must already exist in auth.users (created via Dashboard).
-- ============================================================

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'jess@zapsupplies.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User jess@zapsupplies.com not found. Create it via Supabase Dashboard → Authentication → Users → Add user, then re-run this migration.';
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

    RAISE NOTICE 'Admin role assigned to user id: %', v_user_id;
  END IF;
END $$;
