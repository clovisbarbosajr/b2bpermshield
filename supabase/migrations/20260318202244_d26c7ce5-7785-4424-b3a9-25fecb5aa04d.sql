
-- Add all missing product fields from B2B Wave
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS peso numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS comprimento numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS largura numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS altura numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS custo numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS preco_msrp numeric DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS quantidade_maxima integer DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS rastrear_estoque boolean DEFAULT true;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS permitir_backorder boolean DEFAULT false;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS quantidade_caixa integer DEFAULT 0;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS codigo_upc text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS codigo_referencia text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS quantidade_pacote integer;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS meta_descricao text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS descricao_pdf text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS promover_categoria boolean DEFAULT false;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS promover_destaque boolean DEFAULT false;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS mostrar_ofertas text DEFAULT 'nunca';
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS data_disponibilidade timestamp with time zone;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS unidade_medida_id uuid REFERENCES product_options(id);
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS status_produto text DEFAULT 'disponivel';
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS tag_line text;

-- Product images gallery table
CREATE TABLE IF NOT EXISTS public.produto_imagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  imagem_url text NOT NULL,
  ordem integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_imagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_imagens" ON public.produto_imagens FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_imagens" ON public.produto_imagens FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produto_imagens" ON public.produto_imagens FOR SELECT TO authenticated USING (true);

-- Product files table
CREATE TABLE IF NOT EXISTS public.produto_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  arquivo_url text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_arquivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_arquivos" ON public.produto_arquivos FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_arquivos" ON public.produto_arquivos FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produto_arquivos" ON public.produto_arquivos FOR SELECT TO authenticated USING (true);

-- Product discounts table
CREATE TABLE IF NOT EXISTS public.produto_descontos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tabela_preco_id uuid NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  percentual numeric DEFAULT 0,
  preco_final numeric,
  quantidade_minima integer DEFAULT 0,
  data_inicio timestamp with time zone,
  data_fim timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_descontos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_descontos" ON public.produto_descontos FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_descontos" ON public.produto_descontos FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produto_descontos" ON public.produto_descontos FOR SELECT TO authenticated USING (true);

-- Customer-specific prices table
CREATE TABLE IF NOT EXISTS public.produto_precos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  preco numeric NOT NULL DEFAULT 0,
  aplicar_descontos_extras boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_precos_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_precos_cliente" ON public.produto_precos_cliente FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_precos_cliente" ON public.produto_precos_cliente FOR SELECT TO anon USING (true);

-- Related/bundled products table
CREATE TABLE IF NOT EXISTS public.produtos_relacionados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_relacionado_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  comprar_junto boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produtos_relacionados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produtos_relacionados" ON public.produtos_relacionados FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produtos_relacionados" ON public.produtos_relacionados FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produtos_relacionados" ON public.produtos_relacionados FOR SELECT TO authenticated USING (true);

-- Product-option assignment table
CREATE TABLE IF NOT EXISTS public.produto_opcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_opcoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_opcoes" ON public.produto_opcoes FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_opcoes" ON public.produto_opcoes FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produto_opcoes" ON public.produto_opcoes FOR SELECT TO authenticated USING (true);

-- Product variants table (code & price variants)
CREATE TABLE IF NOT EXISTS public.produto_variantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  ativo boolean DEFAULT true,
  quantidade integer DEFAULT 0,
  imagem_url text,
  valores_opcao jsonb DEFAULT '[]',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_variantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_variantes" ON public.produto_variantes FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read produto_variantes" ON public.produto_variantes FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read produto_variantes" ON public.produto_variantes FOR SELECT TO authenticated USING (true);

-- Variant prices per price list
CREATE TABLE IF NOT EXISTS public.variante_precos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variante_id uuid NOT NULL REFERENCES produto_variantes(id) ON DELETE CASCADE,
  tabela_preco_id uuid NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  preco numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.variante_precos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage variante_precos" ON public.variante_precos FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can read variante_precos" ON public.variante_precos FOR SELECT TO anon USING (true);

-- Product status rules table
CREATE TABLE IF NOT EXISTS public.produto_status_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  status_nome text NOT NULL,
  regra_tipo text NOT NULL DEFAULT 'quantidade',
  valor_limite integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_status_regras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_status_regras" ON public.produto_status_regras FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Product access/privacy groups
CREATE TABLE IF NOT EXISTS public.produto_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  grupo_nome text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.produto_acesso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage produto_acesso" ON public.produto_acesso FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
