import { useNavigate } from "react-router-dom";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useCart, cartKey } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingBag, X, Trash2, ChevronRight, Bookmark, RotateCcw, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

// Chave POR USUÁRIO (antes era global -> "saved for later" de um usuário aparecia
// pra outro no mesmo navegador). Espelha o padrão do carrinho (b2b_cart_<uid>).
const savedKey = (uid?: string | null) => uid ? `cart_saved_for_later_${uid}` : "cart_saved_for_later_anon";

const Carrinho = () => {
  const { items, removeItem, updateQuantity, clearCart, total, addItem } = useCart();
  const { user, canPlaceOrders, impersonatedCustomer } = useAuth();
  const navigate = useNavigate();
  const [salesTax, setSalesTax] = useState(0);
  const [unavailableItems, setUnavailableItems] = useState<Set<string>>(new Set());
  // Itens COM algum estoque, mas menos que a quantidade pedida (quer 5, tem 3).
  // Bloqueiam finalizar, mas a quantidade pode ser reduzida (input fica habilitado).
  const [insufficientItems, setInsufficientItems] = useState<Map<string, number>>(new Map());
  const [savedItems, setSavedItems] = useState<any[]>([]);

  // Carrega "saved for later" do usuário atual e limpa a chave global legada (que vazava).
  useEffect(() => {
    try {
      setSavedItems(JSON.parse(localStorage.getItem(savedKey(user?.id)) ?? "[]"));
    } catch { setSavedItems([]); }
    localStorage.removeItem("cart_saved_for_later"); // remove dados vazados da chave antiga
  }, [user?.id]);

  const persistSaved = (updated: any[]) => {
    setSavedItems(updated);
    localStorage.setItem(savedKey(user?.id), JSON.stringify(updated));
  };

  const saveForLater = (item: any) => {
    removeItem(cartKey(item));
    persistSaved([...savedItems.filter((s) => s.produto_id !== item.produto_id), item]);
    toast.info(`${item.nome} saved for later`);
  };

  const moveToCart = (item: any) => {
    addItem(item);
    persistSaved(savedItems.filter((s) => s.produto_id !== item.produto_id));
    toast.success(`${item.nome} moved to cart`);
  };

  const removeSaved = (produto_id: string) => {
    persistSaved(savedItems.filter((s) => s.produto_id !== produto_id));
  };

  // Disponibilidade em TEMPO REAL — não pode ter risco de comprar com estoque
  // faltando. Re-checa: ao mudar o carrinho, a cada 10s (polling), ao VOLTAR pra
  // aba, e via Supabase Realtime (mudança de estoque dos produtos do carrinho).
  // O guard FINAL é o trigger de reserva no banco (rejeita no submit), isto é a
  // camada de aviso pra bloquear ANTES.
  useEffect(() => {
    if (items.length === 0) { setUnavailableItems(new Set()); setInsufficientItems(new Map()); return; }
    const ids = items.map(i => i.produto_id);
    let cancelled = false;

    const check = async () => {
      const [{ data: prods }, { data: statuses }] = await Promise.all([
        supabase.from("produtos").select("id, estoque_total, estoque_reservado, status_produto").in("id", ids),
        supabase.from("product_statuses").select("nome, permite_comprar"),
      ]);
      if (cancelled || !prods || !statuses) return;
      const statusMap = new Map(statuses.map(s => [s.nome.toLowerCase(), s.permite_comprar ?? true]));
      const blocked = new Set<string>();
      const insufficient = new Map<string, number>();
      for (const item of items) {
        const prod = prods.find(p => p.id === item.produto_id);
        if (!prod) continue;
        const statusName = prod.status_produto || "disponivel";
        const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out", pre_venda: "pre-order", estoque_limitado: "limited stock", descontinuado: "discontinued" };
        const normalized = (nameMap[statusName] || statusName).toLowerCase();
        const canBuy = statusMap.get(normalized) ?? true;
        const isPreOrder = normalized === "pre-order";
        const disponivel = prod.estoque_total - prod.estoque_reservado;
        if (!canBuy || (!isPreOrder && disponivel < 1)) {
          blocked.add(item.produto_id);                 // esgotado / não comprável → remover
        } else if (!isPreOrder && disponivel < item.quantidade) {
          insufficient.set(item.produto_id, disponivel); // tem menos que o pedido → reduzir
        }
      }
      setUnavailableItems(blocked);
      setInsufficientItems(insufficient);
    };

    check();
    const interval = setInterval(check, 10000);
    const onFocus = () => { if (document.visibilityState !== "hidden") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const channel = supabase
      .channel(`cart-stock-${ids.length}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "produtos", filter: `id=in.(${ids.join(",")})` }, () => check())
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [items]);

  useEffect(() => {
    const fetchTax = async () => {
      if (!user && !impersonatedCustomer) { setSalesTax(0); return; }
      // Get customer's tax group
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("tax_customer_group_id").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("tax_customer_group_id").eq("user_id", user!.id).maybeSingle();
      const { data: cliente } = await clienteQuery;
      if (!cliente) { setSalesTax(0); return; }

      const groupId = cliente.tax_customer_group_id;
      const { data: defaultClass } = await supabase.from("tax_classes").select("id").eq("is_default", true).maybeSingle();
      if (!defaultClass?.id) { setSalesTax(0); return; }

      // Resolve group: use customer's group or default group
      let effectiveGroupId = groupId;
      if (!effectiveGroupId) {
        const { data: dg } = await supabase.from("tax_customer_groups").select("id").eq("is_default", true).maybeSingle();
        effectiveGroupId = dg?.id;
      }
      if (!effectiveGroupId) { setSalesTax(0); return; }

      const { data: rule } = await supabase.from("tax_rules")
        .select("tax_rate_id")
        .eq("tax_class_id", defaultClass.id)
        .eq("tax_customer_group_id", effectiveGroupId)
        .maybeSingle();
      if (!rule?.tax_rate_id) { setSalesTax(0); return; }

      const { data: rate } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
      const pct = Number(rate?.percentual) || 0;
      setSalesTax(total * pct / 100);
    };
    fetchTax();
  }, [total, user, impersonatedCustomer]);

  const totalQuantity = items.reduce((sum, i) => sum + i.quantidade, 0);
  const grossTotal = total + salesTax;

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => navigate("/portal/catalogo")} className="hover:text-primary">Home</button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Current order</span>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Current Order</h2>
          {items.length > 0 && (
            <Button variant="ghost" className="text-destructive gap-2" onClick={clearCart}>
              DELETE ALL <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <ShoppingBag className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Your order is empty.</p>
            <Button className="mt-4" onClick={() => navigate("/portal/catalogo")}>Browse Catalog</Button>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">CODE ▲</TableHead>
                  <TableHead>PRODUCT</TableHead>
                  <TableHead className="w-24">PRICE</TableHead>
                  <TableHead className="w-28">QUANTITY</TableHead>
                  <TableHead className="w-24">DISCOUNT</TableHead>
                  <TableHead className="w-24">TOTAL</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.produto_id}>
                    <TableCell>
                      <div className="h-10 w-10 bg-muted rounded overflow-hidden">
                        {item.imagem_url ? (
                          <img src={item.imagem_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                            {item.nome.charAt(0)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.nome}
                      {item.variante_label && (
                        <span className="block text-xs text-muted-foreground font-normal">{item.variante_label}</span>
                      )}
                      {unavailableItems.has(item.produto_id) && (
                        <Badge variant="destructive" className="ml-2 text-xs">Out of stock</Badge>
                      )}
                      {insufficientItems.has(item.produto_id) && (
                        <Badge variant="destructive" className="ml-2 text-xs">
                          Only {insufficientItems.get(item.produto_id)} left — reduce qty
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>${Number(item.preco).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={item.quantidade_minima}
                        max={item.estoque_disponivel}
                        value={item.quantidade}
                        onChange={e => updateQuantity(cartKey(item), parseInt(e.target.value) || item.quantidade_minima)}
                        className="h-8 w-20"
                        disabled={unavailableItems.has(item.produto_id)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">-</TableCell>
                    <TableCell className="font-medium">${(item.preco * item.quantidade).toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveForLater(item)}
                          title="Save for later"
                          className="h-7 w-7 rounded-full border border-primary/40 text-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeItem(cartKey(item))}
                          className="h-7 w-7 rounded-full border border-destructive text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Summary */}
            <div className="mt-4 flex items-center justify-between">
              <Card className="p-4 inline-flex gap-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Total Quantity</p>
                  <p className="font-bold">{totalQuantity}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Total</p>
                  <p className="font-bold">${total.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Sales Tax</p>
                  <p className="font-bold">${salesTax.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Gross Total</p>
                  <p className="font-bold">${grossTotal.toFixed(2)}</p>
                </div>
              </Card>

              <div className="flex flex-col items-end gap-2">
                {unavailableItems.size > 0 && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Remove out-of-stock items to proceed
                  </p>
                )}
                {insufficientItems.size > 0 && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Reduce quantities to the available stock to proceed
                  </p>
                )}
                {!canPlaceOrders ? (
                  <p className="text-sm text-muted-foreground italic">Your account needs approval to place orders — ordering disabled</p>
                ) : (
                  <Button onClick={() => navigate("/portal/checkout")} disabled={unavailableItems.size > 0 || insufficientItems.size > 0}>NEXT</Button>
                )}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Saved for Later */}
      {savedItems.length > 0 && (
        <Card className="mt-6 p-6">
          <h3 className="text-lg font-bold mb-4">Saved for Later ({savedItems.length})</h3>
          <div className="divide-y">
            {savedItems.map((item) => (
              <div key={item.produto_id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded bg-muted overflow-hidden flex-shrink-0">
                    {item.imagem_url ? (
                      <img src={item.imagem_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                        {item.nome?.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">${Number(item.preco).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => moveToCart(item)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Move to Cart
                  </Button>
                  <button
                    onClick={() => removeSaved(item.produto_id)}
                    className="h-7 w-7 rounded-full border border-destructive text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </PortalLayout>
  );
};

export default Carrinho;
