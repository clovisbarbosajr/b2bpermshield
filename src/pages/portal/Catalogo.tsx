import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShoppingCart, LayoutGrid, List, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCart } from "@/contexts/CartContext";
import { cartKey } from "@/lib/stock";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getProductPrice, PriceResult } from "@/lib/pricing";
import { catalogCategoryButtons, descendantIds, ancestorChain } from "@/lib/categoryTree";

type Produto = {
  id: string; nome: string; descricao: string | null; preco: number; sku: string;
  imagem_url: string | null; estoque_total: number; estoque_reservado: number;
  unidade_venda: string; quantidade_minima: number; categoria_id: string | null;
  status_produto: string | null;
};
type ProductStatus = { nome: string; permite_comprar: boolean; permite_visualizar: boolean; cor: string | null };
type Categoria = { id: string; nome: string; parent_id: string | null; ordem: number };

const Catalogo = () => {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [variantProductIds, setVariantProductIds] = useState<Set<string>>(new Set());
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // Estado de erro INLINE, com retry. Um toast some em segundos e a tela ficava
  // em "No products found." — que afirma uma coisa FALSA sobre o negocio.
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // Abre em LISTA por padrão (pedido do dono).
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState("default");
  const { addItem, updateQuantity, updatePrice, items: cartItems } = useCart();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const categoryParam = searchParams.get("category");
  const { user, impersonatedCustomer, canPlaceOrders } = useAuth();
  const isViewer = !canPlaceOrders;

  // Calculated prices map: productId -> PriceResult
  const [prices, setPrices] = useState<Record<string, PriceResult>>({});
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, ProductStatus>>({});

  // Fetch clienteId
  useEffect(() => {
    const fetchClienteId = async () => {
      if (impersonatedCustomer?.id) {
        setClienteId(impersonatedCustomer.id);
        return;
      }
      if (!user) return;
      const { data } = await supabase
        .from("clientes")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      setClienteId(data?.id ?? null);
    };
    fetchClienteId();
  }, [user, impersonatedCustomer]);

  // Fetch products (with privacy group filtering) and categories
  useEffect(() => {
    const fetchData = async () => {
      // Privacidade (categoria/produto privado) é imposta no RLS: estas queries já
      // retornam SÓ o que o cliente pode ver. Aqui resta apenas o filtro de STATUS.
      const [prodRes, catRes, statusRes] = await Promise.all([
        supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("ordem").order("nome"),
        supabase.from("product_statuses").select("nome, permite_comprar, permite_visualizar, cor"),
      ]);

      // Variantes DEPOIS dos produtos, e filtradas por eles.
      //
      // Antes era `select("produto_id").eq("ativo", true)` sem filtro nenhum —
      // varredura da tabela inteira. Com a RLS escopada por
      // `cliente_pode_ver_produto` (que roda um CTE recursivo de categoria por
      // linha), isso vira essa funcao pesada executada uma vez POR VARIANTE do
      // catalogo todo. Filtrando pelos produtos que a RLS de `produtos` ja
      // liberou, vira acerto de indice.
      // EM LOTES de 200: `.in()` vai na URL do GET, e mil UUIDs sao ~37 KB — o
      // gateway corta muito antes disso. Sem lote, a request falharia e (pior)
      // o produto COM variante iria pro carrinho SEM variante, com preco base.
      // `prodRes.error` continuava sem checagem: uma falha ali virava catalogo
      // vazio em silencio, e o cliente concluia que a loja nao tem produto.
      if (prodRes.error) {
        console.error(prodRes.error);
        setErroCarga("Could not load the catalog.");
        setLoading(false);
        return;
      }
      const idsVisiveis = (prodRes.data ?? []).map((p: any) => p.id);
      // 100 e nao 200: 200 UUIDs sao ~7,4 KB de URL, contra o buffer de ~8 KB
      // do gateway. Estava dentro da margem do limite que a propria mudanca
      // existe para evitar.
      const LOTE = 100;
      const comVariante = new Set<string>();
      let erroVariantes: any = null;
      for (let i = 0; i < idsVisiveis.length; i += LOTE) {
        const { data, error } = await supabase
          .from("produto_variantes").select("produto_id")
          .eq("ativo", true)
          .in("produto_id", idsVisiveis.slice(i, i + LOTE));
        if (error) { erroVariantes = error; break; }
        (data ?? []).forEach((r: any) => comVariante.add(r.produto_id));
      }
      // FALHA ALTO. Degradar para "nenhum produto tem variante" e deixar o
      // cliente adicionar direto do grid produz PEDIDO ERRADO em silencio — item
      // sem tamanho/cor e com preco do produto-pai. Melhor a tela avisar.
      if (erroVariantes) {
        console.error(erroVariantes);
        setErroCarga("Could not load product options.");
        setLoading(false);
        return;
      }
      // Produtos que têm variante: o "Add" do grid leva pra página do produto (escolher a opção).
      setVariantProductIds(comVariante);

      // Build status map
      const sMap: Record<string, ProductStatus> = {};
      (statusRes.data ?? []).forEach((s: any) => { sMap[s.nome.toLowerCase()] = s; });
      setStatusMap(sMap);

      let allProducts = (prodRes.data as Produto[]) ?? [];
      let cats = (catRes.data as Categoria[]) ?? [];
      // Impersonação ("view as"): a sessão é do admin, então a RLS não escopa. Filtra
      // categorias E produtos pelo que o CLIENTE realmente veria (RPCs staff-gated).
      if (impersonatedCustomer?.id) {
        const [{ data: visCats }, { data: visProds }] = await Promise.all([
          (supabase as any).rpc("categorias_visiveis_cliente", { _cli_id: impersonatedCustomer.id }),
          (supabase as any).rpc("produtos_visiveis_cliente", { _cli_id: impersonatedCustomer.id }),
        ]);
        const okC = new Set<string>(Array.isArray(visCats) ? visCats : []);
        const okP = new Set<string>(Array.isArray(visProds) ? visProds : []);
        cats = cats.filter((c) => okC.has(c.id));
        allProducts = allProducts.filter((p) => okP.has(p.id));
      }
      setCategorias(cats);

      // Esconde produto cujo STATUS tem permite_visualizar = false (antes esse flag era
      // ignorado e o produto aparecia mesmo assim).
      const visMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out", pre_venda: "pre-order", estoque_limitado: "limited stock", descontinuado: "discontinued" };
      const isVisible = (p: Produto) => {
        const sName = ((p as any).status_produto) || "disponivel";
        const st = sMap[(visMap[sName] || sName).toLowerCase()];
        return !(st && st.permite_visualizar === false);
      };

      // Produto de categoria DESATIVADA sai do catálogo. Antes ele aparecia na home
      // (onde não há filtro de categoria) e SUMIA ao clicar na categoria-pai — o
      // mesmo produto estava e não estava à venda, dependendo de onde o cliente
      // clicou. `categorias` já vem filtrada por `ativo = true`, então "categoria
      // que não está na lista" = desativada. Produto SEM categoria continua
      // aparecendo (não está em categoria desativada nenhuma).
      // Só aplica o filtro se a lista de categorias veio de verdade. `cats` vazio
      // (erro na query, timeout) NÃO significa "tudo desativado" — sem esta
      // guarda, uma falha ali esconderia todo produto com categoria e o cliente
      // veria "No products found" com o banco cheio.
      const catsAtivas = new Set(cats.map((c) => c.id));
      const filtraPorCategoria = !catRes.error && cats.length > 0;
      const filtered = allProducts.filter(
        (p) => isVisible(p) && (!filtraPorCategoria || !p.categoria_id || catsAtivas.has(p.categoria_id)),
      );
      setProdutos(filtered);
      setLoading(false);
    };
    fetchData();
  }, [clienteId, tentativa]);

  // Estoque AO VIVO: quando um produto muda (item comprado reserva/baixa), atualiza
  // o disponível na tela sem refresh. Realtime respeita a RLS (só produtos visíveis).
  useEffect(() => {
    const channel = supabase
      .channel("portal-catalogo-estoque")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "produtos" }, (payload) => {
        const n = payload.new as any;
        if (!n?.id) return;
        setProdutos((prev) => prev.map((p) => p.id === n.id
          ? { ...p, estoque_total: n.estoque_total, estoque_reservado: n.estoque_reservado }
          : p));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fetch prices for all products when clienteId and produtos are ready
  useEffect(() => {
    if (!clienteId || produtos.length === 0) return;

    const fetchPrices = async () => {
      try {
        const results = await Promise.all(
          produtos.map((p) =>
            getProductPrice({ productId: p.id, customerId: clienteId })
              .then((r) => ({ id: p.id, result: r }))
              .catch(() => ({ id: p.id, result: { price: p.preco, source: "base" as const } }))
          )
        );
        const map: Record<string, PriceResult> = {};
        for (const r of results) {
          map[r.id] = r.result;
        }
        setPrices(map);
      } catch {
        // fallback: keep base prices
      }
    };
    fetchPrices();
  }, [clienteId, produtos]);

  const getPrice = (p: Produto) => prices[p.id]?.price ?? p.preco;

  // Category hierarchy
  const childrenOf = (parentId: string) => categorias.filter(c => c.parent_id === parentId);

  const selectedCategory = categoryParam ? categorias.find(c => c.id === categoryParam) : null;
  // `descendantIds` e `ancestorChain` têm guarda de ciclo. A recursão e o `while`
  // que existiam aqui não tinham: um `parent_id` circular (o admin permitia criar)
  // estourava a pilha e o portal ficava com a TELA BRANCA, sem ErrorBoundary pra
  // segurar.
  //
  // URL com categoria que não existe mais (desativada, privada, link antigo — o
  // botão "View as" do admin em `Categorias.tsx:376` leva direto a isso):
  // `categoryIds = []` **não casa com nada**. Passar `null` aqui significaria
  // "sem filtro" e despejaria o CATÁLOGO INTEIRO numa tela que diz estar dentro
  // de uma categoria. O aviso abaixo explica o vazio.
  const categoriaInvalida = !!categoryParam && !selectedCategory;
  const categoryIds = selectedCategory
    ? descendantIds(categorias, selectedCategory.id)
    : (categoriaInvalida ? [] : null);
  const breadcrumb: Categoria[] = ancestorChain(categorias, selectedCategory?.id) as Categoria[];

  // Categoria FOLHA passa a mostrar as IRMÃS em vez de nada (regra em
  // catalogCategoryButtons, coberta por teste em src/lib/categoryTree.test.ts).
  const subCategories = catalogCategoryButtons(categorias, categoryParam);

  const filtered = produtos.filter((p) => {
    const matchSearch = !search || p.nome.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryIds || (p.categoria_id && categoryIds.includes(p.categoria_id));
    return matchSearch && matchCat;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name_asc") return a.nome.localeCompare(b.nome);
    if (sortBy === "name_desc") return b.nome.localeCompare(a.nome);
    if (sortBy === "price_asc") return getPrice(a) - getPrice(b);
    if (sortBy === "price_desc") return getPrice(b) - getPrice(a);
    return 0;
  });

  const disponivel = (p: Produto) => p.estoque_total - p.estoque_reservado;

  const getStatusInfo = (p: Produto) => {
    const statusName = p.status_produto || "disponivel";
    // Map old values
    const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out", pre_venda: "pre-order", estoque_limitado: "limited stock", descontinuado: "discontinued" };
    const normalized = (nameMap[statusName] || statusName).toLowerCase();
    return statusMap[normalized] ?? { nome: statusName, permite_comprar: true, permite_visualizar: true, cor: null };
  };

  const canBuy = (p: Produto) => {
    const status = getStatusInfo(p);
    if (!status.permite_comprar) return false;
    // Pre-order allows buying even with 0 stock
    if (getStatusInfo(p).nome.toLowerCase() === "pre-order") return true;
    return disponivel(p) > 0;
  };

  const getStatusLabel = (p: Produto) => {
    const status = getStatusInfo(p);
    return status.nome;
  };

  const isPreOrder = (p: Produto) => getStatusInfo(p).nome.toLowerCase() === "pre-order";
  // Estoque zerado (e não pré-venda) = SOLD OUT automático, independente do status salvo.
  const isSoldOut = (p: Produto) => !isPreOrder(p) && disponivel(p) <= 0;
  // Pílula de status (padrão B2BWave): AVAILABLE / BACKORDER (verde) e SOLD OUT (vermelho).
  const statusPill = (p: Produto): { label: string; cls: string } => {
    const green = "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    const red = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    if (isPreOrder(p)) return { label: "Backorder", cls: green };
    if (isSoldOut(p)) return { label: "Sold Out", cls: red };
    if (!canBuy(p)) return { label: getStatusLabel(p), cls: red };
    return { label: "Available", cls: green };
  };

  // Linha do carrinho para este produto (sem variante — produto com variante vai
  // pra pagina do produto). O catalogo nao indicava que o item JA estava no
  // carrinho: o cliente adicionava de novo e a quantidade dobrava sem ele notar.
  // MESMA formula do CartContext (`addItem` 1a insercao e `updateQuantity`):
  // `max(minimo, min(pedido, disponivel))`. Precisa ser identica, senao a tela
  // calcula um numero e o carrinho grava outro — ex.: minimo 10 com 4 em estoque,
  // a tela dizia 4 e o carrinho gravava 10.
  const clampQty = (qtd: number, min?: number | null, avail?: number | null) => {
    const piso = Math.max(min ?? 1, 1);
    const teto = (typeof avail === "number" && avail > 0) ? Math.min(qtd, avail) : qtd;
    return Math.max(piso, teto);
  };

  const noCarrinho = (p: Produto) => cartItems.find((i: any) => i.produto_id === p.id && !i.variante_id);

  // Quantidade escolhida por produto no grid/lista. Se o produto JA esta no
  // carrinho, o campo mostra a quantidade que esta la (igual ao B2BWave), e nao
  // o minimo — assim o botao "Update quantity" faz o que diz.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  // Produtos com clique em andamento (ver `handleAdd`).
  const addingRef = useRef<Set<string>>(new Set());
  const qtyOf = (p: Produto) => qtys[p.id] ?? noCarrinho(p)?.quantidade ?? Math.max(p.quantidade_minima || 1, 1);
  const setQty = (p: Produto, v: number) => {
    const min = Math.max(p.quantidade_minima || 1, 1);
    setQtys((prev) => ({ ...prev, [p.id]: Math.max(min, Math.floor(v) || min) }));
  };

  const handleAdd = async (p: Produto) => {
    if (!canBuy(p)) return;
    // Clique duplo rapido: no MESMO tick o `cartItems` ainda nao refletiu o
    // primeiro clique, entao os dois caiam no ramo de INSERCAO e o `addItem`
    // SOMAVA — quantidade dobrada sem o cliente pedir, e a guarda do
    // `updatePrice` descartava a correcao de preco em silencio.
    if (addingRef.current.has(p.id)) return;
    addingRef.current.add(p.id);
    setTimeout(() => addingRef.current.delete(p.id), 400);
    // Ja esta no carrinho: DEFINE a quantidade (nao soma). Somar era o
    // comportamento antigo e fazia o total dobrar a cada clique.
    const jaNoCarrinho = noCarrinho(p);
    if (jaNoCarrinho && !variantProductIds.has(p.id)) {
      // O `updateQuantity` CLAMPA por estoque e minimo. Sem repetir o clamp aqui, o
      // aviso dizia "updated to 50" com 5 no carrinho, e o campo continuava exibindo
      // 50 pra sempre (o `qtys` nunca era limpo) — tela e carrinho discordando.
      const alvo = qtyOf(p);
      const nova = clampQty(alvo, jaNoCarrinho.quantidade_minima, jaNoCarrinho.estoque_disponivel);
      const chave = cartKey(jaNoCarrinho);
      updateQuantity(chave, nova);
      // Limpa o valor digitado: o campo volta a ESPELHAR o carrinho.
      setQtys((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
      // O clamp pode CORTAR (estoque) ou SUBIR (quantidade minima) — a mensagem
      // precisa dizer qual dos dois, senao "only 5 available" aparecia quando o
      // pedido minimo ELEVOU a quantidade.
      if (nova === alvo) toast.success(`${p.nome} updated to ${nova}`);
      else if (nova < alvo) toast.warning(`${p.nome}: only ${nova} available — quantity set to ${nova}`);
      else toast.warning(`${p.nome}: minimum order is ${nova} — quantity set to ${nova}`);
      // Mudar a quantidade pode cruzar faixa de desconto. Recalcula em segundo plano
      // (o Checkout recalcula de novo na finalizacao; isto e so pra o carrinho ja
      // mostrar o preco certo).
      if (clienteId) {
        getProductPrice({ productId: p.id, customerId: clienteId, quantity: nova })
          .then((r) => { if (typeof r?.price === "number") updatePrice(chave, r.price, nova); })
          .catch(() => {});
      }
      return;
    }
    // Produto com variante: não dá pra escolher a opção no grid → manda pra página do produto.
    if (variantProductIds.has(p.id)) {
      navigate(`/portal/produto/${p.id}`);
      return;
    }
    // Preço $0 (não configurado / "contact us") PODE ser adicionado ao carrinho — o
    // vendedor ajusta o preço depois. (Sem trava de preço zero aqui.)
    const preOrder = isPreOrder(p);
    const pedido = qtyOf(p);
    // Clampa AQUI com a mesma regra do `addItem`. Sem isto: o toast dizia "50 ×"
    // com 10 no carrinho, o campo seguia mostrando 50, e a guarda do `updatePrice`
    // (que compara com a quantidade real da linha) bloqueava a correcao de preco —
    // a linha ficava com o preco de 1 unidade, em silencio.
    const qty = clampQty(pedido, p.quantidade_minima, preOrder ? 0 : disponivel(p));
    const item = {
      produto_id: p.id, nome: p.nome, sku: p.sku, preco: getPrice(p),
      quantidade: qty, unidade_venda: p.unidade_venda,
      quantidade_minima: p.quantidade_minima, estoque_disponivel: preOrder ? 999999 : disponivel(p),
      imagem_url: p.imagem_url,
    };
    // Entra no carrinho NA HORA, com o preço da vitrine. Antes esta função
    // ESPERAVA o `getProductPrice` (até 5 idas ao banco) ANTES de adicionar e antes
    // do aviso — em conexão ruim o cliente clicava e ficava quase um minuto sem
    // ver nada acontecer, achando que o botão não pegou.
    addItem(item);
    // Campo volta a espelhar o carrinho (igual ao ramo de update).
    setQtys((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
    if (qty === pedido) toast.success(`${qty} × ${p.nome} ${preOrder ? "added as back order" : "added to cart"}`);
    else if (qty < pedido) toast.warning(`${p.nome}: only ${qty} available — added ${qty}`);
    else toast.warning(`${p.nome}: minimum order is ${qty} — added ${qty}`);

    // O preço da vitrine é calculado com quantidade 1. A faixa de desconto por
    // quantidade só aparece com a quantidade REAL — então recalcula EM SEGUNDO
    // PLANO e corrige a linha se mudar. O checkout recalcula de novo na
    // finalização (é ele quem manda), isto é só pra o carrinho já mostrar certo.
    if (clienteId) {
      getProductPrice({ productId: p.id, customerId: clienteId, quantity: qty })
        .then((r) => {
          if (typeof r?.price === "number" && r.price !== item.preco) {
            updatePrice(cartKey(item), r.price, qty);
          }
        })
        .catch(() => { /* mantém o preço da vitrine */ });
    }
  };

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button onClick={() => navigate("/portal/catalogo")} className="hover:text-primary">
          Home
        </button>
        {breadcrumb.map((bc) => (
          <span key={bc.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button onClick={() => navigate(`/portal/catalogo?category=${bc.id}`)} className="hover:text-primary">
              {bc.nome}
            </button>
          </span>
        ))}
      </div>

      {/* Category tabs */}
      {subCategories.length > 0 && !search && (
        <div className="mb-4 flex flex-wrap gap-2">
          {subCategories.map(cat => (
            <Button
              key={cat.id}
              variant={categoryParam === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => navigate(`/portal/catalogo?category=${cat.id}`)}
              className="gap-1"
            >
              {cat.nome}
              {childrenOf(cat.id).length > 0 && <ChevronRight className="h-3 w-3" />}
            </Button>
          ))}
        </div>
      )}

      {/* Title + controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-semibold">
            {selectedCategory ? selectedCategory.nome : "Product Catalog"}
          </h2>
          {/* Guard em `selectedCategory`, não em `categoryParam`: com o param cru a
              frase renderizava "…sub-categories in " e terminava no nada. */}
          {selectedCategory && (
            <p className="text-sm text-muted-foreground mt-1">
              You are currently browsing products and sub-categories in {selectedCategory.nome}
            </p>
          )}
          {categoriaInvalida && (
            <p className="text-sm text-destructive mt-1">
              This category is no longer available. <button onClick={() => navigate("/portal/catalogo")} className="underline">See the full catalog</button>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Sort by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="name_asc">Name A-Z</SelectItem>
              <SelectItem value="name_desc">Name Z-A</SelectItem>
              <SelectItem value="price_asc">Price Low-High</SelectItem>
              <SelectItem value="price_desc">Price High-Low</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" className="h-9 gap-1" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4" /> List
            </Button>
            <Button variant={viewMode === "grid" ? "default" : "outline"} size="sm" className="h-9 gap-1" onClick={() => setViewMode("grid")}>
              <LayoutGrid className="h-4 w-4" /> Photos
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        erroCarga ? (
          // NUNCA dizer "No products found" quando a carga falhou: isso afirma
          // algo falso sobre o negocio e o cliente vai embora achando que a loja
          // esta vazia.
          <div className="py-20 text-center">
            <p className="text-destructive font-medium">{erroCarga}</p>
            <p className="text-sm text-muted-foreground mt-1">
              This is a loading problem, not an empty catalog.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => { setErroCarga(null); setLoading(true); setTentativa((t) => t + 1); }}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="py-20 text-center text-muted-foreground">No products found.</div>
        )
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((p) => (
            <Card key={p.id} className="overflow-hidden transition-all hover:shadow-md cursor-pointer" onClick={() => navigate(`/portal/produto/${p.id}`)}>
              <div className="h-40 bg-muted flex items-center justify-center">
                {p.imagem_url ? (
                  <img src={p.imagem_url} alt={p.nome} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-4xl font-bold text-muted-foreground/30">{p.nome.charAt(0)}</div>
                )}
              </div>
              <CardContent className="p-3">
                <h3 className="font-semibold text-sm line-clamp-2">{p.nome}</h3>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-base font-bold text-accent">${getPrice(p).toFixed(2)}</p>
                  {isSoldOut(p) ? (
                    <Badge variant="destructive" className="text-xs">Sold Out</Badge>
                  ) : !canBuy(p) ? (
                    <Badge variant="destructive" className="text-xs">{getStatusLabel(p)}</Badge>
                  ) : isPreOrder(p) ? (
                    <Badge className="text-xs bg-blue-600">Pre-order</Badge>
                  ) : (
                    <Badge className="text-xs bg-green-600 hover:bg-green-600">In stock</Badge>
                  )}
                </div>
                {/* Estoque disponível (verde quando tem, vermelho quando zerado) */}
                <p className="mt-1 text-xs">
                  {isPreOrder(p)
                    ? <span className="text-muted-foreground">Pre-order</span>
                    : disponivel(p) > 0
                      ? <span className="font-semibold text-green-600">Available: {disponivel(p)} {p.unidade_venda}</span>
                      : <span className="font-semibold text-destructive">Sold Out</span>}
                </p>
                {/* Quantidade + adicionar (produto com variante vai pra página do produto) */}
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {!variantProductIds.has(p.id) && (
                    <Input type="number" min={Math.max(p.quantidade_minima || 1, 1)}
                      max={isPreOrder(p) || disponivel(p) <= 0 ? undefined : Math.max(disponivel(p), Math.max(p.quantidade_minima || 1, 1))}
                      value={qtyOf(p)}
                      disabled={!canBuy(p) || isViewer}
                      onChange={(e) => setQty(p, parseInt(e.target.value))}
                      className="h-9 w-20 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  )}
                  <Button className={`flex-1 gap-2 h-9 ${noCarrinho(p) ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                    size="sm" disabled={!canBuy(p) || isViewer} onClick={(e) => { e.stopPropagation(); handleAdd(p); }}>
                    <ShoppingCart className="h-4 w-4" />
                    {noCarrinho(p) ? "Update quantity" : (getStatusInfo(p).nome.toLowerCase() === "pre-order" ? "Back Order" : "Add to Cart")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Min. Quantity</TableHead>
                <TableHead className="text-center">Available Quantity</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Quantity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => {
                const st = statusPill(p);
                return (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/portal/produto/${p.id}`)}>
                    <TableCell onClick={(e) => { e.stopPropagation(); navigate(`/portal/produto/${p.id}`); }}>
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 flex-shrink-0 bg-muted rounded flex items-center justify-center overflow-hidden">
                          {p.imagem_url ? (
                            <img src={p.imagem_url} alt={p.nome} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold text-muted-foreground/30">{p.nome.charAt(0)}</span>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">{p.sku || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right font-semibold text-accent">${getPrice(p).toFixed(2)}</TableCell>
                    <TableCell className="text-center">{p.quantidade_minima || 0}</TableCell>
                    <TableCell className="text-center">
                      {isPreOrder(p)
                        ? <span className="text-muted-foreground">—</span>
                        : <span className={disponivel(p) > 0 ? "font-semibold text-green-600" : "font-semibold text-destructive"}>{Math.max(disponivel(p), 0)}</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      {canBuy(p) && !isViewer && !variantProductIds.has(p.id) ? (
                        <Input type="number" min={Math.max(p.quantidade_minima || 1, 1)}
                          max={isPreOrder(p) || disponivel(p) <= 0 ? undefined : Math.max(disponivel(p), Math.max(p.quantidade_minima || 1, 1))}
                          value={qtyOf(p)}
                          onChange={(e) => setQty(p, parseInt(e.target.value))}
                          className="h-9 w-20 mx-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {/* Ja no carrinho -> botao VERDE "Update quantity" (padrao B2BWave).
                          Antes nada indicava que o item ja estava la e o cliente somava
                          sem perceber. */}
                      <Button size="sm"
                        className={`gap-1 whitespace-nowrap ${noCarrinho(p) ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                        disabled={!canBuy(p) || isViewer} onClick={() => handleAdd(p)}>
                        <ShoppingCart className="h-4 w-4" />
                        {noCarrinho(p) ? "Update quantity" : (isPreOrder(p) ? "Back Order" : "Add to order")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        {sorted.length} product{sorted.length !== 1 ? "s" : ""} found
      </p>
    </PortalLayout>
  );
};

export default Catalogo;
