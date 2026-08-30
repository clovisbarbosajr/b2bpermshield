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
  /** Reservado por pedido em aberto. Ver o comentário no cálculo do teto. */
  estoque_reservado?: number | null;
};

export type StockStatus = { nome: string; permite_comprar?: boolean | null };

/** Nomes em pt do `produtos.status_produto` → nomes em en de `product_statuses`.
 *
 * ESTA MESMA TABELA EXISTE NO BANCO, em `fn_item_produto_valido`
 * (migration 20260825330000). Mexeu aqui, mexa lá — senão a trava do banco para
 * de casar e vira decoração: nada bate, e como a regra é conservadora
 * ("não achou, não bloqueia"), ela simplesmente nunca dispara.
 */
// OS SEIS NOMES SAO CHAVE DE SISTEMA, e nao rotulo livre.
//
// `produtos.status_produto` guarda o codigo em portugues; `product_statuses.nome`
// guarda o rotulo em ingles; e NAO EXISTE FK entre os dois. Todo o casamento e
// por NOME, e os tres consumidores falham ABRINDO quando nao acham:
//   `stock.ts`, no `podeComprar`  -> `statusMap.get(normalized) ?? true`
//   `Catalogo.tsx`, no `canBuy`   -> `?? { permite_comprar: true, permite_visualizar: true }`
//   `Catalogo.tsx`, no filtro da vitrine -> `!(st && st.permite_visualizar === false)`,
//     que falha abrindo pelo mesmo motivo com outra forma: status inexistente nao
//     e `st` nenhum, entao o produto VOLTA a aparecer na loja. Renomear/apagar nao
//     desliga so a trava de compra: desliga tambem a ocultacao.
//   `fn_item_produto_valido`    -> denylist, `LIMIT 1`, nao achou = deixa passar
//
// Renomear "Sold Out" na tela de Product Statuses devolve ao catalogo, comprável,
// todo produto que o admin tirou de venda DE PROPOSITO com estoque em caixa (fim
// de linha, reservado, problema de qualidade). Apagar o status faz o mesmo.
//
// A tela avisa antes de renomear/apagar um destes seis. Fechar de verdade exige
// decisao do dono — proteger as seis linhas no banco, ou trocar
// `produtos.status_produto` por FK — e esta na batelada de perguntas.
export const NOMES_DE_SISTEMA = [
  "available", "not available", "sold out", "pre-order", "limited stock", "discontinued",
];

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
  // Quais produtos tem QUALQUER variante ativa. Alimentado pelas variantes que o
  // chamador ja carrega para o carrinho — ver o comentario do bloqueio abaixo.
  const variantesPorProduto = new Map<string, boolean>();
  for (const v of variantes) if (v.produto_id) variantesPorProduto.set(v.produto_id, true);

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
      // DESCONTA O RESERVADO DA VARIANTE, igual ao que já se faz com o produto-pai
      // duas linhas acima.
      //
      // A partir de 20260825320000 quem decide no banco é
      // `quantidade - estoque_reservado`. Se a tela olhasse só `quantidade`, um
      // tamanho com pedido aberto apareceria como disponível, o cliente fecharia,
      // e o banco recusaria com "um item acabou de esgotar" — sem o carrinho
      // dizer quanto reduzir, e sem ele entender por quê.
      const dispVariante = (v.quantidade ?? 0) - (v.estoque_reservado ?? 0);
      teto = Math.min(dispProduto, dispVariante);
    } else if (variantesPorProduto.get(item.produto_id)) {
      // Linha SEM variante num produto que TEM variante hoje: bloqueia.
      //
      // O carrinho vive no localStorage indefinidamente. O cliente pode ter
      // colocado o produto antes de ele ganhar opcao — e aI a linha viajava ate
      // o pedido como produto-pai, com o preco do pai, em silencio. As guardas
      // de tela (catalogo, re-order, saved-for-later) fecham as portas de
      // ENTRADA; esta fecha a de SAIDA, que e a que decide.
      blocked.set(key, item);
      continue;
    }

    if (teto < 1) { blocked.set(key, item); continue; }

    // (b) a soma do produto inteiro também limita esta linha — e o numero que vai
    //     para a tela tem que ser o que DESTRAVA esta linha, nao o teto da variante.
    //
    // O BUG: com produto de 10, variantes A e B de 8 cada, e 6+6 no carrinho,
    // nenhuma linha passa do proprio teto (6 < 8) mas a soma passa (12 > 10).
    // As duas linhas eram marcadas com `teto` = 8, e a tela dizia "Only 8 left"
    // numa linha que tinha 6. O cliente obedecia, punha 8, e a badge continuava
    // igual — nao existia valor indicado pela mensagem que resolvesse, porque a
    // mensagem falava do teto da variante e a trava vinha da SOMA.
    //
    // Agora o numero e a folga REAL desta linha: o que sobra do produto depois
    // das OUTRAS linhas dele, limitado pelo teto da variante. Reduzir para esse
    // numero sempre destrava.
    const totalDoProduto = pedidoPorProduto.get(item.produto_id) ?? item.quantidade;
    const outrasLinhas = totalDoProduto - item.quantidade;
    const maxDestaLinha = Math.min(teto, dispProduto - outrasLinhas);

    if (maxDestaLinha < 1) {
      // As outras linhas deste produto ja consumiram tudo. "Only 0 left — reduce
      // qty" seria um beco: nao ha quantidade que resolva, so tirar a linha.
      blocked.set(key, item);
      continue;
    }
    if (item.quantidade > maxDestaLinha) {
      insufficient.set(key, maxDestaLinha);
    }
  }

  return { blocked, insufficient };
}

