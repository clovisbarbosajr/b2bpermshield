import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { getProductPrice } from "@/lib/pricing";

type Produto = {
  id: string; nome: string; descricao: string | null; preco: number; sku: string;
  imagem_url: string | null; estoque_total: number; estoque_reservado: number;
  unidade_venda: string; quantidade_minima: number; categoria_id: string | null;
  status_produto: string | null;
};

type Categoria = { id: string; nome: string; parent_id: string | null };

const ProdutoDetalhe = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { user, impersonatedCustomer } = useAuth();
  const [produto, setProduto] = useState<Produto | null>(null);
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [quantidade, setQuantidade] = useState(1);
  const [loading, setLoading] = useState(true);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<{ permite_comprar: boolean; nome: string } | null>(null);

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

  // Fetch product data
  useEffect(() => {
    const fetchData = async () => {
      const [prodRes, catsRes, statusesRes] = await Promise.all([
        supabase.from("produtos").select("*").eq("id", id).single(),
        supabase.from("categorias").select("id, nome, parent_id"),
        supabase.from("product_statuses").select("nome, permite_comprar"),
      ]);
      const p = prodRes.data;
      if (p) {
        setProduto(p as Produto);
        setQuantidade(Math.max(p.quantidade_minima || 1, 1));
        if (p.categoria_id) {
          const { data: cat } = await supabase.from("categorias").select("id, nome, parent_id").eq("id", p.categoria_id).single();
          if (cat) setCategoria(cat as Categoria);
        }
        // Resolve status
        const statusName = (p as any).status_produto || "disponivel";
        const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out" };
        const normalized = (nameMap[statusName] || statusName).toLowerCase();
        const matched = (statusesRes.data ?? []).find((s: any) => s.nome.toLowerCase() === normalized);
        setStatusInfo(matched ? { permite_comprar: matched.permite_comprar ?? true, nome: matched.nome } : { permite_comprar: true, nome: statusName });
      }
      setCategorias((catsRes.data as Categoria[]) ?? []);
      setLoading(false);
    };
    fetchData();
  }, [id]);

  // Fetch calculated price
  useEffect(() => {
    if (!produto || !clienteId) return;
    const fetchPrice = async () => {
      try {
        const result = await getProductPrice({
          productId: produto.id,
          customerId: clienteId,
          quantity: quantidade,
        });
        setCalculatedPrice(result.price);
      } catch {
        setCalculatedPrice(produto.preco);
      }
    };
    fetchPrice();
  }, [produto, clienteId, quantidade]);

  const price = calculatedPrice ?? produto?.preco ?? 0;
  const disponivel = produto ? produto.estoque_total - produto.estoque_reservado : 0;
  const isPreOrder = statusInfo?.nome.toLowerCase() === "pre-order";
  const canBuy = statusInfo ? statusInfo.permite_comprar && (disponivel > 0 || isPreOrder) : disponivel > 0;

  const breadcrumb: Categoria[] = [];
  if (categoria) {
    let current: Categoria | undefined = categoria;
    while (current) {
      breadcrumb.unshift(current);
      current = current.parent_id ? categorias.find(c => c.id === current!.parent_id) : undefined;
    }
  }

  const handleAdd = () => {
    if (!produto || !canBuy) return;
    addItem({
      produto_id: produto.id, nome: produto.nome, sku: produto.sku, preco: price,
      quantidade, unidade_venda: produto.unidade_venda,
      quantidade_minima: produto.quantidade_minima, estoque_disponivel: isPreOrder ? 999999 : disponivel,
      imagem_url: produto.imagem_url,
    });
    toast.success(`${produto.nome} ${isPreOrder ? "added as back order" : "added to order"}`);
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </PortalLayout>
    );
  }

  if (!produto) {
    return (
      <PortalLayout>
        <div className="py-20 text-center text-muted-foreground">Product not found.</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button onClick={() => navigate("/portal/catalogo")} className="hover:text-primary">Home</button>
        {breadcrumb.map(bc => (
          <span key={bc.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button onClick={() => navigate(`/portal/catalogo?category=${bc.id}`)} className="hover:text-primary">
              {bc.nome}
            </button>
          </span>
        ))}
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{produto.nome}</span>
      </div>

      <Card className="p-6">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Image */}
          <div className="bg-muted rounded-lg flex items-center justify-center overflow-hidden aspect-square">
            {produto.imagem_url ? (
              <img src={produto.imagem_url} alt={produto.nome} className="h-full w-full object-contain" />
            ) : (
              <div className="text-6xl font-bold text-muted-foreground/20">{produto.nome.charAt(0)}</div>
            )}
          </div>

          {/* Details */}
          <div>
            <h1 className="text-2xl font-bold">{produto.nome}</h1>
            <p className={`mt-2 text-lg font-semibold ${canBuy ? "text-green-500" : "text-destructive"}`}>
              {statusInfo ? statusInfo.nome : (disponivel > 0 ? "Available" : "Out of Stock")}
            </p>

            {categoria && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</p>
                <p className="text-sm">{categoria.nome}</p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4">
              <p className="text-3xl font-bold">${price.toFixed(2)}</p>
              {(disponivel > 0 || isPreOrder) && (
                <Badge variant="outline" className={isPreOrder ? "border-blue-500 text-blue-500" : "border-green-500 text-green-500"}>
                  {isPreOrder ? "BACK ORDER" : `AVAILABLE QUANTITY: ${disponivel}`}
                </Badge>
              )}
            </div>

            <div className="mt-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quantity</p>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={produto.quantidade_minima}
                  max={isPreOrder ? undefined : disponivel}
                  value={quantidade}
                  onChange={(e) => setQuantidade(Math.max(produto.quantidade_minima, parseInt(e.target.value) || 1))}
                  className="w-24 h-10"
                  disabled={!canBuy}
                />
                <Button onClick={handleAdd} disabled={!canBuy} className="gap-2 h-10">
                  {isPreOrder ? "BACK ORDER" : "ADD TO ORDER"} <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {produto.descricao && (
          <div className="mt-8 border-t pt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</p>
            <div className="text-sm whitespace-pre-wrap">{produto.descricao}</div>
          </div>
        )}
      </Card>
    </PortalLayout>
  );
};

export default ProdutoDetalhe;
