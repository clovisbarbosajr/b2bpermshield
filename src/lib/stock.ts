/**
 * Identidade de uma linha do carrinho = produto + variante. Duas variantes do
 * mesmo produto são linhas DISTINTAS. Item sem variante => chave "produto::".
 *
 * Mora aqui (módulo puro) e não no CartContext porque o CartContext importa o
 * cliente Supabase — quem só precisa da chave não deveria arrastar isso junto
 * (era o que quebrava o teste). O CartContext re-exporta, então todo
 * `import { cartKey } from "@/contexts/CartContext"` continua valendo.
 */
export const cartKey = (i: { produto_id: string; variante_id?: string | null }) =>
  `${i.produto_id}::${i.variante_id ?? ""}`;

/**
 * Disponibilidade do carrinho — REGRA ÚNICA, usada nos 3 pontos que validavam
 * estoque cada um do seu jeito (watcher do Carrinho, aviso do Checkout e
 * re-validação do submit).
 *
 * Duas coisas precisam valer AO MESMO TEMPO:
 *
 *  (a) por VARIANTE — a linha não pode passar de `produto_variantes.quantidade`.
 *      Antes ninguém olhava isso fora da página do produto: dava pra entrar pela
 *      página (que valida certo), mudar a quantidade NO CARRINHO e fechar 10 de
 *      um tamanho que só tem 2.
 *
 *  (b) por PRODUTO — a SOMA das linhas do mesmo produto não pode passar de
 *      `estoque_total - estoque_reservado`. Variantes são linhas distintas
 *      (cartKey = produto+variante) mas dividem o mesmo estoque do produto, e a
 *      reserva no banco é por produto. Sem somar, 6 "Tam M" + 6 "Tam G" passavam
 *      as duas com estoque 10 e o pedido furava a reserva.
 *
 * Pré-venda (`pre-order`) ignora as duas — é backorder de propósito.
 */

export type StockItem = {
  produto_id: string;
  variante_id?: string | null;
  quantidade: number;
  nome: string;
};

export type StockProduct = {
  id: string;
  estoque_total: number | null;
  estoque_reservado: number | null;
  status_produto?: string | null;
};

export type StockVariant = {
  id: string;
  produto_id: string;
  quantidade: number | null;
};

export type StockStatus = { nome: string; permite_comprar?: boolean | null };

/** Nomes em pt do `produtos.status_produto` → nomes em en de `product_statuses`. */
const NAME_MAP: Record<string, string> = {
  disponivel: "available",
  indisponivel: "not available",
  esgotado: "sold out",
  pre_venda: "pre-order",
  estoque_limitado: "limited stock",
  descontinuado: "discontinued",
};

export const normalizeStatus = (raw?: string | null): string =>
  (NAME_MAP[raw || "disponivel"] || raw || "disponivel").toLowerCase();

export type StockCheck = {
  /** cartKey → item que NÃO pode ser comprado (esgotado/status bloqueia). Remover. */
  blocked: Map<string, StockItem>;
  /** cartKey → quanto ainda dá pra levar (tem estoque, mas menos que o pedido). Reduzir. */
  insufficient: Map<string, number>;
};

export function checkCartStock(
  items: StockItem[],
  produtos: StockProduct[],
  statuses: StockStatus[],
  variantes: StockVariant[] = [],
): StockCheck {
  const blocked = new Map<string, StockItem>();
  const insufficient = new Map<string, number>();

  const statusMap = new Map(statuses.map((s) => [s.nome.toLowerCase(), s.permite_comprar ?? true]));
  const prodById = new Map(produtos.map((p) => [p.id, p]));
  const varById = new Map(variantes.map((v) => [v.id, v]));

  // (b) soma pedida por produto — variantes do mesmo produto entram juntas.
  const pedidoPorProduto = new Map<string, number>();
  for (const it of items) {
    pedidoPorProduto.set(it.produto_id, (pedidoPorProduto.get(it.produto_id) ?? 0) + it.quantidade);
  }

  for (const item of items) {
    const prod = prodById.get(item.produto_id);
    if (!prod) continue; // produto sumiu do catálogo: quem decide é o banco no submit

    const normalized = normalizeStatus(prod.status_produto);
    const canBuy = statusMap.get(normalized) ?? true;
    const isPreOrder = normalized === "pre-order";
    const key = cartKey(item);

    if (!canBuy) {
      blocked.set(key, item);
      continue;
    }
    if (isPreOrder) continue; // backorder: sem piso de estoque

    const dispProduto = (prod.estoque_total ?? 0) - (prod.estoque_reservado ?? 0);

    // (a) teto da variante, quando a linha tem uma.
    let teto = dispProduto;
    if (item.variante_id) {
      const v = varById.get(item.variante_id);
      // Variante que sumiu (desativada/apagada) é bloqueio, não "estoque 0 do produto".
      if (!v) { blocked.set(key, item); continue; }
      teto = Math.min(dispProduto, v.quantidade ?? 0);
    }

    if (teto < 1) { blocked.set(key, item); continue; }

    // (b) a soma do produto inteiro também limita esta linha.
    const totalDoProduto = pedidoPorProduto.get(item.produto_id) ?? item.quantidade;
    if (item.quantidade > teto || totalDoProduto > dispProduto) {
      insufficient.set(key, teto);
    }
  }

  return { blocked, insufficient };
}
