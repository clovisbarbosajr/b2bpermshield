import { supabase } from "@/integrations/supabase/client";

export type PriceSource = "customer" | "price_list" | "discount" | "base";

export interface PriceResult {
  price: number;
  source: PriceSource;
}

// A CASCATA, pura. E o espelho de `preco_autoritativo` no banco:
//   1) produto_precos_cliente (na CONTA da empresa)  — `IS NOT NULL`, zero vale
//   2) tabela_preco_itens (tabela do sub-login, senao a da empresa)
//   3) produtos.preco (NULL -> 0)
//
// O ramo `aplicar_descontos_extras`, que aplicava desconto POR CIMA do preco
// combinado, saiu em 28/ago/2026 junto com o desconto por quantidade. Ver
// `supabase/migrations/20260828040000_desconto_sai_do_preco.sql`. A coluna
// continua na tabela e volta a valer sozinha se o rollback for aplicado.
//
// O desconto por quantidade ficava entre 2) e 3). Removido em 28/ago/2026
// (decisao da Jess: "todo tipo de desconto" sai, "preco do cliente vai pela
// tabela de preco"), junto com o lado do servidor.
//
// ESTE ARQUIVO E O `preco_autoritativo` DO BANCO TEM QUE CONCORDAR. O banco e
// quem cobra; este aqui e o que a vitrine mostra. Se um aplicar desconto e o
// outro nao, o produto com desconto diverge — e a guarda do checkout so pega
// a divergencia em UMA direcao (quando o banco cobra MAIS). Mexer aqui sem
// mexer la vende mais barato em silencio.
export function resolverPreco({
  base,
  precoCliente,
  itemLista,
}: {
  base: number | null | undefined;
  precoCliente?: number | null;
  itemLista?: number | null;
}): PriceResult {
  if (precoCliente != null) return { price: Number(precoCliente), source: "customer" };
  if (itemLista != null) return { price: Number(itemLista), source: "price_list" };
  return { price: Number(base ?? 0), source: "base" };
}

const BLOCO = 100;

// I/O em lote: 1x `clientes` (+1x a conta, se sub-login) e, por bloco de 100
// produtos, uma leitura de cada tabela da cascata. Qualquer `error` LANCA — nunca
// devolve preco base fingindo que deu certo; as telas contam com isso para avisar.
export async function getProductPrices({
  productIds,
  customerId,
}: {
  productIds: string[];
  customerId: string;
  // Sem uso desde 28/ago/2026 (desconto por quantidade saiu). Fica na assinatura
  // para os chamadores continuarem dizendo COM QUE quantidade pediram o preco.
  quantities?: Record<string, number>;
}): Promise<Record<string, PriceResult>> {
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
  const accountId = cliente?.parent_customer_id ?? customerId;

  // Tabela do sub-login se ele tiver uma; senão a da empresa. O trigger
  // `trg_subuser_inherit_pricelist` copia a do pai no INSERT, mas é um SNAPSHOT —
  // fica velho se o pai trocar de tabela depois.
  let tabelaPrecoId: string | null = cliente?.tabela_preco_id ?? null;
  if (accountId !== customerId) {
    const { data: conta, error: contaErr } = await supabase
      .from("clientes")
      .select("tabela_preco_id")
      .eq("id", accountId)
      .maybeSingle();
    if (contaErr) throw new Error(`Erro ao buscar conta: ${contaErr.message}`);
    tabelaPrecoId ??= conta?.tabela_preco_id ?? null;
  }

  const out: Record<string, PriceResult> = {};
  for (let i = 0; i < productIds.length; i += BLOCO) {
    const bloco = productIds.slice(i, i + BLOCO);
    const [produtosRes, customerPriceRes, plRes] = await Promise.all([
      supabase.from("produtos").select("id, preco").in("id", bloco),
      supabase
        .from("produto_precos_cliente")
        .select("produto_id, preco")
        .eq("cliente_id", accountId)
        .in("produto_id", bloco),
      tabelaPrecoId
        ? supabase
            .from("tabela_preco_itens")
            .select("produto_id, preco")
            .eq("tabela_preco_id", tabelaPrecoId)
            .in("produto_id", bloco)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (produtosRes.error) throw new Error(`Erro ao buscar produto: ${produtosRes.error.message}`);
    if (customerPriceRes.error) throw new Error(`Erro ao buscar preço cliente: ${customerPriceRes.error.message}`);
    if (plRes.error) throw new Error(`Erro ao buscar tabela de preço: ${plRes.error.message}`);

    const base = new Map((produtosRes.data ?? []).map((p) => [p.id, p.preco]));
    const doCliente = new Map((customerPriceRes.data ?? []).map((r) => [r.produto_id, r.preco]));
    const daLista = new Map((plRes.data ?? []).map((r) => [r.produto_id, r.preco]));
    for (const id of bloco) {
      out[id] = resolverPreco({
        base: base.get(id),
        precoCliente: doCliente.get(id),
        itemLista: daLista.get(id),
      });
    }
  }
  return out;
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
  const r = await getProductPrices({ productIds: [productId], customerId, quantities: { [productId]: quantity } });
  return r[productId];
}

// A funcao `resolveDiscount` ficava AQUI, e foi removida em 28/ago/2026 junto com
// as duas chamadas dela. O corpo da regra continua no banco, em
// `_resolve_desconto`, sem chamador — e de la que se religa, se a decisao voltar
// atras, sem precisar reescrever nada.
//
// `PriceSource` mantem o valor "discount" de proposito: `produto_precos_cliente`
// e `pedido_itens` gravados antes de hoje podem carregar esse rotulo, e tirar o
// tipo faria o `tsc` reclamar de dado que existe.
