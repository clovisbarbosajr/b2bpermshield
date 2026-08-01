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
  const { data: cliente, error: clienteErr } = await supabase
    .from("clientes")
    .select("tabela_preco_id, parent_customer_id")
    .eq("id", customerId)
    .maybeSingle();
  if (clienteErr) throw new Error(`Erro ao buscar cliente: ${clienteErr.message}`);

  // Sub-login usa a CONTA DA EMPRESA pra preço — mesma convenção
  // COALESCE(parent_customer_id, id) do resto do repo (privacidade, RLS). A RLS de
  // `produto_precos_cliente` já libera o sub-login a LER os preços do pai
  // (`is_subcustomer_of`), mas ninguém pedia por eles: o funcionário via preço de
  // tabela/base enquanto o dono via o preço negociado.
  const accountId = (cliente as any)?.parent_customer_id ?? customerId;

  const [accountRes, customerPriceRes, produtoRes] = await Promise.all([
    accountId === customerId
      ? Promise.resolve({ data: cliente, error: null } as any)
      : supabase.from("clientes").select("tabela_preco_id").eq("id", accountId).maybeSingle(),
    supabase
      .from("produto_precos_cliente")
      .select("preco, aplicar_descontos_extras")
      .eq("produto_id", productId)
      .eq("cliente_id", accountId)
      .maybeSingle(),
    supabase
      .from("produtos")
      .select("preco")
      .eq("id", productId)
      .maybeSingle(),
  ]);

  if (accountRes.error) throw new Error(`Erro ao buscar conta: ${accountRes.error.message}`);
  if (customerPriceRes.error) throw new Error(`Erro ao buscar preço cliente: ${customerPriceRes.error.message}`);
  if (produtoRes.error) throw new Error(`Erro ao buscar produto: ${produtoRes.error.message}`);

  const basePrice = Number(produtoRes.data?.preco ?? 0);
  // Tabela do sub-login se ele tiver uma; senão a da empresa. O trigger
  // `trg_subuser_inherit_pricelist` copia a do pai no INSERT, mas é um SNAPSHOT —
  // fica velho se o pai trocar de tabela depois.
  const tabelaPrecoId = (cliente as any)?.tabela_preco_id
    ?? (accountRes.data as any)?.tabela_preco_id
    ?? null;
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
  // Sem os milissegundos: o `.` é separador na sintaxe `col.op.valor` do filtro
  // `or` do PostgREST, e "…:00.000Z" quebraria o parse do valor.
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // Datas filtradas NO BANCO (era em JS, DEPOIS do .limit(50): 50 faixas expiradas
  // do mesmo produto escondiam a válida e o cliente perdia o desconto). O servidor
  // (`_resolve_desconto`) sempre filtrou em SQL — este é o lado que divergia, e o
  // servidor é quem grava o preço no pedido.
  let query = supabase
    .from("produto_descontos")
    .select("percentual, preco_final, quantidade_minima, data_inicio, data_fim, tabela_preco_id")
    .eq("produto_id", productId)
    .lte("quantidade_minima", quantity)
    .or(`data_inicio.is.null,data_inicio.lte.${nowIso}`)
    .or(`data_fim.is.null,data_fim.gte.${nowIso}`)
    .order("quantidade_minima", { ascending: false })
    .limit(50);

  // `tabela_preco_id` é NOT NULL na tabela, então a perna `.is.null` nunca casa —
  // desconto "global" (pra todas as tabelas) é inexpressável no schema atual. Fica
  // no OR de propósito: se um dia a coluna virar nullable, isto passa a funcionar
  // sem precisar mexer aqui. Cliente SEM tabela de preço não tem desconto por
  // quantidade nenhum — é consequência do schema, não deste código.
  if (tabelaPrecoId) {
    query = query.or(`tabela_preco_id.eq.${tabelaPrecoId},tabela_preco_id.is.null`);
  } else {
    query = query.is("tabela_preco_id", null);
  }

  const { data: descontos, error } = await query;

  if (error) throw new Error(`Erro ao buscar descontos: ${error.message}`);

  if (!descontos || descontos.length === 0) return null;

  // Prefer specific (tabela_preco_id match) over global (null)
  const specific = descontos.filter((d) => d.tabela_preco_id === tabelaPrecoId);
  const candidates = specific.length > 0 ? specific : descontos;

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
