
-- Allow anon (demo mode) to read key tables
CREATE POLICY "Anon can read produtos" ON public.produtos FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read categorias" ON public.categorias FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read brands" ON public.brands FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read representantes" ON public.representantes FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tabelas_preco" ON public.tabelas_preco FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tabela_preco_itens" ON public.tabela_preco_itens FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read pedidos" ON public.pedidos FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read pedido_itens" ON public.pedido_itens FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read clientes" ON public.clientes FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read banners" ON public.banners FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read noticias" ON public.noticias FOR SELECT TO anon USING (true);
