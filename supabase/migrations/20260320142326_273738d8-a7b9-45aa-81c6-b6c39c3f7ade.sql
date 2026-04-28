
-- Allow anon to insert, update, delete clientes (for demo/admin mode)
CREATE POLICY "Anon can insert clientes" ON public.clientes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update clientes" ON public.clientes FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete clientes" ON public.clientes FOR DELETE TO anon USING (true);

-- Allow anon to manage cliente_privacy_groups
CREATE POLICY "Anon can insert cliente_privacy_groups" ON public.cliente_privacy_groups FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update cliente_privacy_groups" ON public.cliente_privacy_groups FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete cliente_privacy_groups" ON public.cliente_privacy_groups FOR DELETE TO anon USING (true);
CREATE POLICY "Anon can read cliente_privacy_groups" ON public.cliente_privacy_groups FOR SELECT TO anon USING (true);

-- Allow anon to manage enderecos
CREATE POLICY "Anon can insert enderecos" ON public.enderecos FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update enderecos" ON public.enderecos FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete enderecos" ON public.enderecos FOR DELETE TO anon USING (true);
CREATE POLICY "Anon can read enderecos" ON public.enderecos FOR SELECT TO anon USING (true);
