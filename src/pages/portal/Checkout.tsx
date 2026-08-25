import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PortalLayout from "@/components/layouts/PortalLayout";

// Dispara as notificações do pedido em BACKGROUND, sem travar o checkout.
// `keepalive` faz o request sobreviver à navegação/desmontagem da página — era
// exatamente isso que faltava (antes usavam `await` só pra o navigate não
// cancelar os fetches, o que fazia o cliente esperar ~1 min pelos emails/SMTP).
async function fireOrderNotifications(bodies: Array<{ fn: string; body: any }>) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let token = anon;
  try { token = (await supabase.auth.getSession()).data.session?.access_token || anon; } catch { /* usa anon */ }
  for (const { fn, body } of bodies) {
    try {
      fetch(`${url}/functions/v1/${fn}`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch { /* nunca bloqueia o checkout */ }
  }
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, Lock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/contexts/CartContext";
import { checkCartStock, cartKey } from "@/lib/stock";
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
  const { user, impersonatedCustomer } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [enderecoId, setEnderecoId] = useState("");
  // Endereço da CONTA da empresa (clientes.endereco/cidade/estado) — opção default
  // quando não há endereços cadastrados; vira linha em `enderecos` só ao finalizar.
  const [companyAddress, setCompanyAddress] = useState<any>(null);
  const [addressOwnerId, setAddressOwnerId] = useState("");
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddr, setNewAddr] = useState({ logradouro: "", complemento: "", cidade: "", estado: "", cep: "" });
  const [savingAddr, setSavingAddr] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [shippingId, setShippingId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
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
  const [customerPhone, setCustomerPhone] = useState("");
  // Pais do cliente, usado nas REGRAS DE FRETE por zona. Sem isto, a comparacao
  // era com o literal "United States" e toda regra de Canada/UK era descartada.
  const [customerCountry, setCustomerCountry] = useState("");
  const [subCannotOrder, setSubCannotOrder] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [payByCard, setPayByCard] = useState(false);
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const [shippingCost, setShippingCost] = useState(0);
  // Itens que esgotaram/ficaram insuficientes enquanto o cliente está no checkout
  // (aviso proativo — o submit e o trigger do banco são os guards finais).
  const [outOfStock, setOutOfStock] = useState<string[]>([]);
  const orderPlacedRef = useRef(false); // evita o redirect de "carrinho vazio" após finalizar
  const stripeRef = useRef<any>(null);
  const cardElementRef = useRef<any>(null);
  const cardMountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!user && !impersonatedCustomer) return;

      // Traz JÁ os campos de endereço + grupo de imposto na MESMA query — evita
      // 2 buscas redundantes depois (endereço da empresa e tax_customer_group_id).
      const cols = "id, nome, empresa, email, telefone, pais, parent_customer_id, can_confirm_order, endereco, cidade, estado, cep, tax_customer_group_id";
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select(cols).eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select(cols).eq("user_id", user!.id).maybeSingle();

      const { data: cliente } = await clienteQuery;

      if (cliente) {
        setClienteId(cliente.id);
        setCustomerName(cliente.nome || cliente.empresa || "");
        setCustomerCompany(cliente.empresa || "");
        setCustomerEmail(cliente.email || "");
        setCustomerPhone((cliente as any).telefone || "");
        setCustomerCountry(((cliente as any).pais || "").trim());
        // Sub-customer sem permissão de confirmar não finaliza (espelha a trava do banco).
        setSubCannotOrder(!!(cliente as any).parent_customer_id && (cliente as any).can_confirm_order === false);
        // Endereço puxa da conta da EMPRESA: sub-usuário usa os endereços do pai.
        const addressClienteId = (cliente as any).parent_customer_id ?? cliente.id;
        setAddressOwnerId(addressClienteId);
        // Endereços salvos + (só se for sub-usuário) o cadastro do PAI, em PARALELO.
        // Pra conta própria, o endereço da empresa já veio na query do cliente acima
        // → zero busca extra. Antes eram 2 buscas SEQUENCIAIS aqui (lentidão).
        const isSub = !!(cliente as any).parent_customer_id;
        const [{ data: ends }, parentAcct] = await Promise.all([
          supabase.from("enderecos").select("*").eq("cliente_id", addressClienteId),
          isSub
            ? supabase.from("clientes").select("endereco, cidade, estado, cep").eq("id", addressClienteId).maybeSingle()
            : Promise.resolve({ data: cliente } as any),
        ]);
        setEnderecos(ends ?? []);
        const acct: any = (parentAcct as any)?.data ?? cliente;
        const companyAddr = acct?.endereco && acct?.cidade
          ? { logradouro: acct.endereco, complemento: "", cidade: acct.cidade, estado: acct.estado ?? "", cep: acct.cep ?? "" }
          : null;
        setCompanyAddress(companyAddr);
        const principal = ends?.find((e: any) => e.principal);
        if (principal) {
          setEnderecoId(principal.id);
          setSelectedEndereco(principal);
        } else if (!ends?.length && companyAddr) {
          // Sem endereços cadastrados → default = endereço da empresa (antes ficava vazio).
          setEnderecoId("__company__");
          setSelectedEndereco(companyAddr);
        }
      }

      // Opções PRIVATE (frete/pagamento) só aparecem pro cliente ATRIBUÍDO
      // (cliente_payment_options / cliente_shipping_options). Públicas (privado=false)
      // aparecem pra todos. Sub-usuário herda as atribuições da conta do pai.
      const acctId = (cliente as any)?.parent_customer_id ?? cliente?.id ?? null;
      let allowedPay = new Set<string>(), allowedShip = new Set<string>();
      if (acctId) {
        const [{ data: cpo }, { data: cso }] = await Promise.all([
          supabase.from("cliente_payment_options").select("payment_option_id").eq("cliente_id", acctId),
          supabase.from("cliente_shipping_options").select("shipping_option_id").eq("cliente_id", acctId),
        ]);
        allowedPay = new Set((cpo ?? []).map((x: any) => x.payment_option_id));
        allowedShip = new Set((cso ?? []).map((x: any) => x.shipping_option_id));
      }
      const canSee = (o: any, allowed: Set<string>) => !o.privado || allowed.has(o.id);

      // Frete e pagamento em PARALELO (eram 2 buscas sequenciais).
      const [{ data: ship }, { data: pay }] = await Promise.all([
        supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem"),
        // Colunas EXPLICITAS: `select("*")` trazia `gateway_config`, onde a tela do
        // admin permite guardar CHAVE SECRETA do gateway. A RLS e por linha, nao por
        // coluna, entao qualquer cliente logado baixava a chave junto com a opcao de
        // pagamento. O checkout nunca precisou desse campo.
        supabase.from("payment_options").select("id, nome, descricao, instrucoes, ativo, privado, ordem").eq("ativo", true).order("ordem"),
      ]);
      setShippingOptions((ship ?? []).filter((s: any) => s.show_to_customers !== false && canSee(s, allowedShip)));
      setPaymentOptions((pay ?? []).filter((p: any) => canSee(p, allowedPay)));

      // Compute tax using rules: match customer's tax_customer_group_id
      if (cliente) {
        // tax_customer_group_id já veio na query do cliente (sem busca extra).
        const customerGroupId = (cliente as any).tax_customer_group_id;

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
              // salesTax é derivado no efeito [total, discount, taxRate] — não calcula aqui.
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
                // salesTax é derivado no efeito [total, discount, taxRate] — não calcula aqui.
              }
            }
          }
        }
      }

      // Check if Stripe is enabled (via secure RPC — não expõe segredos de `configuracoes`)
      const { data: cfgRows } = await (supabase as any).rpc("get_public_config");
      const cfg = Array.isArray(cfgRows) ? cfgRows[0] : cfgRows;
      if (cfg?.stripe_enabled && cfg?.stripe_publishable_key) {
        setStripeEnabled(true);
        setStripePublishableKey(cfg.stripe_publishable_key);
      }
    };

    fetch();
    // NÃO depende de `total`: a busca de rede (cliente, endereços, frete,
    // pagamento, taxa, config) roda UMA vez. O VALOR do imposto reage ao total
    // sozinho no efeito derivado abaixo (setSalesTax por total/discount/taxRate).
    // Antes `total` estava aqui e re-disparava a busca inteira a cada mudança do
    // carrinho — era a lentidão do endereço voltando.
  }, [user, impersonatedCustomer]);

  const handleEnderecoChange = (id: string) => {
    setEnderecoId(id);
    if (id === "__new__") { setShowNewAddress(true); setSelectedEndereco(null); return; }
    setShowNewAddress(false);
    if (id === "__company__") { setSelectedEndereco(companyAddress); return; }
    setSelectedEndereco(enderecos.find(e => e.id === id) || null);
  };

  // Salva o endereço novo digitado no checkout e já o seleciona.
  const saveNewAddress = async () => {
    if (!newAddr.logradouro.trim() || !newAddr.cidade.trim() || !newAddr.estado.trim() || !newAddr.cep.trim()) {
      toast.error("Fill in street, city, state and ZIP."); return;
    }
    setSavingAddr(true);
    const { data, error } = await supabase.from("enderecos").insert({
      cliente_id: addressOwnerId,
      logradouro: newAddr.logradouro.trim(), complemento: newAddr.complemento.trim() || null,
      cidade: newAddr.cidade.trim(), estado: newAddr.estado.trim(), cep: newAddr.cep.trim(),
      principal: false,
    } as any).select().single();
    setSavingAddr(false);
    if (error || !data) { toast.error("Could not save address: " + (error?.message ?? "unknown error")); return; }
    setEnderecos(prev => [...prev, data]);
    setEnderecoId((data as any).id);
    setSelectedEndereco(data);
    setShowNewAddress(false);
    setNewAddr({ logradouro: "", complemento: "", cidade: "", estado: "", cep: "" });
    toast.success("Address saved");
  };

  // Resolve o endereço escolhido pra um id REAL de `enderecos` na hora de finalizar:
  // opção "empresa" reusa (ou cria uma vez) a linha correspondente.
  const resolveEnderecoEntregaId = async (): Promise<{ ok: boolean; id: string | null }> => {
    if (enderecoId === "__new__") {
      toast.error("Save the new address first (or pick another one).");
      return { ok: false, id: null };
    }
    if (enderecoId === "__company__" && companyAddress) {
      const existing = enderecos.find(e => e.logradouro === companyAddress.logradouro && e.cidade === companyAddress.cidade);
      if (existing) return { ok: true, id: existing.id };
      const { data: created, error: addrErr } = await supabase.from("enderecos").insert({
        cliente_id: addressOwnerId,
        logradouro: companyAddress.logradouro, cidade: companyAddress.cidade,
        estado: companyAddress.estado || "-", cep: companyAddress.cep || "-",
        principal: false,
      } as any).select().single();
      // Sem checar o erro, uma falha aqui (ex.: RLS barrando sub-usuário que grava
      // com o cliente_id do PAI) devolvia ok:true com id NULL e o pedido era criado
      // SEM endereço de entrega, com mensagem de sucesso — ninguém percebia até o
      // despacho. Agora falha explícita: o pedido não é criado.
      if (addrErr || !(created as any)?.id) {
        toast.error("Could not use the company address for delivery: " +
          (addrErr?.message ?? "address not created") + ". Please pick or add a delivery address.");
        return { ok: false, id: null };
      }
      return { ok: true, id: (created as any).id };
    }
    return { ok: true, id: enderecoId || null };
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
        // Compara com o pais DO CLIENTE. Antes era `c.country === "United States"`
        // fixo: qualquer regra de Canada/United Kingdom (opcoes que a propria tela
        // do admin oferece) era descartada, caindo no fallback `opt.preco` = 0 —
        // frete GRATIS nessas zonas. Sem pais no cadastro, assume US, que e o
        // default do sistema para cliente novo.
        const paisCliente = (customerCountry || "United States").toLowerCase();
        const countryOk = !c.country || String(c.country).toLowerCase() === paisCliente;
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
  }, [shippingId, shippingOptions, total, selectedEndereco, customerCountry]);

  // Aviso PROATIVO de estoque no checkout — se um item esgotar enquanto o cliente
  // está aqui, desabilita o botão ANTES do clique. Polling 10s + realtime + foco.
  // (O submit re-valida e o trigger do banco é o guard final — 3 camadas.)
  useEffect(() => {
    if (items.length === 0) { setOutOfStock([]); return; }
    const ids = items.map(i => i.produto_id);
    let cancelled = false;
    const check = async () => {
      const [{ data: prods }, { data: statuses }, { data: vars }] = await Promise.all([
        supabase.from("produtos").select("id, estoque_total, estoque_reservado, status_produto").in("id", ids),
        supabase.from("product_statuses").select("nome, permite_comprar"),
        // `ids.length`, NAO `varIds.length`: pular quando nenhuma linha tem
        // variante e exatamente perder o caso que interessa — produto que ganhou
        // opcao DEPOIS que o cliente o colocou no carrinho.
        ids.length
          ? supabase.from("produto_variantes").select("id, produto_id, quantidade").eq("ativo", true).in("produto_id", ids)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      // Cobre `vars` tambem: sem isso, falha na consulta de variantes deixava a
      // checagem rodar com lista vazia — ou seja, sem a regra de variante.
      if (cancelled || !prods || !statuses || !vars) return;
      // Regra única (src/lib/stock.ts), a mesma do Carrinho e do submit: teto da
      // variante + soma por produto. Coberta por teste em src/lib/stock.test.ts.
      const { blocked, insufficient } = checkCartStock(items, prods, statuses, vars ?? []);
      const nomes = [
        ...[...blocked.values()].map((i) => i.nome),
        ...items.filter((i: any) => insufficient.has(cartKey(i))).map((i: any) => i.nome),
      ];
      setOutOfStock([...new Set(nomes)]);
    };
    check();
    const interval = setInterval(check, 10000);
    const onFocus = () => { if (document.visibilityState !== "hidden") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // Topic único por execução (o antigo `checkout-stock-${ids.length}` colidia com
    // o do carrinho / com outra aba, e o cleanup de um efeito derrubava o canal do outro).
    const channel = supabase.channel(`checkout-stock-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "produtos", filter: `id=in.(${ids.join(",")})` }, () => check())
      .subscribe();
    return () => {
      cancelled = true; clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [items]);

  const handleSubmit = async () => {
    if (!clienteId) {
      toast.error("Client not found");
      return;
    }
    if (subCannotOrder) {
      toast.error("Your account is not allowed to place orders. Please ask your account owner to confirm orders.");
      return;
    }
    if (items.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    // Único campo obrigatório (regra do negócio): a data de entrega/retirada.
    // Endereço puxa da conta; pagamento é opcional; frete é filtrado por cliente.
    if (!deliveryDate) {
      toast.error("Please select a delivery / pickup date.");
      return;
    }

    setLoading(true);

    // Validate stock & status before submitting
    //
    // FALHA FECHADO. Antes o erro destas queries era descartado e o
    // `if (freshProducts && allStatuses)` pulava a checagem INTEIRA — uma queda
    // de rede aqui gravava o pedido sem validar nada, inclusive sem variante.
    // E nao ha rede no banco: `pedido_itens.variante_id` e anulavel, sem
    // constraint. Este e o ultimo portao antes de virar pedido.
    const idsProdSubmit = [...new Set(items.map((i: any) => i.produto_id))];
    const [prodRes, statusRes, varRes] = await Promise.all([
      supabase.from("produtos")
        .select("id, estoque_total, estoque_reservado, status_produto")
        .in("id", idsProdSubmit),
      supabase.from("product_statuses").select("nome, permite_comprar"),
      idsProdSubmit.length
        ? supabase.from("produto_variantes").select("id, produto_id, quantidade").eq("ativo", true).in("produto_id", idsProdSubmit)
        : Promise.resolve({ data: [] as any[], error: null } as any),
    ]);
    if (prodRes.error || statusRes.error || varRes.error) {
      console.error(prodRes.error ?? statusRes.error ?? varRes.error);
      toast.error("Could not verify stock right now. Please try again.");
      setLoading(false);
      return;
    }
    const freshProducts = prodRes.data;
    const allStatuses = statusRes.data;
    const freshVariants = varRes.data;
    if (!freshProducts || !allStatuses) {
      toast.error("Could not verify stock right now. Please try again.");
      setLoading(false);
      return;
    }

    {
      // Mesma regra da checagem proativa (src/lib/stock.ts): teto da variante +
      // soma por produto. Antes o submit olhava só o total do produto, então
      // dava pra fechar 10 de um tamanho que só tinha 2.
      const { blocked, insufficient } = checkCartStock(items, freshProducts, allStatuses, freshVariants ?? []);
      const blockedItems = [...new Set([
        ...[...blocked.values()].map((i) => i.nome),
        ...items.filter((i: any) => insufficient.has(cartKey(i))).map((i: any) => i.nome),
      ])];

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

    // Item a $0 (preço não configurado / "contact us") PODE finalizar — vira pedido de
    // cotação; o vendedor ajusta os preços depois no admin. (Sem gate de preço zero.)

    const recalcSubtotal = recalculated.reduce((sum, i) => sum + i.preco * i.quantidade, 0);
    const recalcDiscount = coupon
      ? coupon.tipo === "percentual"
        ? recalcSubtotal * (Number(coupon.valor) / 100)
        : Math.min(Number(coupon.valor), recalcSubtotal)
      : 0;
    const recalcTax = (recalcSubtotal - recalcDiscount) * taxRate / 100;
    const recalcGrossTotal = recalcSubtotal - recalcDiscount + recalcTax + shippingCost;

    const addr = await resolveEnderecoEntregaId();
    if (!addr.ok) { setLoading(false); return; }

    const { data: pedido, error } = await supabase.from("pedidos").insert({
      cliente_id: clienteId,
      subtotal: recalcSubtotal,
      total: recalcGrossTotal,
      desconto: recalcDiscount > 0 ? recalcDiscount : null,
      sales_tax: recalcTax > 0 ? recalcTax : null,
      shipping_costs: shippingCost > 0 ? shippingCost : null,
      coupon_id: coupon?.id ?? null,
      endereco_entrega_id: addr.id,
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
      // Coluna própria da variante: o texto abaixo é pro humano ler, ISTO é o
      // que o re-order e os relatórios usam. Antes a variante só existia no
      // nome/sku e o re-order trazia o produto errado.
      variante_id: (i as any).variante_id ?? null,
      // Inclui a variante (Size/Color) no nome da linha do pedido; sku = código da variante.
      nome_produto: (i as any).variante_label ? `${i.nome} (${(i as any).variante_label})` : i.nome,
      sku: i.sku ?? "",
      preco_unitario: i.preco,
      quantidade: i.quantidade,
      subtotal: i.preco * i.quantidade,
    }));

    // `as any`: `variante_id` entrou em 20260802130000 e os types gerados do
    // Supabase ainda não foram regerados contra o schema novo.
    const { error: itensError } = await supabase.from("pedido_itens").insert(itens as any);

    if (itensError) {
      // A reserva atômica (trigger) pode rejeitar em corrida pelo último item.
      // Remove o pedido órfão (sem itens) e avisa claramente.
      await supabase.from("pedidos").delete().eq("id", pedido.id);
      // Distingue os dois motivos que hoje compartilham o mesmo ERRCODE
      // (`check_violation`): falta de estoque e item sem variante. Sem isto o
      // cliente via a mensagem CRUA do banco na tela.
      const precisaVariante = /ITEM_NEEDS_VARIANT|ITEM_VARIANT_MISMATCH/i.test(itensError.message);
      const isStock = !precisaVariante
        && /insufficient_stock|check_violation|insufficient stock/i.test(itensError.message);
      toast.error(precisaVariante
        ? "One of the items needs an option (size/color) chosen. Please open the product and pick one."
        : isStock
          ? "Sorry — an item just went out of stock. Please review your cart and try again."
          : "Error saving order items: " + itensError.message);
      setLoading(false);
      return;
    }

    // Os triggers recomputam preço/subtotal/desconto/total no banco. Relê o pedido
    // pra usar os valores AUTORITATIVOS (cobrança e contador de cupom).
    const { data: fresh } = await supabase.from("pedidos")
      .select("subtotal, desconto, sales_tax, shipping_costs, total").eq("id", pedido.id).maybeSingle();
    const finalTotal = Number((fresh as any)?.total ?? recalcGrossTotal);
    const couponApplied = Number((fresh as any)?.desconto ?? 0) > 0;
    // Email usa os totais AUTORITATIVOS (recomputados pelos triggers), não os do insert.
    const emailOrder = { ...pedido, ...((fresh as any) || {}) };

    // Incrementa uso do cupom de forma ATÔMICA (não read-modify-write) e só se o
    // desconto realmente entrou (o trigger valida ativo/datas/uso no servidor).
    // SÓ é chamado quando o pedido REALMENTE se concretiza: antes isto rodava aqui,
    // ANTES do pagamento — cartão recusado cancelava o pedido mas o cupom já tinha
    // sido consumido (cupom de uso único ficava queimado sem venda nenhuma).
    const bumpCouponUsage = async () => {
      if (coupon && couponApplied) {
        await supabase.rpc("increment_coupon_usage", { _coupon_id: coupon.id });
      }
    };

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
          amount: Math.round(finalTotal * 100) / 100,
          currency: "usd",
          pedido_id: pedido.id,
          metadata: { order_number: pedido.numero ?? "" },
        },
      });

      if (piError || !piData?.client_secret) {
        const msg = piData?.error || piError?.message || "Failed to create payment intent";
        toast.error("Payment error: " + msg);
        // Mark order as failed — leave it in DB so admin can see
        await supabase.from("pedidos").update({ status: "cancelled" } as any).eq("id", pedido.id);
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
        await supabase.from("pedidos").update({ status: "cancelled" } as any).eq("id", pedido.id);
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        // Mark as paid
        await supabase
          .from("pedidos")
          .update({ is_paid: true, payment_intent_id: paymentIntent.id } as any)
          .eq("id", pedido.id);
        await bumpCouponUsage(); // pagamento aprovado → agora sim consome o cupom
        // Notificações em BACKGROUND (keepalive) — o cliente NÃO espera os emails.
        const emailCustomer = { id: clienteId, email: customerEmail, nome: customerName, empresa: customerCompany };
        const emailItems = recalculated.map(i => ({ sku: i.sku ?? "", nome_produto: i.nome, preco_unitario: i.preco, quantidade: i.quantidade, subtotal: i.preco * i.quantidade }));
        await fireOrderNotifications([
          { fn: "send-email", body: { type: "new_order_customer", order: emailOrder, customer: emailCustomer, items: emailItems } },
          { fn: "send-email", body: { type: "new_order_admin", order: emailOrder, customer: emailCustomer, items: emailItems } },
          { fn: "notify-dispatch", body: { event: "new_order", vars: {
            order_id: pedido.id, order_numero: (pedido as any).numero, total: finalTotal,
            date: new Date().toLocaleString("pt-BR"),
            items: recalculated.map(i => `• ${i.quantidade}x ${i.nome} — ${i.preco}`).join("\n"),
            customer_name: customerName, customer_company: customerCompany, customer_email: customerEmail, customer_phone: customerPhone,
          }, customer: { email: customerEmail, phone: customerPhone, whatsapp: customerPhone } } },
        ]);
        orderPlacedRef.current = true;
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

    await bumpCouponUsage(); // pedido sem cartão: confirmado no submit
    // Notificações em BACKGROUND (keepalive) — o cliente NÃO espera os emails.
    const emailCustomer = { id: clienteId, email: customerEmail, nome: customerName, empresa: customerCompany };
    const emailItems = recalculated.map(i => ({ sku: i.sku ?? "", nome_produto: i.nome, preco_unitario: i.preco, quantidade: i.quantidade, subtotal: i.preco * i.quantidade }));
    await fireOrderNotifications([
      { fn: "send-email", body: { type: "new_order_customer", order: emailOrder, customer: emailCustomer, items: emailItems } },
      { fn: "send-email", body: { type: "new_order_admin", order: emailOrder, customer: emailCustomer, items: emailItems } },
      { fn: "notify-dispatch", body: { event: "new_order", vars: {
        order_id: pedido.id, order_numero: (pedido as any).numero, total: finalTotal,
        date: new Date().toLocaleString("pt-BR"),
        items: recalculated.map(i => `• ${i.quantidade}x ${i.nome} — ${i.preco}`).join("\n"),
        customer_name: customerName, customer_company: customerCompany, customer_email: customerEmail, customer_phone: customerPhone,
      }, customer: { email: customerEmail, phone: customerPhone, whatsapp: customerPhone } } },
    ]);

    orderPlacedRef.current = true;
    clearCart();
    toast.success(`Order #${pedido.numero} submitted!`);
    navigate("/portal/pedidos");
    setLoading(false);
  };

  // Carrinho vazio: redireciona via efeito (não durante o render, que causava corrida de navegação).
  // Não redireciona logo após finalizar (clearCart esvazia o carrinho) — aí quem manda é o navigate do submit.
  useEffect(() => {
    if (items.length === 0 && !orderPlacedRef.current) navigate("/portal/carrinho");
  }, [items.length, navigate]);

  if (items.length === 0) {
    return null;
  }

  if (subCannotOrder) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-xl font-semibold text-muted-foreground">Approval required</p>
          <p className="text-sm text-muted-foreground">Your account needs approval to place orders.<br/>Contact your account owner for assistance.</p>
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
              {companyAddress && (
                <SelectItem value="__company__">
                  Company address — {companyAddress.logradouro}, {companyAddress.cidade}{companyAddress.estado ? `, ${companyAddress.estado}` : ""}
                </SelectItem>
              )}
              {enderecos.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.logradouro}, {e.cidade}, {e.estado}, {e.cep}
                </SelectItem>
              ))}
              <SelectItem value="__new__">+ Add a new address...</SelectItem>
            </SelectContent>
          </Select>

          {showNewAddress && (
            <div className="mt-3 space-y-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label className="text-xs">Street address *</Label>
                  <Input value={newAddr.logradouro} onChange={e => setNewAddr({ ...newAddr, logradouro: e.target.value })} placeholder="1800 N Powerline Rd Ste A6" /></div>
                <div><Label className="text-xs">Address 2</Label>
                  <Input value={newAddr.complemento} onChange={e => setNewAddr({ ...newAddr, complemento: e.target.value })} placeholder="Suite, unit..." /></div>
                <div><Label className="text-xs">ZIP *</Label>
                  <Input value={newAddr.cep} onChange={e => setNewAddr({ ...newAddr, cep: e.target.value })} placeholder="33069" /></div>
                <div><Label className="text-xs">City *</Label>
                  <Input value={newAddr.cidade} onChange={e => setNewAddr({ ...newAddr, cidade: e.target.value })} placeholder="Pompano Beach" /></div>
                <div><Label className="text-xs">State *</Label>
                  <Input value={newAddr.estado} onChange={e => setNewAddr({ ...newAddr, estado: e.target.value })} placeholder="FL" /></div>
              </div>
              <Button type="button" size="sm" onClick={saveNewAddress} disabled={savingAddr}>
                {savingAddr ? "Saving..." : "Save address"}
              </Button>
            </div>
          )}

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

        {outOfStock.length > 0 && (
          <div className="flex items-center justify-end mb-2">
            <p className="text-sm text-destructive flex items-center gap-1 text-right">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Sold out / insufficient stock: <strong>{outOfStock.join(", ")}</strong>. Go back to the cart to remove or save for later.
            </p>
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => navigate("/portal/carrinho")}>BACK</Button>
          <Button onClick={handleSubmit} disabled={loading || (payByCard && !stripeReady) || outOfStock.length > 0}>
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