/**
 * A trava de `estoque_reservado` se aplica a ESTE save de produto?
 *
 * POR QUE ISTO EXISTE: a primeira versao da trava em `ProductEdit` era um
 * `.lte("estoque_reservado", form.estoque_total)` incondicional — e `estoque_total`
 * SEMPRE vai no payload, inclusive quando o admin editou so a descricao, o preco
 * ou o SEO. Com o banco em `reservado > total`, NENHUM campo do produto podia mais
 * ser salvo, e o toast acusava estoque num save que nao tocou em estoque.
 *
 * E `reservado > total` NAO e estado corrompido: e o comportamento desejado em
 * tres casos que o proprio gatilho isenta de propósito
 * (`20260825320000_estoque_por_variante.sql:110-116`, `_enforce`):
 *   - produto com `permitir_backorder`;
 *   - produto em pre-venda;
 *   - pedido criado por ADMIN (o gatilho nao confere saldo nenhum nesse ramo).
 * Mais o sync, que grava `estoque_total` do B2BWave e nao sincroniza o reservado.
 *
 * Ou seja: sem esta funcao, TODO produto de pre-venda e TODO produto com backorder
 * ficava ineditavel, e a tela mandava o admin "aumentar a quantidade" de um produto
 * que nao tem quantidade. `rastrear_estoque = false` era pior ainda — o gatilho nao
 * le essa coluna, entao o produto fica com total 0 acumulando reservado.
 *
 * A trava vale quando o admin MEXEU na quantidade de um produto que exige saldo.
 * Fora disso o save nao pode ser barrado por uma condicao que ele nao criou.
 *
 * Espelha o `_enforce` do banco de proposito: divergir faria a tela recusar o que
 * o banco aceita, ou o contrario.
 */
export function travaDeReservadoSeAplica(p: {
  estoqueAtual: number | null | undefined;
  estoqueNovo: number | null | undefined;
  permitirBackorder?: boolean | null;
  statusProduto?: string | null;
}): boolean {
  // Nao mexeu na quantidade: nao ha risco novo a barrar.
  if (Number(p.estoqueAtual) === Number(p.estoqueNovo)) return false;
  // Subir a quantidade nunca cria disponivel negativo.
  if (Number(p.estoqueNovo) > Number(p.estoqueAtual)) return false;
  if (p.permitirBackorder === true) return false;
  const s = String(p.statusProduto ?? "").toLowerCase();
  // Mesmas tres formas que o `_enforce` do banco reconhece.
  if (s.includes("pre_venda") || s.includes("pre-venda") || s.includes("pre-order") || s.includes("encomenda")) return false;
  return true;
}
