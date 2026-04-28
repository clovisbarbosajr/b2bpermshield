
-- Fix profiles UPDATE policy: add WITH CHECK to prevent user_id reassignment
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Fix clientes UPDATE policy: add WITH CHECK to prevent user_id reassignment
DROP POLICY IF EXISTS "Clients can update own data" ON public.clientes;
CREATE POLICY "Clients can update own data"
  ON public.clientes
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
