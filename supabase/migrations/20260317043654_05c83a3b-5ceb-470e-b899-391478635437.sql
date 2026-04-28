
-- Enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'cliente');

-- Enum for order status
CREATE TYPE public.pedido_status AS ENUM ('recebido', 'em_processamento', 'enviado', 'concluido', 'cancelado');

-- Enum for client status
CREATE TYPE public.cliente_status AS ENUM ('ativo', 'inativo', 'pendente');

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- User roles table (separate from profiles per security guidelines)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telefone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Categorias
CREATE TABLE public.categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

-- Clientes (empresa B2B)
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome TEXT NOT NULL,
  empresa TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  telefone TEXT,
  status cliente_status NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- Enderecos
CREATE TABLE public.enderecos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  logradouro TEXT NOT NULL,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT NOT NULL,
  estado TEXT NOT NULL,
  cep TEXT NOT NULL,
  principal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.enderecos ENABLE ROW LEVEL SECURITY;

-- Produtos
CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  preco NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estoque_total INTEGER NOT NULL DEFAULT 0,
  estoque_reservado INTEGER NOT NULL DEFAULT 0,
  quantidade_minima INTEGER NOT NULL DEFAULT 1,
  unidade_venda TEXT NOT NULL DEFAULT 'un',
  imagem_url TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

-- Pedidos
CREATE TABLE public.pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero SERIAL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  status pedido_status NOT NULL DEFAULT 'recebido',
  observacoes TEXT,
  endereco_entrega_id UUID REFERENCES public.enderecos(id),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

-- Pedido Itens
CREATE TABLE public.pedido_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES public.pedidos(id) ON DELETE CASCADE NOT NULL,
  produto_id UUID REFERENCES public.produtos(id) NOT NULL,
  sku TEXT NOT NULL,
  nome_produto TEXT NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;

-- Estoque Log (history)
CREATE TABLE public.estoque_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID REFERENCES public.produtos(id) ON DELETE CASCADE NOT NULL,
  quantidade_anterior INTEGER NOT NULL,
  quantidade_nova INTEGER NOT NULL,
  motivo TEXT,
  usuario_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.estoque_log ENABLE ROW LEVEL SECURITY;

-- ============ RLS POLICIES ============

-- user_roles: users can read their own, admins can read all
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- profiles
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- categorias: authenticated can read, admins can manage
CREATE POLICY "Authenticated can read categorias" ON public.categorias
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage categorias" ON public.categorias
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- clientes
CREATE POLICY "Clients can read own data" ON public.clientes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Clients can update own data" ON public.clientes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage clientes" ON public.clientes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- enderecos
CREATE POLICY "Clients can manage own enderecos" ON public.enderecos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.clientes WHERE id = enderecos.cliente_id AND user_id = auth.uid())
  );
CREATE POLICY "Admins can manage enderecos" ON public.enderecos
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- produtos: authenticated can read, admins can manage
CREATE POLICY "Authenticated can read produtos" ON public.produtos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage produtos" ON public.produtos
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- pedidos
CREATE POLICY "Clients can read own pedidos" ON public.pedidos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.clientes WHERE id = pedidos.cliente_id AND user_id = auth.uid())
  );
CREATE POLICY "Clients can insert pedidos" ON public.pedidos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.clientes WHERE id = pedidos.cliente_id AND user_id = auth.uid())
  );
CREATE POLICY "Admins can manage pedidos" ON public.pedidos
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- pedido_itens
CREATE POLICY "Clients can read own pedido_itens" ON public.pedido_itens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      JOIN public.clientes c ON c.id = p.cliente_id
      WHERE p.id = pedido_itens.pedido_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Clients can insert pedido_itens" ON public.pedido_itens
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      JOIN public.clientes c ON c.id = p.cliente_id
      WHERE p.id = pedido_itens.pedido_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Admins can manage pedido_itens" ON public.pedido_itens
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- estoque_log
CREATE POLICY "Admins can manage estoque_log" ON public.estoque_log
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGERS ============
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_categorias_updated_at BEFORE UPDATE ON public.categorias FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_enderecos_updated_at BEFORE UPDATE ON public.enderecos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_produtos_updated_at BEFORE UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pedidos_updated_at BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', ''), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
