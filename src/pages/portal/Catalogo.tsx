import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ShoppingCart, LayoutGrid, List, FileText, ChevronRight } from "lucide-react";
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
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState("default");
  const { addItem } = useCart();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const categoryParam = searchParams.get("category");
  const { user, impersonatedCustomer, contactRole } = useAuth();
  const isViewer = contactRole === "viewer";

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
      const [prodRes, catRes, acessoRes, statusRes] = await Promise.all([
        supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("ordem").order("nome"),
        supabase.from("produto_acesso").select("produto_id, grupo_nome"),
        supabase.from("product_statuses").select("nome, permite_comprar, permite_visualizar, cor"),
      ]);

      // Build status map
      const sMap: Record<string, ProductStatus> = {};
      (statusRes.data ?? []).forEach((s: any) => { sMap[s.nome.toLowerCase()] = s; });
      setStatusMap(sMap);

      const allProducts = (prodRes.data as Produto[]) ?? [];
      const acessoRows = acessoRes.data ?? [];
      setCategorias((catRes.data as Categoria[]) ?? []);

      // Build map: productId -> set of privacy_group_id that can see it
      const restrictedProducts = new Map<string, Set<string>>();
      for (const row of acessoRows) {
        if (!(row as any).grupo_nome) continue;
        if (!restrictedProducts.has((row as any).produto_id)) {
          restrictedProducts.set((row as any).produto_id, new Set());
        }
        restrictedProducts.get((row as any).produto_id)!.add((row as any).grupo_nome);
      }

      // Get client's privacy group IDs
      let clientGroupIds: string[] = [];
      if (clienteId) {
        const { data: cpg } = await supabase
          .from("cliente_privacy_groups")
          .select("privacy_group_id")
          .eq("cliente_id", clienteId);
        clientGroupIds = (cpg ?? []).map((r) => r.privacy_group_id);
      }

      // Filter: show product if it has NO restriction, or client belongs to at least one of its groups
      const filtered = allProducts.filter((p) => {
        const required = restrictedProducts.get(p.id);
        if (!required || required.size === 0) return true; // no restriction
        return clientGroupIds.some((id) => required.has(id));
      });

      setProdutos(filtered);
      setLoading(false);
    };
    fetchData();
  }, [clienteId]);

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
    const matchSearch = !search || p.nome.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
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
    const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out" };
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

  const handleAdd = (p: Produto) => {
    if (!canBuy(p)) return;
    const calculatedPrice = getPrice(p);
    const isPreOrder = getStatusInfo(p).nome.toLowerCase() === "pre-order";
    addItem({
      produto_id: p.id, nome: p.nome, sku: p.sku, preco: calculatedPrice,
      quantidade: p.quantidade_minima, unidade_venda: p.unidade_venda,
      quantidade_minima: p.quantidade_minima, estoque_disponivel: isPreOrder ? 999999 : disponivel(p),
      imagem_url: p.imagem_url,
    });
    toast.success(`${p.nome} ${isPreOrder ? "added as back order" : "added to cart"}`);
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
            <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("grid")}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* PDF Catalog button */}
      {categoryParam && (
        <div className="mb-4">
          <Button variant="outline" className="gap-2" size="sm">
            <FileText className="h-4 w-4" /> PDF CATALOG
          </Button>
        </div>
      )}

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
              <div className="aspect-square bg-muted flex items-center justify-center">
                {p.imagem_url ? (
                  <img src={p.imagem_url} alt={p.nome} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-4xl font-bold text-muted-foreground/30">{p.nome.charAt(0)}</div>
                )}
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold line-clamp-2">{p.nome}</h3>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-lg font-bold text-accent">${getPrice(p).toFixed(2)}</p>
                  {!canBuy(p) && (
                    <Badge variant="destructive" className="text-xs">{getStatusLabel(p)}</Badge>
                  )}
                  {canBuy(p) && getStatusInfo(p).nome.toLowerCase() === "pre-order" && (
                    <Badge className="text-xs bg-blue-600">Pre-order</Badge>
                  )}
                </div>
                <Button className="mt-3 w-full gap-2 h-9" size="sm" disabled={!canBuy(p) || isViewer} onClick={(e) => { e.stopPropagation(); handleAdd(p); }}>
                  <ShoppingCart className="h-4 w-4" /> {getStatusInfo(p).nome.toLowerCase() === "pre-order" ? "Back Order" : "Add to Cart"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="divide-y">
            {sorted.map((p) => (
              <div key={p.id} className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/portal/produto/${p.id}`)}>
                <div className="h-16 w-16 flex-shrink-0 bg-muted rounded flex items-center justify-center overflow-hidden">
                  {p.imagem_url ? (
                    <img src={p.imagem_url} alt={p.nome} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-muted-foreground/30">{p.nome.charAt(0)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{p.nome}</h3>
                  <p className="text-xs text-muted-foreground">{p.sku}</p>
                </div>
                <p className="text-lg font-bold text-accent">${getPrice(p).toFixed(2)}</p>
                {!canBuy(p) && <Badge variant="destructive" className="text-xs">{getStatusLabel(p)}</Badge>}
                <Button size="sm" className="gap-1" disabled={!canBuy(p) || isViewer} onClick={(e) => { e.stopPropagation(); handleAdd(p); }}>
                  <ShoppingCart className="h-4 w-4" /> {getStatusInfo(p).nome.toLowerCase() === "pre-order" ? "Back Order" : "Add"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        {sorted.length} product{sorted.length !== 1 ? "s" : ""} found
      </p>
    </PortalLayout>
  );
};

export default Catalogo;
