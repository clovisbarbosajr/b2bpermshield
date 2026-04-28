import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { getProductPrice } from "@/lib/pricing";

// Dynamically load Stripe.js from CDN
function loadStripeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Stripe) { resolve(); return; }
    const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Stripe.js"));
    document.head.appendChild(script);
  });
}

const Checkout = () => {
  const { items, total, clearCart } = useCart();
  const { user, impersonatedCustomer, contactRole } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [enderecoId, setEnderecoId] = useState("");
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [shippingId, setShippingId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [comments, setComments] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [selectedEndereco, setSelectedEndereco] = useState<any>(null);
  const [taxRate, setTaxRate] = useState(0);
  const [salesTax, setSalesTax] = useState(0);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<any>(null);
  const [couponError, setCouponError] = useState("");
  const [couponApplying, setCouponApplying] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [customerEmail, setCustomerEmail] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [payByCard, setPayByCard] = useState(false);
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const [shippingCost, setShippingCost] = useState(0);
  const stripeRef = useRef<any>(null);
  const cardElementRef = useRef<any>(null);
  const cardMountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;

      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id, nome, empresa, email").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id, nome, empresa, email").eq("user_id", user!.id).maybeSingle();

      const { data: cliente } = await clienteQuery;

      if (cliente) {
        setClienteId(cliente.id);
        setCustomerName(cliente.nome || cliente.empresa || "");
        setCustomerEmail(cliente.email || "");
        const { data: ends } = await supabase.from("enderecos").select("*").eq("cliente_id", cliente.id);
        setEnderecos(ends ?? []);
        const principal = ends?.find((e: any) => e.principal);
        if (principal) {
          setEnderecoId(principal.id);
          setSelectedEndereco(principal);
        }
      }

      const { data: ship } = await supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem");
      setShippingOptions(ship ?? []);
      const { data: pay } = await supabase.from("payment_options").select("*").eq("ativo", true).order("ordem");
      setPaymentOptions(pay ?? []);

      // Compute tax using rules: match customer's tax_customer_group_id
      if (cliente) {
        const { data: clienteData } = await supabase.from("clientes").select("tax_customer_group_id").eq("id", cliente.id).maybeSingle();
        const customerGroupId = clienteData?.tax_customer_group_id;

        // Get default tax class (Taxable)
        const { data: defaultClass } = await supabase.from("tax_classes").select("id").eq("is_default", true).maybeSingle();
        const taxClassId = defaultClass?.id;

        if (customerGroupId && taxClassId) {
          // Find matching rule
          const { data: rule } = await supabase.from("tax_rules")
            .select("tax_rate_id")
            .eq("tax_class_id", taxClassId)
            .eq("tax_customer_group_id", customerGroupId)
            .maybeSingle();

          if (rule?.tax_rate_id) {
            const { data: rate } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
            if (rate) {
              const pct = Number(rate.percentual) || 0;
              setTaxRate(pct);
              setSalesTax(total * pct / 100);
            }
          }
        } else if (taxClassId) {
          // Customer has no group assigned - find default group rule
          const { data: defaultGroup } = await supabase.from("tax_customer_groups").select("id").eq("is_default", true).maybeSingle();
          if (defaultGroup) {
            const { data: rule } = await supabase.from("tax_rules")
              .select("tax_rate_id")
              .eq("tax_class_id", taxClassId)
              .eq("tax_customer_group_id", defaultGroup.id)
              .maybeSingle();
            if (rule?.tax_rate_id) {
              const { data: rate } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
              if (rate) {
                const pct = Number(rate.percentual) || 0;
                setTaxRate(pct);
                setSalesTax(total * pct / 100);
              }
            }
          }
        }
      }

      // Check if Stripe is enabled
      const { data: cfg } = await (supabase.from("configuracoes") as any)
        .select("stripe_enabled, stripe_publishable_key")
        .limit(1).maybeSingle();
      if (cfg?.stripe_enabled && cfg?.stripe_publishable_key) {
        setStripeEnabled(true);
        setStripePublishableKey(cfg.stripe_publishable_key);
      }
    };

    fetch();
  }, [user, impersonatedCustomer, total]);

  const handleEnderecoChange = (id: string) => {
    setEnderecoId(id);
    setSelectedEndereco(enderecos.find(e => e.id === id) || null);
  };

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponApplying(true);
    setCouponError("");
    const { data } = await supabase
      .from("coupons")
      .select("*")
      .eq("codigo", couponCode.trim().toUpperCase())
      .eq("ativo", true)
      .maybeSingle();

    if (!data) {
      setCouponError("Coupon not found or inactive");
      setCoupon(null);
      setDiscount(0);
      setCouponApplying(false);
      return;
    }

    const now = new Date();
    if (data.data_inicio && new Date(data.data_inicio) > now) {
      setCouponError("Coupon not yet valid");
      setCoupon(null); setDiscount(0); setCouponApplying(false); return;
    }
    if (data.data_fim && new Date(data.data_fim) < now) {
      setCouponError("Coupon expired");
      setCoupon(null); setDiscount(0); setCouponApplying(false); return;
    }
    if (data.uso_maximo && (data.uso_atual ?? 0) >= data.uso_maximo) {
      setCouponError("Coupon usage limit reached");
      setCoupon(null); setDiscount(0); setCouponApplying(false); return;
    }

    const discountValue = data.tipo === "percentual"
      ? total * (Number(data.valor) / 100)
      : Math.min(Number(data.valor), total);

    setCoupon(data);
    setDiscount(discountValue);
    setCouponApplying(false);
    toast.success(`Coupon applied: -$${discountValue.toFixed(2)}`);
  };

  const removeCoupon = () => {
    setCoupon(null);
    setDiscount(0);
    setCouponCode("");
    setCouponError("");
  };

  // Recalculate salesTax whenever cart total, discount, or taxRate changes
  useEffect(() => {
    setSalesTax((total - discount) * taxRate / 100);
  }, [total, discount, taxRate]);

  // Mount Stripe card element when payByCard is selected
  useEffect(() => {
    if (!payByCard || !stripePublishableKey) return;

    let mounted = true;
    setStripeError("");
    setStripeReady(false);

    loadStripeScript()
      .then(() => {
        if (!mounted) return;
        const stripe = (window as any).Stripe(stripePublishableKey);
        stripeRef.current = stripe;
        const elements = stripe.elements();
        const card = elements.create("card", {
          style: {
            base: {
              color: "#ffffff",
              fontFamily: "inherit",
              fontSize: "14px",
              "::placeholder": { color: "#6b7280" },
            },
            invalid: { color: "#ef4444" },
          },
        });
        cardElementRef.current = card;

        // Wait for DOM to be ready
        setTimeout(() => {
          if (mounted && cardMountRef.current) {
            card.mount(cardMountRef.current);
            card.on("ready", () => { if (mounted) setStripeReady(true); });
            card.on("change", (e: any) => {
              if (e.error) setStripeError(e.error.message);
              else setStripeError("");
            });
          }
        }, 100);
      })
      .catch((err) => {
        if (mounted) setStripeError(err.message);
      });

    return () => {
      mounted = false;
      if (cardElementRef.current) {
        try { cardElementRef.current.unmount(); } catch {}
        cardElementRef.current = null;
      }
    };
  }, [payByCard, stripePublishableKey]);

  const discountedTotal = total - discount;
  const grossTotal = discountedTotal + salesTax + shippingCost;
  const totalQuantity = items.reduce((sum, i) => sum + i.quantidade, 0);

  // Recalculate shipping cost whenever the selected option or subtotal changes
  useEffect(() => {
    if (!shippingId) { setShippingCost(0); return; }
    const opt = shippingOptions.find(s => s.id === shippingId);
    if (!opt) { setShippingCost(0); return; }

    const conds: any[] = Array.isArray(opt.condicoes) ? opt.condicoes : [];
    const customerState = selectedEndereco?.estado ?? "";

    if (conds.length > 0) {
      // Find best matching condition: country matches + (province matches OR province is "All") + from_net_value <= subtotal
      const matching = conds.filter(c => {
        const countryOk = !c.country || c.country === "United States";
        const provinceOk = !c.province || c.province === "All" || c.province.toLowerCase() === customerState.toLowerCase();
        const minOk = (c.from_net_value ?? 0) <= total;
        return countryOk && provinceOk && minOk;
      });
      if (matching.length > 0) {
        // Pick the one with highest from_net_value (most specific rule)
        const best = matching.sort((a, b) => (b.from_net_value ?? 0) - (a.from_net_value ?? 0))[0];
        const cost = (best.price ?? 0) + (total * (best.percentage_upcharge ?? 0) / 100);
        setShippingCost(cost);
        return;
      }
    }
    // Fallback to option's flat preco
    setShippingCost(Number(opt.preco) || 0);
  }, [shippingId, shippingOptions, total, selectedEndereco]);

  const handleSubmit = async () => {
    if (!clienteId) {
      toast.error("Client not found");
      return;
    }
    if (items.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    setLoading(true);

    // Validate stock & status before submitting
    const productIds = items.map(i => i.produto_id);
    const { data: freshProducts } = await supabase
      .from("produtos")
      .select("id, estoque_total, estoque_reservado, status_produto")
      .in("id", productIds);

    const { data: allStatuses } = await supabase
      .from("product_statuses")
      .select("nome, permite_comprar");

    if (freshProducts && allStatuses) {
      const statusMap = new Map(allStatuses.map(s => [s.nome.toLowerCase(), s.permite_comprar ?? true]));
      const blockedItems: string[] = [];

      for (const item of items) {
        const prod = freshProducts.find(p => p.id === item.produto_id);
        if (!prod) continue;
        const statusName = prod.status_produto || "disponivel";
        const nameMap: Record<string, string> = { disponivel: "available", indisponivel: "not available", esgotado: "sold out" };
        const normalized = (nameMap[statusName] || statusName).toLowerCase();
        const canBuy = statusMap.get(normalized) ?? true;
        const isPreOrder = normalized === "pre-order";
        const disponivel = prod.estoque_total - prod.estoque_reservado;

        if (!canBuy || (!isPreOrder && disponivel < item.quantidade)) {
          blockedItems.push(item.nome);
        }
      }

      if (blockedItems.length > 0) {
        toast.error(`Cannot complete order. The following items are unavailable or out of stock: ${blockedItems.join(", ")}`);
        setLoading(false);
        return;
      }
    }

    // Recalculate prices before saving
    const recalculated = await Promise.all(
      items.map((i) =>
        getProductPrice({ productId: i.produto_id, customerId: clienteId, quantity: i.quantidade })
          .then((r) => ({ ...i, preco: r.price }))
          .catch(() => i)
      )
    );

    const recalcSubtotal = recalculated.reduce((sum, i) => sum + i.preco * i.quantidade, 0);
    const recalcDiscount = coupon
      ? coupon.tipo === "percentual"
        ? recalcSubtotal * (Number(coupon.valor) / 100)
        : Math.min(Number(coupon.valor), recalcSubtotal)
      : 0;
    const recalcTax = (recalcSubtotal - recalcDiscount) * taxRate / 100;
    const recalcGrossTotal = recalcSubtotal - recalcDiscount + recalcTax + shippingCost;

    const { data: pedido, error } = await supabase.from("pedidos").insert({
      cliente_id: clienteId,
      subtotal: recalcSubtotal,
      total: recalcGrossTotal,
      desconto: recalcDiscount > 0 ? recalcDiscount : null,
      sales_tax: recalcTax > 0 ? recalcTax : null,
      shipping_costs: shippingCost > 0 ? shippingCost : null,
      coupon_id: coupon?.id ?? null,
      endereco_entrega_id: enderecoId || null,
      shipping_option_id: shippingId || null,
      payment_option_id: paymentId || null,
      observacoes: comments || null,
      po_number: poNumber || null,
      delivery_date: deliveryDate || null,
      quantidade_total: totalQuantity,
    } as any).select().single();

    if (error || !pedido) {
      toast.error("Error: " + (error?.message ?? ""));
      setLoading(false);
      return;
    }

    const itens = recalculated.map(i => ({
      pedido_id: pedido.id,
      produto_id: i.produto_id,
      nome_produto: i.nome,
      sku: i.sku,
      preco_unitario: i.preco,
      quantidade: i.quantidade,
      subtotal: i.preco * i.quantidade,
    }));

    const { error: itensError } = await supabase.from("pedido_itens").insert(itens);

    if (itensError) {
      toast.error("Error saving order items: " + itensError.message);
      setLoading(false);
      return;
    }

    // Increment coupon usage
    if (coupon) {
      await supabase
        .from("coupons")
        .update({ uso_atual: (coupon.uso_atual ?? 0) + 1 })
        .eq("id", coupon.id);
    }

    // Stripe card payment
    if (payByCard) {
      if (!stripeRef.current || !cardElementRef.current) {
        toast.error("Card form not ready. Please try again.");
        setLoading(false);
        return;
      }

      // Create payment intent on the server
      const { data: piData, error: piError } = await supabase.functions.invoke("stripe-checkout", {
        body: {
          action: "create_payment_intent",
          amount: Math.round(recalcGrossTotal * 100) / 100,
          currency: "usd",
          pedido_id: pedido.id,
          metadata: { order_number: pedido.numero ?? "" },
        },
      });

      if (piError || !piData?.client_secret) {
        const msg = piData?.error || piError?.message || "Failed to create payment intent";
        toast.error("Payment error: " + msg);
        // Mark order as failed — leave it in DB so admin can see
        await supabase.from("pedidos").update({ status: "cancelado" } as any).eq("id", pedido.id);
        setLoading(false);
        return;
      }

      // Confirm card payment on client
      const { paymentIntent, error: confirmError } = await stripeRef.current.confirmCardPayment(
        piData.client_secret,
        { payment_method: { card: cardElementRef.current } }
      );

      if (confirmError) {
        toast.error("Payment failed: " + confirmError.message);
        await supabase.from("pedidos").update({ status: "cancelado" } as any).eq("id", pedido.id);
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        // Mark as paid
        await supabase
          .from("pedidos")
          .update({ is_paid: true, payment_intent_id: paymentIntent.id } as any)
          .eq("id", pedido.id);
        // Fire-and-forget email notifications
        const emailCustomer = { id: clienteId, email: customerEmail, nome: customerName, empresa: customerName };
        const emailItems = recalculated.map(i => ({ sku: i.sku, nome_produto: i.nome, preco_unitario: i.preco, quantidade: i.quantidade, subtotal: i.preco * i.quantidade }));
        supabase.functions.invoke("send-email", { body: { type: "new_order_customer", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});
        supabase.functions.invoke("send-email", { body: { type: "new_order_admin", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});
        clearCart();
        toast.success(`Order #${pedido.numero} placed and payment confirmed!`);
        navigate("/portal/pedidos");
        setLoading(false);
        return;
      }

      toast.error("Payment not completed. Status: " + paymentIntent?.status);
      setLoading(false);
      return;
    }

    // Fire-and-forget email notifications
    const emailCustomer = { id: clienteId, email: customerEmail, nome: customerName, empresa: customerName };
    const emailItems = recalculated.map(i => ({ sku: i.sku, nome_produto: i.nome, preco_unitario: i.preco, quantidade: i.quantidade, subtotal: i.preco * i.quantidade }));
    supabase.functions.invoke("send-email", { body: { type: "new_order_customer", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});
    supabase.functions.invoke("send-email", { body: { type: "new_order_admin", order: pedido, customer: emailCustomer, items: emailItems } }).catch(() => {});

    clearCart();
    toast.success(`Order #${pedido.numero} submitted!`);
    navigate("/portal/pedidos");
    setLoading(false);
  };

  if (items.length === 0) {
    navigate("/portal/carrinho");
    return null;
  }

  if (contactRole === "viewer") {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-xl font-semibold text-muted-foreground">View-only access</p>
          <p className="text-sm text-muted-foreground">Your account has view-only permissions and cannot place orders.<br/>Contact your account manager for assistance.</p>
          <Button variant="outline" onClick={() => navigate("/portal/catalogo")}>Back to Catalog</Button>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => navigate("/portal/catalogo")} className="hover:text-primary">Home</button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Confirm order</span>
      </div>

      <Card className="p-6 max-w-3xl bg-card/80 backdrop-blur-sm">
        <h2 className="text-2xl font-bold mb-6">Confirm Order</h2>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Delivery Address</h3>
          <Select value={enderecoId} onValueChange={handleEnderecoChange}>
            <SelectTrigger><SelectValue placeholder="Select address" /></SelectTrigger>
            <SelectContent>
              {enderecos.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.logradouro}, {e.cidade}, {e.estado}, {e.cep}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedEndereco && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground">Address</Label><Input value={selectedEndereco.logradouro} readOnly /></div>
              <div><Label className="text-xs text-muted-foreground">Address 2</Label><Input value={selectedEndereco.complemento || ""} readOnly /></div>
              <div><Label className="text-xs text-muted-foreground">Postal Code</Label><Input value={selectedEndereco.cep} readOnly /></div>
              <div><Label className="text-xs text-muted-foreground">City</Label><Input value={selectedEndereco.cidade} readOnly /></div>
              <div><Label className="text-xs text-muted-foreground">State</Label><Input value={selectedEndereco.estado} readOnly /></div>
              <div><Label className="text-xs text-muted-foreground">Country</Label><Input value="United States" readOnly /></div>
            </div>
          )}
        </div>

        {shippingOptions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Shipping Option</h3>
            <Select value={shippingId} onValueChange={setShippingId}>
              <SelectTrigger><SelectValue placeholder="Select shipping" /></SelectTrigger>
              <SelectContent>
                {shippingOptions.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {paymentOptions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-bold mb-3">Payment option</h3>
            <div className="space-y-2">
              {paymentOptions.map(p => (
                <label key={p.id} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="payment"
                    value={p.id}
                    checked={paymentId === p.id}
                    onChange={() => setPaymentId(p.id)}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-semibold text-sm uppercase text-primary">{p.nome}</p>
                    {p.instrucoes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{p.instrucoes}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Stripe Card Payment */}
        {stripeEnabled && (
          <div className="mb-6">
            <h3 className="text-sm font-bold mb-3">Card Payment (Stripe)</h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="payment"
                checked={payByCard}
                onChange={() => { setPayByCard(true); setPaymentId(""); }}
                className="mt-1"
              />
              <div>
                <p className="font-semibold text-sm uppercase text-primary">Pay by Credit/Debit Card</p>
                <p className="text-xs text-muted-foreground">Secure payment via Stripe. Card details are never stored on our servers.</p>
              </div>
            </label>

            {/* Stripe Elements Card Form — shown when card is selected */}
            {payByCard && (
              <div className="mt-3 rounded-lg border border-primary/30 bg-muted/30 p-4">
                <div className="flex items-center gap-1 mb-3 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  <span>Your card details are encrypted and sent directly to Stripe</span>
                </div>
                {/* Stripe mounts its card iframe here */}
                <div
                  ref={cardMountRef}
                  className="rounded border border-input bg-background px-3 py-3 min-h-[42px]"
                />
                {!stripeReady && !stripeError && (
                  <p className="text-xs text-muted-foreground mt-2">Loading card form...</p>
                )}
                {stripeError && (
                  <p className="text-xs text-destructive mt-2">{stripeError}</p>
                )}
              </div>
            )}

            {paymentOptions.length > 0 && (
              <label className="flex items-start gap-3 cursor-pointer mt-3">
                <input
                  type="radio"
                  name="payment"
                  checked={!payByCard}
                  onChange={() => setPayByCard(false)}
                  className="mt-1"
                />
                <div>
                  <p className="font-semibold text-sm uppercase text-primary">Other payment options</p>
                </div>
              </label>
            )}
          </div>
        )}

        {/* Coupon */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Discount Coupon</h3>
          {coupon ? (
            <div className="flex items-center justify-between rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
              <span>
                <strong>{coupon.codigo}</strong>
                {" — "}
                {coupon.tipo === "percentual" ? `${coupon.valor}% off` : `$${Number(coupon.valor).toFixed(2)} off`}
                {" → "}
                <span className="text-green-400 font-bold">-${discount.toFixed(2)}</span>
              </span>
              <button onClick={removeCoupon} className="text-muted-foreground hover:text-destructive ml-3 text-xs">Remove</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder="Enter coupon code"
                value={couponCode}
                onChange={(e) => { setCouponCode(e.target.value); setCouponError(""); }}
                onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                className="flex-1"
              />
              <Button variant="outline" onClick={applyCoupon} disabled={couponApplying}>
                {couponApplying ? "..." : "Apply"}
              </Button>
            </div>
          )}
          {couponError && <p className="text-xs text-destructive mt-1">{couponError}</p>}
        </div>

        {/* Totals */}
        <div className="mb-6 space-y-1 border-t border-b py-3">
          <div className="flex items-center justify-between text-sm">
            <span>Subtotal</span>
            <span>${total.toFixed(2)}</span>
          </div>
          {discount > 0 && (
            <div className="flex items-center justify-between text-sm text-green-400">
              <span>Discount ({coupon?.codigo})</span>
              <span>-${discount.toFixed(2)}</span>
            </div>
          )}
          {salesTax > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span>Sales Tax ({taxRate}%)</span>
              <span>${salesTax.toFixed(2)}</span>
            </div>
          )}
          {shippingCost > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span>Shipping</span>
              <span>${shippingCost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between font-bold pt-1 border-t">
            <span>Gross total</span>
            <span className="text-lg">${grossTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Customer Name</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Delivery Date *</Label>
            <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Comments</Label>
            <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={comments} onChange={e => setComments(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Purchase Order</Label>
            <Input value={poNumber} onChange={e => setPoNumber(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => navigate("/portal/carrinho")}>BACK</Button>
          <Button onClick={handleSubmit} disabled={loading || (payByCard && !stripeReady)}>
            {loading
              ? payByCard ? "Processing payment..." : "Sending..."
              : payByCard
              ? `PAY $${grossTotal.toFixed(2)}`
              : "SEND ORDER"}
          </Button>
        </div>
      </Card>
    </PortalLayout>
  );
};

export default Checkout;
