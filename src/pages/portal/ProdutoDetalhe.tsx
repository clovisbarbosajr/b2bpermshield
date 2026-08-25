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
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { formatOpcao } from "@/lib/variants";
import { ancestorChain } from "@/lib/categoryTree";

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
  const [accessDenied, setAccessDenied] = useState(false); // restrito por privacy group / não-visível
  const [variantes, setVariantes] = useState<any[]>([]);
  // TRI-ESTADO. `variantesErro` cobria erro, nao "ainda nao sei": entre montar a
  // tela e a query voltar, `hasVariants` era false e o botao adicionava sem
  // variante. Sao dois efeitos independentes e o `loading` so acompanha o do
  // produto.
  const [variantesErro, setVariantesErro] = useState(false);
  const [variantesCarregadas, setVariantesCarregadas] = useState(false);
  const [selectedVarianteId, setSelectedVarianteId] = useState<string>("");

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
        const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out", pre_venda: "pre-order", estoque_limitado: "limited stock", descontinuado: "discontinued" };
        const normalized = (nameMap[statusName] || statusName).toLowerCase();
        const matched = (statusesRes.data ?? []).find((s: any) => s.nome.toLowerCase() === normalized);
        setStatusInfo(matched ? { permite_comprar: matched.permite_comprar ?? true, nome: matched.nome } : { permite_comprar: true, nome: statusName });
      }
      setCategorias((catsRes.data as Categoria[]) ?? []);
      setLoading(false);
    };
    fetchData();
  }, [id]);

  // Carrega as variantes ativas do produto (Size/Color etc.).
  useEffect(() => {
    if (!id) return;
    // RESET ao trocar de produto: a rota e a mesma, entao navegar de A para B
    // NAO remonta o componente. Sem isto o botao ficava vivo com as variantes de
    // A e o `produto` ja trocado para B — dava para mandar a variante de A no
    // produto B.
    setVariantes([]);
    setSelectedVarianteId("");
    setVariantesErro(false);
    setVariantesCarregadas(false);
    supabase
      .from("produto_variantes")
      .select("id, codigo, quantidade, valores_opcao, imagem_url, ativo")
      .eq("produto_id", id)
      .eq("ativo", true)
      .order("codigo")
      .then(({ data, error }) => {
        // FALHA ALTO. Descartando o erro, `hasVariants` virava false e o produto
        // ia pro carrinho SEM variante e com preco do pai — pedido errado, em
        // silencio. E esta e justamente a pagina para onde o catalogo redireciona
        // quando o produto tem variante.
        if (error) {
          console.error(error);
          toast.error("Could not load product options. Please reload the page.");
          setVariantesErro(true);
          setVariantesCarregadas(true);
          return;
        }
        setVariantesErro(false);
        setVariantes(data ?? []);
        setVariantesCarregadas(true);
      });
  }, [id]);

  // Checa acesso por privacy group (fecha o vazamento via URL direta /portal/produto/:id).
  // Se o produto é restrito a grupos e o cliente não pertence a nenhum, bloqueia.
  useEffect(() => {
    if (!produto) return;
    const checkAccess = async () => {
      // Impersonação ("view as"): a sessão é do admin, então a RLS não escopa. Decide pela
      // RPC staff-gated (mesma do catálogo), que cobre TODA a lógica de privacidade
      // (categoria privada, grant/exclude, herança sub-user→pai) — fecha a URL direta.
      if (impersonatedCustomer?.id) {
        const { data: visIds } = await (supabase as any).rpc("produtos_visiveis_cliente", { _cli_id: impersonatedCustomer.id });
        setAccessDenied(!(Array.isArray(visIds) && visIds.includes(produto.id)));
        return;
      }
      const { data: acessos } = await supabase.from("produto_acesso").select("grupo_nome").eq("produto_id", produto.id);
      const required = (acessos ?? []).map((a: any) => a.grupo_nome).filter(Boolean);
      if (required.length === 0) { setAccessDenied(false); return; } // sem restrição → liberado
      if (!clienteId) { setAccessDenied(true); return; }             // restrito e sem cliente → bloqueia
      const { data: cpg } = await supabase.from("cliente_privacy_groups").select("privacy_group_id").eq("cliente_id", clienteId);
      const myGroups = new Set((cpg ?? []).map((r: any) => r.privacy_group_id));
      setAccessDenied(!required.some((g: string) => myGroups.has(g)));
    };
    checkAccess();
  }, [produto, clienteId, impersonatedCustomer]);

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
  // Variantes: estoque e "pode comprar" passam a depender da variante escolhida.
  const hasVariants = variantes.length > 0;
  const selectedVariante = variantes.find((v) => v.id === selectedVarianteId) || null;
  const effectiveDisponivel = hasVariants ? (selectedVariante ? (selectedVariante.quantidade ?? 0) : 0) : disponivel;
  const effectiveCanBuy = hasVariants
    ? (!!selectedVariante && (statusInfo ? statusInfo.permite_comprar : true) && (effectiveDisponivel > 0 || isPreOrder))
    : canBuy;

  // Mesma guarda de ciclo do catálogo. Este `while` não tinha nenhuma: com um
  // `parent_id` circular no banco (A pai de B, B pai de A) o `find` sempre achava
  // e o laço nunca saía — e por ser laço, e não recursão, não era tela branca:
  // era o array crescendo até **congelar a aba**. Pior que o sintoma do catálogo.
  const breadcrumb: Categoria[] = ancestorChain(categorias, categoria?.id) as Categoria[];

  const handleAdd = () => {
    if (!produto || !effectiveCanBuy) return;
    // Nao sei se este produto tem variante: nao adiciona. Adicionar "sem
    // variante" quando a lista falhou em carregar produz o pedido errado
    // exatamente como se o produto nao tivesse opcao nenhuma.
    if (!variantesCarregadas) { toast.error("Still loading product options — one moment."); return; }
    if (variantesErro) { toast.error("Product options could not be loaded. Please reload the page."); return; }
    if (hasVariants && !selectedVariante) { toast.error("Please select an option first."); return; }
    // Preço $0 (não configurado / "contact us") PODE ser adicionado — vira pedido/pedido
    // de cotação; o vendedor ajusta o preço depois no admin.
    const label = selectedVariante ? (formatOpcao(selectedVariante.valores_opcao) || selectedVariante.codigo) : null;
    addItem({
      produto_id: produto.id,
      variante_id: selectedVariante?.id ?? null,
      variante_label: label,
      nome: produto.nome,
      sku: selectedVariante?.codigo || produto.sku,
      preco: price,
      quantidade, unidade_venda: produto.unidade_venda,
      quantidade_minima: produto.quantidade_minima,
      estoque_disponivel: isPreOrder ? 999999 : effectiveDisponivel,
      imagem_url: selectedVariante?.imagem_url || produto.imagem_url,
    });
    toast.success(`${produto.nome}${label ? ` (${label})` : ""} ${isPreOrder ? "added as back order" : "added to order"}`);
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

  if (!produto || accessDenied) {
    return (
      <PortalLayout>
        <div className="py-20 text-center text-muted-foreground">
          Product not available.
        </div>
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
            <p className={`mt-2 text-lg font-semibold ${effectiveCanBuy ? "text-green-500" : "text-destructive"}`}>
              {statusInfo ? statusInfo.nome : (effectiveDisponivel > 0 ? "Available" : "Out of Stock")}
            </p>

            {categoria && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</p>
                <p className="text-sm">{categoria.nome}</p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4">
              <p className="text-3xl font-bold">${price.toFixed(2)}</p>
              {(effectiveDisponivel > 0 || isPreOrder) && (
                <Badge variant="outline" className={isPreOrder ? "border-blue-500 text-blue-500" : "border-green-500 text-green-500"}>
                  {isPreOrder ? "BACK ORDER" : `AVAILABLE QUANTITY: ${effectiveDisponivel}`}
                </Badge>
              )}
            </div>

            {/* Variantes / opções (Size, Color etc.) — só aparece se o produto tiver */}
            {hasVariants && (
              <div className="mt-6">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Options</p>
                <div className="flex flex-wrap gap-2">
                  {variantes.map((v) => {
                    const out = (v.quantidade ?? 0) <= 0 && !isPreOrder;
                    const sel = v.id === selectedVarianteId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVarianteId(v.id)}
                        className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted"} ${out ? "opacity-50" : ""}`}
                      >
                        {formatOpcao(v.valores_opcao) || v.codigo}
                        {out && <span className="ml-1 text-xs">(out of stock)</span>}
                      </button>
                    );
                  })}
                </div>
                {!selectedVariante && (
                  <p className="text-xs text-muted-foreground mt-1">Select an option to continue.</p>
                )}
              </div>
            )}

            <div className="mt-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quantity</p>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={produto.quantidade_minima}
                  max={isPreOrder ? undefined : effectiveDisponivel}
                  value={quantidade}
                  onChange={(e) => setQuantidade(Math.max(produto.quantidade_minima, parseInt(e.target.value) || 1))}
                  className="w-24 h-10"
                  disabled={!effectiveCanBuy}
                />
                <Button onClick={handleAdd} disabled={!effectiveCanBuy} className="gap-2 h-10">
                  {isPreOrder ? "BACK ORDER" : "ADD TO ORDER"} <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Description — HTML do B2BWave (sanitizado). Antes mostrava as tags cruas. */}
        {produto.descricao && (
          <div className="mt-8 border-t pt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</p>
            <div className="text-sm prose prose-sm max-w-none dark:prose-invert [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(produto.descricao) }} />
          </div>
        )}
      </Card>
    </PortalLayout>
  );
};

export default ProdutoDetalhe;
