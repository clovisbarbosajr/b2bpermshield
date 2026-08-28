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
      .select("preco")
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

  // 1) produto_precos_cliente — highest priority
  //
  // O ramo `aplicar_descontos_extras`, que aplicava desconto POR CIMA do preco
  // combinado, saiu em 28/ago/2026 junto com o desconto por quantidade. Ver
  // `supabase/migrations/20260828040000_desconto_sai_do_preco.sql`. A coluna
  // continua na tabela e volta a valer sozinha se o rollback for aplicado.
  if (customerPrice && customerPrice.preco != null) {
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

  // 3) O desconto por quantidade ficava AQUI. Removido em 28/ago/2026 (decisao da
  //    Jess: "todo tipo de desconto" sai, "preco do cliente vai pela tabela de
  //    preco"), junto com o lado do servidor.
  //
  //    ESTE ARQUIVO E O `preco_autoritativo` DO BANCO TEM QUE CONCORDAR. O banco e
  //    quem cobra; este aqui e o que a vitrine mostra. Se um aplicar desconto e o
  //    outro nao, o produto com desconto diverge — e a guarda do checkout so pega
  //    a divergencia em UMA direcao (quando o banco cobra MAIS). Mexer aqui sem
  //    mexer la vende mais barato em silencio.

  // 4) Fallback: produtos.preco
  return { price: basePrice, source: "base" };
}

// A funcao `resolveDiscount` ficava AQUI, e foi removida em 28/ago/2026 junto com
// as duas chamadas dela. O corpo da regra continua no banco, em
// `_resolve_desconto`, sem chamador — e de la que se religa, se a decisao voltar
// atras, sem precisar reescrever nada.
//
// `PriceSource` mantem o valor "discount" de proposito: `produto_precos_cliente`
// e `pedido_itens` gravados antes de hoje podem carregar esse rotulo, e tirar o
// tipo faria o `tsc` reclamar de dado que existe.
