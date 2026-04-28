
DROP POLICY IF EXISTS "Admins can manage tabela_preco_itens" ON public.tabela_preco_itens;
CREATE POLICY "Admins can manage tabela_preco_itens" ON public.tabela_preco_itens FOR ALL USING (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Auth can read tabela_preco_itens" ON public.tabela_preco_itens;
CREATE POLICY "Auth can read tabela_preco_itens" ON public.tabela_preco_itens FOR SELECT TO authenticated USING (true);
