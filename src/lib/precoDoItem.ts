import { getProductPrice } from "./pricing";

/**
 * Preco a EXIBIR para um item que esta entrando no carrinho, e se ele e certeza.
 *
 * Duas telas escreviam esta decisao a mao — `Carrinho.moveToCart` e
 * `PedidoDetalhe.handleAddToOrder` — com o mesmo `try/catch`, o mesmo fallback e
 * o mesmo aviso, copiados. A decisao e curta mas tem quatro caminhos, e tres
 * deles so aparecem quando algo da errado; nenhum e alcancavel por teste sem
 * montar a tela inteira. Um cacador plantou quatro mutantes no bloco copiado do
 * Carrinho — inclusive apagar o preco calculado e deixar o do localStorage, que
 * "pode ter meses" — e a suite de 492 ficou VERDE nos quatro.
 *
 * Aqui a mesma decisao roda em teste de verdade, com o banco simulado, e as duas
 * telas viram uma chamada.
 *
 * O `cliente` tem TRES estados, e eles nao sao o mesmo:
 *   `string`    — sei quem e: usa a cascata (preco combinado, tabela do cliente,
 *                 tabela da empresa, preco base), e o resultado e certeza.
 *   `null`      — a leitura DEU CERTO e nao ha ficha (staff no portal fora do
 *                 "view as"). O preco base E o preco certo. Nada a avisar.
 *   `undefined` — nao sei: a leitura falhou, ou ainda esta no ar. O preco base
 *                 entra, como antes, mas e um CHUTE — e quem chama tem que dizer
 *                 isso ao cliente.
 * Achatar `undefined` em `null` foi o defeito original: quem tinha preco
 * negociado levava o produto ao carrinho pelo preco de balcao, calado.
 *
 * NUNCA passe o `parent_customer_id` como `clienteId`. `pricing.ts` resolve o pai
 * sozinho para o que precisa dele, e a precedencia de tabela e
 * `cliente.tabela_preco_id ?? conta.tabela_preco_id` — a do sub-login vence.
 * Entregando o pai ja resolvido, a linha do sub nunca e lida, e o servidor cobra
 * outro valor (`preco_autoritativo` faz `COALESCE(_tp_self, _tp_conta)` com
 * `pedidos.cliente_id`).
 *
 * Falha NUNCA bloqueia: cai no preco base, que era o comportamento antes de tudo
 * isto. O valor COBRADO continua sendo o do servidor
 * (`fn_pedido_item_preco_autoritativo`) — o que esta em jogo aqui e o carrinho
 * mentir, que e o que faz o cliente desistir ou ligar reclamando.
 */
export async function precoDoItem({
  produtoId,
  clienteId,
  quantidade = 1,
  precoBase,
}: {
  produtoId: string;
  clienteId: string | null | undefined;
  quantidade?: number;
  precoBase: number;
}): Promise<{ preco: number; incerto: boolean }> {
  if (clienteId === null) return { preco: precoBase, incerto: false };
  if (!clienteId) return { preco: precoBase, incerto: true };

  try {
    const r = await getProductPrice({ productId: produtoId, customerId: clienteId, quantity: quantidade });
    return { preco: r.price, incerto: false };
  } catch (e) {
    console.error("preco do cliente indisponivel; usando o preco base", e);
    return { preco: precoBase, incerto: true };
  }
}

/**
 * Quem e o cliente, para efeito de PRECO — nos tres estados que importam.
 *
 * A tela precisa dizer isto em dois momentos: na montagem, antes de qualquer ida
 * ao banco, e de novo quando a leitura volta. Enquanto os dois moravam soltos no
 * componente (`useState(undefined)` de um lado, `setClienteId(...)` do outro),
 * nenhum dos dois tinha teste, e um cacador plantou os dois mutantes que
 * reintroduzem o defeito ORIGINAL com a suite inteira verde:
 *   - `useState(null)` no lugar de `useState(undefined)`: quem clica antes da
 *     consulta voltar leva o produto pelo preco de balcao SEM aviso;
 *   - `setClienteId(data?.id ?? null)` no lugar desta funcao: falha de RLS vira
 *     "nao tem ficha", e o preco de balcao entra calado, para sempre — nada
 *     redispara o efeito.
 * Agora os dois momentos sao a MESMA chamada, e ela roda em teste.
 *
 * Os estados:
 *   `impersonatedId`      — "view as": e esse cliente, e e certeza.
 *   sem `userId`          — deslogado. O preco base E o certo; nada a avisar.
 *   sem `leitura`         — ainda no ar. Nao sei.
 *   `leitura.error`       — falhou. Nao sei.
 *   leitura OK            — o id, ou `null` se nao ha ficha (staff no portal).
 */
export function clienteDoPortal({
  impersonatedId,
  userId,
  leitura,
}: {
  impersonatedId?: string | null;
  userId?: string | null;
  leitura?: { data: { id?: string | null } | null; error: unknown } | null;
}): string | null | undefined {
  if (impersonatedId) return impersonatedId;
  if (!userId) return null;
  if (!leitura) return undefined;      // ainda no ar
  if (leitura.error) return undefined; // falhou: nao sei, e nao "nao tem"
  return leitura.data?.id ?? null;
}

/** O que a tela diz quando `incerto` — uma frase so, para as duas nao divergirem. */
export const AVISO_PRECO_INCERTO =
  "Showing the list price — your price will be applied at checkout.";
