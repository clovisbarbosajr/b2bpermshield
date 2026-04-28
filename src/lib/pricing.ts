import { supabase } from "@/integrations/supabase/client";

export type PriceSource = "customer" | "price_list" | "discount" | "base";

export interface PriceResult {
  price: number;
  source: PriceSource;
}

export async function getProductPrice({
  productId,
  customerId,
  quantity = 1,
}: {
  productId: string;
  customerId: string;
  quantity?: number;
}): Promise<PriceResult> {
  const [clienteRes, customerPriceRes, produtoRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("tabela_preco_id")
      .eq("id", customerId)
      .maybeSingle(),
    supabase
      .from("produto_precos_cliente")
      .select("preco, aplicar_descontos_extras")
      .eq("produto_id", productId)
      .eq("cliente_id", customerId)
      .maybeSingle(),
    supabase
      .from("produtos")
      .select("preco")
      .eq("id", productId)
      .maybeSingle(),
  ]);

  if (clienteRes.error) throw new Error(`Erro ao buscar cliente: ${clienteRes.error.message}`);
  if (customerPriceRes.error) throw new Error(`Erro ao buscar preço cliente: ${customerPriceRes.error.message}`);
  if (produtoRes.error) throw new Error(`Erro ao buscar produto: ${produtoRes.error.message}`);

  const basePrice = Number(produtoRes.data?.preco ?? 0);
  const tabelaPrecoId = clienteRes.data?.tabela_preco_id ?? null;
  const customerPrice = customerPriceRes.data;
  const aplicarDescontosExtras = customerPrice?.aplicar_descontos_extras === true;

  // 1) produto_precos_cliente — highest priority
  if (customerPrice && customerPrice.preco != null) {
    // If aplicar_descontos_extras, check discounts on top of customer price
    if (aplicarDescontosExtras) {
      const discountResult = await resolveDiscount(productId, tabelaPrecoId, quantity, Number(customerPrice.preco));
      if (discountResult) {
        return discountResult;
      }
    }
    return { price: Number(customerPrice.preco), source: "customer" };
  }

  // 2) tabela_preco_itens
  if (tabelaPrecoId) {
    const { data: plItem, error: plError } = await supabase
      .from("tabela_preco_itens")
      .select("preco")
      .eq("tabela_preco_id", tabelaPrecoId)
      .eq("produto_id", productId)
      .maybeSingle();

    if (plError) throw new Error(`Erro ao buscar tabela de preço: ${plError.message}`);

    if (plItem && plItem.preco != null) {
      return { price: Number(plItem.preco), source: "price_list" };
    }
  }

  // 3) produto_descontos — with tabela_preco_id or global (null)
  const discountResult = await resolveDiscount(productId, tabelaPrecoId, quantity, basePrice);
  if (discountResult) {
    return discountResult;
  }

  // 4) Fallback: produtos.preco
  return { price: basePrice, source: "base" };
}

async function resolveDiscount(
  productId: string,
  tabelaPrecoId: string | null,
  quantity: number,
  referencePrice: number,
): Promise<PriceResult | null> {
  // Build query for discounts matching tabela_preco_id OR global (no tabela)
  let query = supabase
    .from("produto_descontos")
    .select("percentual, preco_final, quantidade_minima, data_inicio, data_fim, tabela_preco_id")
    .eq("produto_id", productId)
    .lte("quantidade_minima", quantity)
    .order("quantidade_minima", { ascending: false })
    .limit(50);

  if (tabelaPrecoId) {
    query = query.or(`tabela_preco_id.eq.${tabelaPrecoId},tabela_preco_id.is.null`);
  } else {
    query = query.is("tabela_preco_id", null);
  }

  const { data: descontos, error } = await query;

  if (error) throw new Error(`Erro ao buscar descontos: ${error.message}`);

  if (!descontos || descontos.length === 0) return null;

  const now = new Date();
  const valid = descontos.filter((d) => {
    if (d.data_inicio && new Date(d.data_inicio) > now) return false;
    if (d.data_fim && new Date(d.data_fim) < now) return false;
    return true;
  });

  // Prefer specific (tabela_preco_id match) over global (null)
  const specific = valid.filter((d) => d.tabela_preco_id === tabelaPrecoId);
  const candidates = specific.length > 0 ? specific : valid;

  if (candidates.length === 0) return null;

  const best = candidates[0];

  if (best.preco_final != null && Number(best.preco_final) > 0) {
    return { price: Number(best.preco_final), source: "discount" };
  }
  if (best.percentual != null && Number(best.percentual) > 0) {
    const discounted = referencePrice * (1 - Number(best.percentual) / 100);
    return { price: Math.round(discounted * 100) / 100, source: "discount" };
  }

  return null;
}
