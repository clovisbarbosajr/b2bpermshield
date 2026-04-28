
-- 1. Add parent_id to categorias for hierarchical categories
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categorias(id) ON DELETE SET NULL;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- 2. Price Lists
CREATE TABLE public.tabelas_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tabelas_preco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tabelas_preco" ON public.tabelas_preco FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read active tabelas_preco" ON public.tabelas_preco FOR SELECT TO authenticated USING (ativo = true);

CREATE TABLE public.tabela_preco_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_preco_id uuid NOT NULL REFERENCES public.tabelas_preco(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tabela_preco_id, produto_id)
);
ALTER TABLE public.tabela_preco_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tabela_preco_itens" ON public.tabela_preco_itens FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read tabela_preco_itens" ON public.tabela_preco_itens FOR SELECT TO authenticated USING (true);

-- Link clients to price lists
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS tabela_preco_id uuid REFERENCES public.tabelas_preco(id) ON DELETE SET NULL;

-- 3. Sales Reps
CREATE TABLE public.representantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text NOT NULL,
  telefone text,
  comissao_percentual numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.representantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage representantes" ON public.representantes FOR ALL TO public USING (has_role(auth.uid(), 'admin'));

-- Link clients to sales reps
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS representante_id uuid REFERENCES public.representantes(id) ON DELETE SET NULL;

-- 4. News / Banners
CREATE TABLE public.noticias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  conteudo text,
  imagem_url text,
  ativo boolean NOT NULL DEFAULT true,
  destaque boolean NOT NULL DEFAULT false,
  publicado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.noticias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage noticias" ON public.noticias FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read active noticias" ON public.noticias FOR SELECT TO authenticated USING (ativo = true);

-- 5. Static Pages
CREATE TABLE public.paginas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  slug text NOT NULL UNIQUE,
  conteudo text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paginas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage paginas" ON public.paginas FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can read active paginas" ON public.paginas FOR SELECT TO authenticated USING (ativo = true);

-- 6. Company Settings (single-row config)
CREATE TABLE public.configuracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa text NOT NULL DEFAULT '',
  logo_url text,
  email_contato text,
  telefone_contato text,
  endereco text,
  moeda text NOT NULL DEFAULT 'BRL',
  fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo',
  pedido_minimo numeric NOT NULL DEFAULT 0,
  permite_cadastro_aberto boolean NOT NULL DEFAULT true,
  mensagem_boas_vindas text,
  termos_condicoes text,
  politica_privacidade text,
  cor_primaria text,
  cor_secundaria text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage configuracoes" ON public.configuracoes FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can read configuracoes" ON public.configuracoes FOR SELECT TO authenticated USING (true);

-- Insert default config row
INSERT INTO public.configuracoes (nome_empresa) VALUES ('PermShield');

-- 7. Updated_at triggers for new tables
CREATE TRIGGER set_updated_at_tabelas_preco BEFORE UPDATE ON public.tabelas_preco FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_representantes BEFORE UPDATE ON public.representantes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_noticias BEFORE UPDATE ON public.noticias FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_paginas BEFORE UPDATE ON public.paginas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_configuracoes BEFORE UPDATE ON public.configuracoes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
