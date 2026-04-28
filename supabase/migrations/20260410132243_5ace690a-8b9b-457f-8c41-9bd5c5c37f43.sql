
-- Clean up corrupted user data from public tables first
DELETE FROM public.user_roles WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';
DELETE FROM public.profiles WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';
DELETE FROM public.profiles WHERE email = 'jess@zapsupplies.com';

-- Remove identities
DELETE FROM auth.identities WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';

-- Remove sessions
DELETE FROM auth.sessions WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';

-- Remove refresh tokens  
DELETE FROM auth.refresh_tokens WHERE instance_id IN (
  SELECT instance_id FROM auth.sessions WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf'
);

-- Remove MFA factors
DELETE FROM auth.mfa_factors WHERE user_id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';

-- Finally remove the corrupted auth user
DELETE FROM auth.users WHERE id = 'ad8208ea-301e-49aa-a67b-18c5dc8d2acf';
