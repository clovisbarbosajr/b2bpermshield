import { useState, useEffect, useRef, useCallback } from "react";
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
  const { items, total, clearCart, updatePrice } = useCart();
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
  // A guarda de preco compara o total da tela com o do banco. Se a busca da
  // aliquota FALHAR, `taxRate` fica 0, o banco cobra o imposto de verdade e a
  // guarda barraria TODOS os pedidos. Falha de leitura nossa nao pode virar
  // checkout parado — entao a guarda so vale quando o imposto foi lido de fato.
  const [taxLookupOk, setTaxLookupOk] = useState(true);
  // Falha ao montar a tela (frete/pagamento). Ver a guarda que a alimenta: sem
  // ela, "nao consegui ler" ficava identico a "esta loja nao cobra frete".
  const [loadError, setLoadError] = useState<string | null>(null);
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
  // `disable_ordering` e `minimum_order_value` existiam so como campo de tela:
  // editaveis, sincronizados do B2BWave, protegidos contra edicao pelo cliente —
  // e lidos por ninguem. O dono bloqueava um inadimplente e ele seguia comprando.
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const [minimoPedido, setMinimoPedido] = useState<number | null>(null);
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
      const cols = "id, nome, empresa, email, telefone, pais, parent_customer_id, can_confirm_order, endereco, cidade, estado, cep, tax_customer_group_id, disable_ordering, minimum_order_value";
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select(cols).eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select(cols).eq("user_id", user!.id).maybeSingle();

      // A TERCEIRA LEITURA DO MESMO EFEITO. As duas de baixo ja falham fechado; esta
      // continuava descartando o `error`, e numa RE-EXECUCAO isso reabre o pedido
      // com frete gratis pela terceira porta.
      //
      // No primeiro mount e inofensivo: `clienteId` fica null e `handleSubmit`
      // barra com "Client not found". Mas as deps sao `[user, impersonatedCustomer]`
      // — trocar a impersonacao (ou o refresh de token trocar o OBJETO `user`)
      // reexecuta. Se a leitura falhar ai, `cliente` fica null, `acctId` fica null,
      // os dois `Set` ficam vazios, `canSee` derruba toda opcao `privado` que a RLS
      // liberou, e `erroAtribuicao` nem chega a ser calculado (o bloco e pulado).
      // `clienteId` ainda guarda o cliente ANTERIOR, entao o `!clienteId` do submit
      // nao barra: pedido fechado sem frete, `shipping_costs := 0`.
      const { data: cliente, error: clienteErr } = await clienteQuery;
      if (clienteErr) {
        setLoadError(clienteErr.message);
        return;
      }

      if (cliente) {
        setClienteId(cliente.id);
        setCustomerName(cliente.nome || cliente.empresa || "");
        setCustomerCompany(cliente.empresa || "");
        setCustomerEmail(cliente.email || "");
        setCustomerPhone((cliente as any).telefone || "");
        setCustomerCountry(((cliente as any).pais || "").trim());
        // Sub-customer sem permissão de confirmar não finaliza (espelha a trava do banco).
        setSubCannotOrder(!!(cliente as any).parent_customer_id && (cliente as any).can_confirm_order === false);
        // SO A PROPRIA FICHA, porque o front NAO CONSEGUE ver a do titular.
        //
        // Isto NAO e escolha: nao existe policy que deixe um sub-login ler a linha
        // do pai em `clientes`. As de SELECT sao "Clients can read own data"
        // (`auth.uid() = user_id`), "Contacts read company cliente"
        // (`is_company_contact`, que exige linha em `company_contacts` — e o
        // `company-member` nunca cria uma) e as de staff. Um select do pai volta
        // VAZIO e sem erro, entao qualquer `||` com o valor dele seria codigo morto
        // — eu cheguei a escrever esse `||` e ele nunca teria enxergado nada.
        //
        // QUEM IMPEDE DE VERDADE E O BANCO: `20260828030000` fez
        // `fn_block_order_inactive_customer` olhar os dois lados, entao o
        // funcionario de empresa bloqueada e recusado no INSERT. O custo de a tela
        // nao saber antes e o cliente montar o carrinho e so descobrir no fim — mas
        // a mensagem NAO e crua: a linha ~753 reconhece `ORDERING_DISABLED` e
        // traduz.
        //
        // Para a tela avisar antes, o caminho e uma RPC `SECURITY DEFINER` que
        // devolva a situacao da conta (o projeto ja usa esse padrao em
        // `conta_liberada_de`). Nao entrou nesta leva.
        setOrderingDisabled((cliente as any).disable_ordering === true);
        setMinimoPedido(
          (cliente as any).minimum_order_value != null
            ? Number((cliente as any).minimum_order_value)
            : null
        );
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
      // A MESMA FALHA-ABERTO DE FRETE, PELA PORTA AO LADO. Estas duas leituras
      // descartavam o `error`, e o `?? []` deixava os dois `Set` vazios — o que faz
      // `canSee` derrubar TODA opcao `privado` que a RLS ja tinha liberado. Sem
      // frete na tela, `shippingId` fica "", `shipping_option_id` vai null, e
      // `fn_pedido_total_appside` grava `shipping_costs := 0`. Com `loadError`
      // null, sem card vermelho e com o botao habilitado: o pedido de frete gratis
      // inteiro, sem nem o aviso que a guarda de baixo passou a dar.
      //
      // Com so PARTE das opcoes privadas caindo, o dano e o cliente escolher a
      // opcao errada sem saber que a dele sumiu.
      let erroAtribuicao: string | null = null;
      if (acctId) {
        const [cpo, cso] = await Promise.all([
          supabase.from("cliente_payment_options").select("payment_option_id").eq("cliente_id", acctId),
          supabase.from("cliente_shipping_options").select("shipping_option_id").eq("cliente_id", acctId),
        ]);
        erroAtribuicao = cpo.error || cso.error ? (cpo.error ?? cso.error)!.message : null;
        allowedPay = new Set((cpo.data ?? []).map((x: any) => x.payment_option_id));
        allowedShip = new Set((cso.data ?? []).map((x: any) => x.shipping_option_id));
      }
      const canSee = (o: any, allowed: Set<string>) => !o.privado || allowed.has(o.id);

      // Frete e pagamento em PARALELO (eram 2 buscas sequenciais).
      const [ship, pay] = await Promise.all([
        supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem"),
        // Colunas EXPLICITAS: `select("*")` trazia `gateway_config`, onde a tela do
        // admin permite guardar CHAVE SECRETA do gateway. A RLS e por linha, nao por
        // coluna, entao qualquer cliente logado baixava a chave junto com a opcao de
        // pagamento. O checkout nunca precisou desse campo.
        supabase.from("payment_options").select("id, nome, descricao, instrucoes, ativo, privado, ordem").eq("ativo", true).order("ordem"),
      ]);
      // FALHA FECHADO. Os dois `error` eram descartados e o `?? []` transformava
      // falha de leitura em "esta loja nao tem opcao de frete": os dois blocos
      // somem do JSX (estao sob `.length > 0`), indistinguiveis de loja sem frete.
      //
      // O cliente entao fechava o pedido sem escolher frete, `shipping_option_id`
      // ia `null`, e `fn_pedido_total_appside` gravava `shipping_costs := 0`.
      // Pedido valido, com frete gratis que ninguem autorizou, e nenhuma mensagem
      // em lugar nenhum. Basta um 500 momentaneo do PostgREST no mount — e esta e
      // busca unica, sem retry.
      //
      // Mesma classe de erro que este arquivo ja corrigiu em `applyCoupon`, na
      // validacao de estoque do submit e no `resolveEnderecoEntregaId`; frete e
      // pagamento tinham ficado de fora.
      //
      // NAO E `return`. A primeira versao desta guarda saia da funcao aqui, e com
      // isso pulava o bloco de imposto logo abaixo: `taxRate` ficava 0 e
      // `taxLookupOk` ficava TRUE, entao a tela imprimia o total como numero
      // definitivo com o imposto nunca consultado — exatamente o cenario que a
      // outra correcao desta leva existe para impedir, alcancado pelo caminho que
      // esta correcao criou. Quem impede o pedido de sair e o botao, la embaixo.
      setLoadError(erroAtribuicao ?? (ship.error || pay.error ? (ship.error ?? pay.error)!.message : null));
      setShippingOptions((ship.data ?? []).filter((s: any) => s.show_to_customers !== false && canSee(s, allowedShip)));
      setPaymentOptions((pay.data ?? []).filter((p: any) => canSee(p, allowedPay)));

      // Compute tax using rules: match customer's tax_customer_group_id
      if (cliente) {
        // tax_customer_group_id já veio na query do cliente (sem busca extra).
        const customerGroupId = (cliente as any).tax_customer_group_id;

        // Get default tax class (Taxable)
        const { data: defaultClass, error: clsErr } = await supabase.from("tax_classes").select("id").eq("is_default", true).maybeSingle();
        // `maybeSingle()` tambem ERRA quando volta mais de uma linha. Duas
        // `tax_classes` marcadas como padrao => erro aqui, `taxRate` fica 0, e o
        // banco (que usa LIMIT 1) cobra o imposto de verdade. Sem marcar a
        // falha, a guarda de preco barraria TODO pedido.
        if (clsErr) setTaxLookupOk(false);
        const taxClassId = defaultClass?.id;

        if (customerGroupId && taxClassId) {
          // Find matching rule
          const { data: rule, error: ruleErr } = await supabase.from("tax_rules")
            .select("tax_rate_id")
            .eq("tax_class_id", taxClassId)
            .eq("tax_customer_group_id", customerGroupId)
            .maybeSingle();
          if (ruleErr) setTaxLookupOk(false);

          if (rule?.tax_rate_id) {
            const { data: rate, error: rateErr } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
            if (rateErr) setTaxLookupOk(false);
            if (rate) {
              const pct = Number(rate.percentual) || 0;
              setTaxRate(pct);
              // salesTax é derivado no efeito [total, discount, taxRate] — não calcula aqui.
            }
          }
        } else if (taxClassId) {
          // Customer has no group assigned - find default group rule
            const { data: defaultGroup, error: grpErr } = await supabase.from("tax_customer_groups").select("id").eq("is_default", true).maybeSingle();
          if (grpErr) setTaxLookupOk(false);
          if (defaultGroup) {
            const { data: rule, error: ruleErr } = await supabase.from("tax_rules")
              .select("tax_rate_id")
              .eq("tax_class_id", taxClassId)
              .eq("tax_customer_group_id", defaultGroup.id)
              .maybeSingle();
            if (ruleErr) setTaxLookupOk(false);
            if (rule?.tax_rate_id) {
              const { data: rate, error: rateErr } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
              if (rateErr) setTaxLookupOk(false);
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
    // Pergunta FECHADA, nao acesso a tabela. A politica antiga
    // (`USING (ativo = true)`) deixava qualquer conta baixar a lista inteira de
    // cupons com um GET sem filtro — e o cadastro aqui e aberto. Ver
    // 20260826050000_cupom_nao_e_catalogo_publico.sql.
    const { data: achados, error: rpcErr } = await supabase
      .rpc("cupom_por_codigo" as any, { _codigo: couponCode.trim() });
    // Ler o `error` NAO e detalhe: sem isto, RPC ausente (front publicado antes
    // do SQL) ou sem permissao viraria "Coupon not found or inactive" — a
    // promocao inteira morreria em silencio, com uma mensagem mentindo sobre a
    // causa. Foi o mesmo descuido corrigido em outros tres pontos desta leva.
    if (rpcErr) {
      setCouponError("Could not check the coupon right now — please try again.");
      setCoupon(null);
      setDiscount(0);
      setCouponApplying(false);
      return;
    }
    const data = Array.isArray(achados) ? (achados[0] ?? null) : (achados ?? null);

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
    // `!= null`, e nao truthy: com `uso_maximo = 0` a checagem era PULADA e a
    // tela aplicava um cupom que o servidor recusa. Zero significa zero usos.
    if (data.uso_maximo != null && (data.uso_atual ?? 0) >= data.uso_maximo) {
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
  // Frete como FUNCAO do subtotal, nao do estado do carrinho.
  //
  // Antes isto vivia solto dentro do useEffect e usava `total` (o subtotal do
  // CARRINHO, com precos possivelmente velhos). No submit o subtotal e
  // RECALCULADO com o preco atual do banco — e o banco calcula o frete contra
  // esse subtotal fresco. Com `percentage_upcharge` ou faixa de `from_net_value`,
  // os dois davam numeros diferentes e a guarda de preco desfazia pedido
  // LEGITIMO. Agora o submit chama esta mesma funcao com o subtotal fresco.
  const calcShippingCost = useCallback((base: number): number => {
    if (!shippingId) return 0;
    const opt = shippingOptions.find(s => s.id === shippingId);
    if (!opt) return 0;

    const conds: any[] = Array.isArray(opt.condicoes) ? opt.condicoes : [];
    const customerState = selectedEndereco?.estado ?? "";

    if (conds.length > 0) {
      const matching = conds.filter(c => {
        // Compara com o pais DO CLIENTE. Antes era `c.country === "United States"`
        // fixo: qualquer regra de Canada/United Kingdom (opcoes que a propria tela
        // do admin oferece) era descartada, caindo no fallback `opt.preco` = 0 —
        // frete GRATIS nessas zonas. Sem pais no cadastro, assume US, que e o
        // default do sistema para cliente novo.
        const paisCliente = (customerCountry || "United States").toLowerCase();
        const countryOk = !c.country || String(c.country).toLowerCase() === paisCliente;
        const provinceOk = !c.province || c.province === "All" || c.province.toLowerCase() === customerState.toLowerCase();
        const minOk = (c.from_net_value ?? 0) <= base;
        return countryOk && provinceOk && minOk;
      });
      if (matching.length > 0) {
        // Maior `from_net_value` (regra mais especifica). `sort` do JS e ESTAVEL,
        // entao em empate fica a PRIMEIRA do array — o banco desempata igual,
        // com `ORDER BY ... , ord ASC`.
        const best = matching.sort((a, b) => (b.from_net_value ?? 0) - (a.from_net_value ?? 0))[0];
        // `round(...,2)` para casar com o banco, que arredonda o upcharge.
        return Math.round(((best.price ?? 0) + (base * (best.percentage_upcharge ?? 0) / 100)) * 100) / 100;
      }
    }

    // `gratis_acima_de` SO vale quando a opcao NAO tem condicao nenhuma — e
    // exatamente o que o banco faz (`IF COALESCE(_ncond,0) = 0`). Quando a opcao
    // TEM condicoes e nenhuma casa, o banco cai no preco fixo SEM olhar o
    // limiar.
    //
    // Eu tinha posto este teste fora do `if (conds.length > 0)`, valendo nos
    // dois casos. Divergia do banco justamente na opcao com condicoes + limiar +
    // cliente numa zona sem regra: o front zerava, o banco cobrava, e a guarda
    // de preco desfazia PEDIDO LEGITIMO — o oposto do que ela existe para fazer.
    if (conds.length === 0) {
      const gratis = (opt as any).gratis_acima_de;
      if (gratis != null && base >= Number(gratis)) return 0;
    }
    return Number(opt.preco) || 0;
  }, [shippingId, shippingOptions, selectedEndereco, customerCountry]);

  useEffect(() => {
    setShippingCost(calcShippingCost(total));
  }, [calcShippingCost, total]);

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
          ? supabase.from("produto_variantes").select("id, produto_id, quantidade, estoque_reservado").eq("ativo", true).in("produto_id", ids)
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
    if (orderingDisabled) {
      toast.error("Ordering is currently disabled for this account. Please contact us.");
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
        ? supabase.from("produto_variantes").select("id, produto_id, quantidade, estoque_reservado").eq("ativo", true).in("produto_id", idsProdSubmit)
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
    // Frete recalculado com o subtotal FRESCO, igual ao banco faz. Usar o
    // `shippingCost` do estado (calculado sobre o carrinho) e o que fazia a
    // guarda de preco barrar pedido legitimo quando um preco mudava.
    const recalcShipping = calcShippingCost(recalcSubtotal);
    const recalcGrossTotal = recalcSubtotal - recalcDiscount + recalcTax + recalcShipping;

    // O BOTAO PROMETIA UM VALOR E O CARTAO COBRAVA OUTRO.
    //
    // `PAY $X` usa `grossTotal`, derivado de `total` — a soma dos precos GRAVADOS
    // no carrinho quando cada item entrou. Eles so sao atualizados quando o
    // Eles so sao atualizados por TRES caminhos: `Catalogo` reprecifica em segundo
    // plano ao adicionar e ao mudar a quantidade por la, e o "move to cart" do
    // saved-for-later rele. Mexer na quantidade DENTRO do Carrinho nao reprecifica
    // — aquele caminho chama so `updateQuantity` —, que e justamente onde o cliente
    // cruza faixa de desconto por quantidade. Carrinho
    // parado nao reprecifica nunca — o `Carrinho` exibe `item.preco` do
    // localStorage. A cobranca usa `finalTotal`, lido do banco depois dos
    // gatilhos. E a guarda de preco la embaixo compara `finalTotal` com
    // `recalcGrossTotal` — NUNCA com o que a tela mostrou. Ela protege contra
    // "banco discorda do recalculo" e e cega para "recalculo discorda do que o
    // cliente leu".
    //
    // Cenario: carrinho de $500 montado ontem, botao diz `PAY $500.00`. O admin
    // sobe o preco. No submit `getProductPrice` devolve o preco novo, o banco
    // concorda, a guarda passa — cartao cobrado $600, sem uma linha de aviso.
    //
    // REPRECIFICA A TELA E PEDE RECONFIRMACAO, em vez de so endurecer a guarda:
    // endurecer sozinho prenderia o cliente num laco, porque o carrinho nunca
    // reprecifica por conta propria e ele veria a mesma recusa para sempre.
    // Aqui o segundo clique passa, sobre o numero que ele acabou de ler.
    //
    // So quando SOBE: preco que caiu cobra menos do que foi prometido, e nao ha
    // por que interromper o cliente por isso.
    if (recalcGrossTotal - grossTotal > 0.03) {
      for (const i of recalculated) updatePrice(cartKey(i as any), i.preco, i.quantidade);
      // O DESCONTO TAMBEM. `discount` e gravado uma vez no `applyCoupon`, sobre o
      // subtotal daquele instante, e nenhum efeito o recomputa quando `total`
      // muda. Sem esta linha o toast anunciava um numero e o painel de Totais logo
      // abaixo imprimia outro: subtotal 500->600 com cupom de 10% dava
      // `recalcDiscount` 60 no toast e `discount` 50 na tela. O cliente
      // reconfirmaria contra um valor que nao e o que sera cobrado — que e
      // exatamente a premissa desta guarda.
      setDiscount(recalcDiscount);
      toast.error(
        `The total changed from $${grossTotal.toFixed(2)} to $${recalcGrossTotal.toFixed(2)} — ` +
        `prices were updated while you were checking out. Nothing was charged and no order was ` +
        `placed. Please review the new total and confirm again.`
      );
      setLoading(false);
      return;
    }

    // Pedido minimo por cliente. Confere contra o subtotal RECALCULADO (preco
    // atual do banco), nao contra o que a tela somou — carrinho velho pode ter
    // preco desatualizado e passar por pouco.
    //
    // ATENCAO, limitacao conhecida e deliberada: esta guarda e SO do navegador.
    // Nao da para impo-la no banco do jeito que o checkout envia hoje — o pedido
    // e criado numa chamada e os itens em outra, entao no INSERT do pedido o
    // subtotal ainda e o do navegador e nao ha item nenhum para somar. Quem
    // montar a requisicao a mao fecha pedido abaixo do minimo. E abuso de baixa
    // gravidade (ele paga o que pediu; nada e subtraido), diferente das travas
    // de preco. Fechar de verdade exige mudar o formato do envio do pedido —
    // anotado na fila como item proprio.
    if (minimoPedido != null && minimoPedido > 0 && recalcSubtotal < minimoPedido) {
      toast.error(
        `Minimum order value for your account is $${minimoPedido.toFixed(2)}. ` +
        `Your order subtotal is $${recalcSubtotal.toFixed(2)}.`
      );
      setLoading(false);
      return;
    }

    const addr = await resolveEnderecoEntregaId();
    if (!addr.ok) { setLoading(false); return; }

    // Desfaz um pedido recem-criado quando um passo POSTERIOR falha.
    //
    // Antes isto era `.delete()` / `.update({status:"cancelled"})` direto na
    // tabela — e nao funcionava: o cliente nao tem policy de DELETE nem de
    // UPDATE em `pedidos`, e o supabase-js nao levanta erro quando a RLS filtra
    // tudo (afeta zero linhas e volta sem `error`). Toda falha deixava um pedido
    // ORFAO, com o total que o navegador mandou e nenhum item.
    //
    // A RPC roda com service role e confere posse + idade + itens no banco.
    const desfazerPedido = async (pedidoId: string) => {
      const { error: rbErr } = await supabase.rpc("pedido_rollback_checkout" as any, {
        _pedido_id: pedidoId,
      });
      // Erro aqui e problema NOSSO, nao do cliente — ele ja esta vendo o toast
      // do motivo real. Nao empilha uma segunda mensagem tecnica na tela.
      if (rbErr) console.error("[checkout] rollback falhou", pedidoId, rbErr);
    };

    const { data: pedido, error } = await supabase.from("pedidos").insert({
      cliente_id: clienteId,
      subtotal: recalcSubtotal,
      total: recalcGrossTotal,
      desconto: recalcDiscount > 0 ? recalcDiscount : null,
      sales_tax: recalcTax > 0 ? recalcTax : null,
      shipping_costs: recalcShipping > 0 ? recalcShipping : null,
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
      // Tokens que o banco levanta com texto reconhecivel. Sem isto o cliente
      // via a mensagem crua do Postgres na tela.
      const msg = error?.message ?? "";
      // Tokens de 20260826040000. Sem tradução o cliente veria o texto CRU do
      // Postgres na tela — regra da casa: erro de programador não chega ao
      // cliente.
      toast.error(
        /ORDERING_DISABLED/i.test(msg)
          ? "Ordering is currently disabled for this account. Please contact us."
          : /PAYMENT_OPTION_NOT_ALLOWED/i.test(msg)
            ? "That payment option isn't available for your account. Please pick another one."
            : /SHIPPING_OPTION_NOT_ALLOWED/i.test(msg)
              ? "That shipping option isn't available for your account. Please pick another one."
              : "Error: " + msg
      );
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
      await desfazerPedido(pedido.id);
      // Distingue os dois motivos que hoje compartilham o mesmo ERRCODE
      // (`check_violation`): falta de estoque e item sem variante. Sem isto o
      // cliente via a mensagem CRUA do banco na tela.
      const precisaVariante = /ITEM_NEEDS_VARIANT|ITEM_VARIANT_MISMATCH/i.test(itensError.message);
      // Tokens de 20260825330000. Sem isto o cliente via o texto CRU do Postgres
      // na tela: "ITEM_PRODUTO_INATIVO: product 6f2a-... is not available".
      const produtoIndisponivel = /ITEM_PRODUTO_INATIVO|ITEM_PRODUTO_NAO_VENDAVEL/i.test(itensError.message);
      // Token de 20260825390000. O valor real vai na mensagem do banco; extraio
      // para o cliente saber QUANTO falta, em vez de "pedido pequeno demais".
      const minimo = /ORDER_BELOW_MINIMUM/i.test(itensError.message);
      const minimoValor = itensError.message.match(/below the minimum ([\d.]+)/i)?.[1];
      const isStock = !precisaVariante && !produtoIndisponivel && !minimo
        && /insufficient_stock|check_violation|insufficient stock/i.test(itensError.message);
      toast.error(minimo
        ? (minimoValor
            ? `Your order is below the minimum of $${minimoValor} for this account. Please add more items.`
            : "Your order is below the minimum for this account. Please add more items.")
        : precisaVariante
        ? "One of the items needs an option (size/color) chosen. Please open the product and pick one."
        : produtoIndisponivel
          ? "One of the items is no longer available for ordering. Please remove it from your cart and try again."
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

    // O banco e a AUTORIDADE do preco, e ele pode discordar da tela: cupom
    // recusado por validade/uso (o servidor zera `coupon_id`), preco de produto
    // alterado enquanto o carrinho estava aberto, regra de frete por zona que o
    // front nao conhece.
    //
    // Cobrar mais do que a tela mostrou, em silencio, nao e opcao. Se o banco
    // pedir MAIS, desfaz e manda o cliente reconferir. Se pedir MENOS, segue —
    // ninguem se prejudica e parar seria so atrapalhar.
    //
    // Tolerancia de 1 centavo: `total` e NUMERIC(12,2) no banco e float aqui;
    // sem isso um 30.599999999999998 contra 30.60 barraria pedido legitimo.
    // Tolerancia de 3 centavos, nao 1: o banco faz TRES `round(...,2)`
    // independentes (desconto, frete, imposto) contra aritmetica float aqui.
    // No pior caso os tres arredondam para o mesmo lado e a diferenca legitima
    // passa de um centavo. 3 centavos ainda pega qualquer divergencia de regra.
    if (taxLookupOk && finalTotal - recalcGrossTotal > 0.03) {
      await desfazerPedido(pedido.id);
      toast.error(
        `The price changed while you were checking out ($${recalcGrossTotal.toFixed(2)} → $${finalTotal.toFixed(2)}). ` +
        `Nothing was charged. Please review your cart and try again.`
      );
      setLoading(false);
      return;
    }
    // Email usa os totais AUTORITATIVOS (recomputados pelos triggers), não os do insert.
    const emailOrder = { ...pedido, ...((fresh as any) || {}) };

    // Incrementa uso do cupom de forma ATÔMICA (não read-modify-write) e só se o
    // desconto realmente entrou (o trigger valida ativo/datas/uso no servidor).
    // SÓ é chamado quando o pedido REALMENTE se concretiza: antes isto rodava aqui,
    // ANTES do pagamento — cartão recusado cancelava o pedido mas o cupom já tinha
    // sido consumido (cupom de uso único ficava queimado sem venda nenhuma).
    // O CUPOM E CONSUMIDO NO SERVIDOR desde 20260825380000.
    //
    // Aqui existia um `bumpCouponUsage()` que chamava `increment_coupon_usage`
    // depois de fechar o pedido. Quem contava o uso era o NAVEGADOR — e um
    // cliente que simplesmente nao fizesse a chamada reusava um cupom de uso
    // unico quantas vezes quisesse. O preco de cada pedido saia certo; o LIMITE
    // e que nao existia.
    //
    // Agora um gatilho conta no INSERT do pedido e DEVOLVE quando ele e
    // cancelado ou apagado — o que resolve o motivo de a contagem estar no fim
    // do fluxo: cartao recusado nao queima mais o cupom.

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
        await desfazerPedido(pedido.id);
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
        await desfazerPedido(pedido.id);
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        // QUEM CARIMBA `is_paid` E O SERVIDOR, NAO O NAVEGADOR.
        //
        // Aqui havia um `supabase.from("pedidos").update({ is_paid: true, ... })`
        // direto da tela do cliente. Ele NUNCA funcionou: as policies de `pedidos`
        // dao ao cliente SELECT e INSERT — UPDATE so existe para Warehouse e
        // Manager. A RLS filtra a linha, o comando atinge ZERO linhas e o
        // supabase-js devolve 204 SEM `error`. O retorno nem era capturado.
        //
        // O estrago: o cartao JA foi cobrado, e o pedido ficava `is_paid = false`
        // com `payment_intent_id` NULO — sem nem o id da cobranca para reconciliar
        // depois. So o webhook `payment_intent.succeeded` salvaria, e ele depende
        // do segredo estar cadastrado e e assincrono.
        //
        // A acao `confirm_payment` da edge function ja existia e faz exatamente
        // isto, do jeito certo: busca a intencao no Stripe (nao confia no que o
        // navegador diz), confere a POSSE do pedido antes de carimbar, grava com
        // service role e e idempotente (`.eq("is_paid", false)`). Nunca era chamada.
        const { data: confData, error: confError } = await supabase.functions.invoke(
          "stripe-checkout",
          { body: { action: "confirm_payment", payment_intent_id: paymentIntent.id } },
        );
        if (confError || confData?.status !== "succeeded") {
          // NAO desfaz o pedido: o dinheiro entrou. Desfazer aqui deixaria o
          // cliente cobrado e sem pedido — o pior desfecho possivel. O pedido fica
          // de pe, e o admin reconcilia pelo `payment_intent_id`, que o cliente ve
          // na mensagem.
          toast.error(
            `Your card was charged, but we could not confirm the payment on the order. ` +
            `Do NOT pay again. Save this reference and contact us: ${paymentIntent.id}`,
          );
          console.error("[checkout] confirm_payment falhou", pedido.id, paymentIntent.id, confError ?? confData);
        }
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

        {/* ANTES DO FORMULARIO, e nao um toast: com a leitura falhada os blocos de
            frete e pagamento simplesmente NAO APARECEM (estao sob `.length > 0`),
            e o cliente fecharia o pedido com frete zero sem nunca saber que havia
            uma escolha a fazer. */}
        {loadError && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-medium text-destructive">Could not load the shipping and payment options.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Please reload before placing this order — otherwise it would be submitted without a shipping method.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>Try again</Button>
          </div>
        )}

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
          {/* `!taxLookupOk` PRECISA DE LINHA PROPRIA. A condicao era `salesTax > 0`:
              com a leitura do imposto falhada, `taxRate` fica 0, `salesTax` fica 0
              e a linha inteira SUMIA — sem imposto, sem aviso, com o total logo
              abaixo impresso como numero definitivo. Enquanto isso o banco resolve
              a mesma consulta com `LIMIT 1` e cobra a aliquota de verdade.
              O `Carrinho` (`Carrinho.tsx:463-469`) ja fazia o certo: `—` e aviso.
              O Checkout, que e onde o dinheiro sai, nao tinha copiado. */}
          {!taxLookupOk ? (
            <div className="flex items-center justify-between text-sm">
              <span>Sales Tax</span>
              <span className="text-destructive">—</span>
            </div>
          ) : salesTax > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span>Sales Tax ({taxRate}%)</span>
              <span>${salesTax.toFixed(2)}</span>
            </div>
          ) : null}
          {shippingCost > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span>Shipping</span>
              <span>${shippingCost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between font-bold pt-1 border-t">
            <span>Gross total</span>
            <span className="text-lg">{taxLookupOk ? `$${grossTotal.toFixed(2)}` : "—"}</span>
          </div>
          {!taxLookupOk && (
            <p className="pt-1 text-xs text-destructive">
              Sales tax could not be calculated, so this total is not final. Card payment is
              unavailable until it can be — please send the order and we will confirm the total,
              or reload to try again.
            </p>
          )}
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
          {/* `!!loadError` BLOQUEIA OS DOIS CAMINHOS. So mostrar o card de aviso
              nao bastava: sem opcao de frete na tela, `shippingId` fica "",
              `handleSubmit` nao exige frete, e `fn_pedido_total_appside` grava
              `shipping_costs := 0`. O cliente ignorava o card vermelho, clicava
              SEND ORDER e o pedido entrava com frete gratis — o defeito que a
              guarda dizia ter fechado.

              CARTAO BLOQUEADO com o imposto por ler. `taxLookupOk` era usado num
              lugar so — para DESLIGAR a guarda de preco (linha ~836) —, entao o
              unico efeito de nao saber o imposto era remover a protecao contra
              cobrar a mais. O botao continuava prometendo `PAY $X` e cobrando
              `finalTotal`, que ja vem do banco COM o imposto. Pedido sem cartao
              continua liberado: ali o valor e confirmado antes de cobrar. */}
          <Button onClick={handleSubmit} disabled={loading || !!loadError || (payByCard && (!stripeReady || !taxLookupOk)) || outOfStock.length > 0}>
            {loading
              ? payByCard ? "Processing payment..." : "Sending..."
              : payByCard
              ? taxLookupOk ? `PAY $${grossTotal.toFixed(2)}` : "TOTAL UNAVAILABLE"
              : loadError ? "RELOAD REQUIRED" : "SEND ORDER"}
          </Button>
        </div>
      </Card>
    </PortalLayout>
  );
};

export default Checkout;
