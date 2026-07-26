import { useState, useEffect } from "react";
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
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getProductPrice, PriceResult } from "@/lib/pricing";

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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // Abre em LISTA por padrão (pedido do dono).
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState("default");
  const { addItem } = useCart();
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
      const [prodRes, catRes, statusRes, variantRes] = await Promise.all([
        supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("ordem").order("nome"),
        supabase.from("product_statuses").select("nome, permite_comprar, permite_visualizar, cor"),
        supabase.from("produto_variantes").select("produto_id").eq("ativo", true),
      ]);
      // Produtos que têm variante: o "Add" do grid leva pra página do produto (escolher a opção).
      setVariantProductIds(new Set((variantRes.data ?? []).map((r: any) => r.produto_id)));

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

      const filtered = allProducts.filter(isVisible);
      setProdutos(filtered);
      setLoading(false);
    };
    fetchData();
  }, [clienteId]);

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
  const rootCats = categorias.filter(c => !c.parent_id);
  const childrenOf = (parentId: string) => categorias.filter(c => c.parent_id === parentId);

  const getDescendantIds = (catId: string): string[] => {
    const children = childrenOf(catId);
    return [catId, ...children.flatMap(c => getDescendantIds(c.id))];
  };

  const selectedCategory = categoryParam ? categorias.find(c => c.id === categoryParam) : null;
  const categoryIds = categoryParam ? getDescendantIds(categoryParam) : null;

  // Breadcrumb
  const breadcrumb: Categoria[] = [];
  if (selectedCategory) {
    let current: Categoria | undefined = selectedCategory;
    while (current) {
      breadcrumb.unshift(current);
      current = current.parent_id ? categorias.find(c => c.id === current!.parent_id) : undefined;
    }
  }

  const subCategories = categoryParam ? childrenOf(categoryParam) : rootCats;

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

  // Quantidade escolhida por produto no grid/lista (default = quantidade mínima).
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const qtyOf = (p: Produto) => qtys[p.id] ?? Math.max(p.quantidade_minima || 1, 1);
  const setQty = (p: Produto, v: number) => {
    const min = Math.max(p.quantidade_minima || 1, 1);
    setQtys((prev) => ({ ...prev, [p.id]: Math.max(min, Math.floor(v) || min) }));
  };

  const handleAdd = async (p: Produto) => {
    if (!canBuy(p)) return;
    // Produto com variante: não dá pra escolher a opção no grid → manda pra página do produto.
    if (variantProductIds.has(p.id)) {
      navigate(`/portal/produto/${p.id}`);
      return;
    }
    // Preço da VITRINE é calculado com quantidade 1; ao adicionar, recalcula com a
    // quantidade REAL pra pegar as faixas de desconto por quantidade. Sem isto o
    // carrinho mostrava o preço de 1 unidade e o checkout (que recalcula na
    // finalização) cobrava outro valor — cliente via um preço e pagava outro.
    let calculatedPrice = getPrice(p);
    if (clienteId) {
      try {
        const r = await getProductPrice({ productId: p.id, customerId: clienteId, quantity: qtyOf(p) });
        if (typeof r?.price === "number") calculatedPrice = r.price;
      } catch { /* mantém o preço da vitrine */ }
    }
    // Preço $0 (não configurado / "contact us") PODE ser adicionado ao carrinho — o
    // vendedor ajusta o preço depois. (Sem trava de preço zero aqui.)
    const isPreOrder = getStatusInfo(p).nome.toLowerCase() === "pre-order";
    const qty = qtyOf(p);
    addItem({
      produto_id: p.id, nome: p.nome, sku: p.sku, preco: calculatedPrice,
      quantidade: qty, unidade_venda: p.unidade_venda,
      quantidade_minima: p.quantidade_minima, estoque_disponivel: isPreOrder ? 999999 : disponivel(p),
      imagem_url: p.imagem_url,
    });
    toast.success(`${qty} × ${p.nome} ${isPreOrder ? "added as back order" : "added to cart"}`);
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
          {categoryParam && (
            <p className="text-sm text-muted-foreground mt-1">
              You are currently browsing products and sub-categories in {selectedCategory?.nome}
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
        <div className="py-20 text-center text-muted-foreground">No products found.</div>
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
                    <Input type="number" min={Math.max(p.quantidade_minima || 1, 1)} value={qtyOf(p)}
                      disabled={!canBuy(p) || isViewer}
                      onChange={(e) => setQty(p, parseInt(e.target.value))}
                      className="h-9 w-20 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  )}
                  <Button className="flex-1 gap-2 h-9" size="sm" disabled={!canBuy(p) || isViewer} onClick={(e) => { e.stopPropagation(); handleAdd(p); }}>
                    <ShoppingCart className="h-4 w-4" /> {getStatusInfo(p).nome.toLowerCase() === "pre-order" ? "Back Order" : "Add to Cart"}
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
                        <Input type="number" min={Math.max(p.quantidade_minima || 1, 1)} value={qtyOf(p)}
                          onChange={(e) => setQty(p, parseInt(e.target.value))}
                          className="h-9 w-20 mx-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" className="gap-1 whitespace-nowrap" disabled={!canBuy(p) || isViewer} onClick={() => handleAdd(p)}>
                        <ShoppingCart className="h-4 w-4" /> {isPreOrder(p) ? "Back Order" : "Add to order"}
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
