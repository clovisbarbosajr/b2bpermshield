import { useNavigate } from "react-router-dom";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useCart } from "@/contexts/CartContext";
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

const SAVE_FOR_LATER_KEY = "cart_saved_for_later";

const Carrinho = () => {
  const { items, removeItem, updateQuantity, clearCart, total, addItem } = useCart();
  const { user, contactRole, impersonatedCustomer } = useAuth();
  const navigate = useNavigate();
  const [salesTax, setSalesTax] = useState(0);
  const [unavailableItems, setUnavailableItems] = useState<Set<string>>(new Set());
  const [savedItems, setSavedItems] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVE_FOR_LATER_KEY) ?? "[]"); } catch { return []; }
  });

  const saveForLater = (item: any) => {
    removeItem(item.produto_id);
    const updated = [...savedItems.filter((s) => s.produto_id !== item.produto_id), item];
    setSavedItems(updated);
    localStorage.setItem(SAVE_FOR_LATER_KEY, JSON.stringify(updated));
    toast.info(`${item.nome} saved for later`);
  };

  const moveToCart = (item: any) => {
    addItem(item);
    const updated = savedItems.filter((s) => s.produto_id !== item.produto_id);
    setSavedItems(updated);
    localStorage.setItem(SAVE_FOR_LATER_KEY, JSON.stringify(updated));
    toast.success(`${item.nome} moved to cart`);
  };

  const removeSaved = (produto_id: string) => {
    const updated = savedItems.filter((s) => s.produto_id !== produto_id);
    setSavedItems(updated);
    localStorage.setItem(SAVE_FOR_LATER_KEY, JSON.stringify(updated));
  };

  // Check product availability in real time
  useEffect(() => {
    if (items.length === 0) { setUnavailableItems(new Set()); return; }
    const check = async () => {
      const ids = items.map(i => i.produto_id);
      const [{ data: prods }, { data: statuses }] = await Promise.all([
        supabase.from("produtos").select("id, estoque_total, estoque_reservado, status_produto").in("id", ids),
        supabase.from("product_statuses").select("nome, permite_comprar"),
      ]);
      if (!prods || !statuses) return;
      const statusMap = new Map(statuses.map(s => [s.nome.toLowerCase(), s.permite_comprar ?? true]));
      const blocked = new Set<string>();
      for (const item of items) {
        const prod = prods.find(p => p.id === item.produto_id);
        if (!prod) continue;
        const statusName = prod.status_produto || "disponivel";
        const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out" };
        const normalized = (nameMap[statusName] || statusName).toLowerCase();
        const canBuy = statusMap.get(normalized) ?? true;
        const isPreOrder = normalized === "pre-order";
        const disponivel = prod.estoque_total - prod.estoque_reservado;
        if (!canBuy || (!isPreOrder && disponivel < 1)) blocked.add(item.produto_id);
      }
      setUnavailableItems(blocked);
    };
    check();
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
                      {unavailableItems.has(item.produto_id) && (
                        <Badge variant="destructive" className="ml-2 text-xs">Unavailable</Badge>
                      )}
                    </TableCell>
                    <TableCell>${Number(item.preco).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={item.quantidade_minima}
                        max={item.estoque_disponivel}
                        value={item.quantidade}
                        onChange={e => updateQuantity(item.produto_id, parseInt(e.target.value) || item.quantidade_minima)}
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
                          onClick={() => removeItem(item.produto_id)}
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
                    <AlertTriangle className="h-4 w-4" /> Remove unavailable items to proceed
                  </p>
                )}
                {contactRole === "viewer" ? (
                  <p className="text-sm text-muted-foreground italic">View-only access — ordering disabled</p>
                ) : (
                  <Button onClick={() => navigate("/portal/checkout")} disabled={unavailableItems.size > 0}>NEXT</Button>
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
