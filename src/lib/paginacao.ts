/**
 * Numeros de pagina visiveis, um so para as quatro telas que paginam com botoes.
 *
 * As quatro tinham a propria versao, e as quatro tinham o MESMO defeito: a
 * janela era FIXA nas primeiras paginas, entao o meio da lista nao tinha botao.
 *
 *   admin (Clientes, Pedidos, Produtos) — `1..7`, depois `totalPages - 1` e
 *   `totalPages`. Com 20 paginas, as paginas 8 a 18 so davam para alcancar
 *   clicando `>` onze vezes.
 *
 *   portal/Pedidos — `1..7` e, SO se `totalPages > 8`, as duas ultimas. Com
 *   exatamente 8 paginas, a pagina 8 nao ganhava botao nenhum.
 *
 * Pior que o botao que falta e o botao que MENTE: nas tres do admin o item
 * rotulado `...` era um Button com `onClick={() => setPage(totalPages - 1)}`.
 * Quem clicava nas reticencias esperando "expandir" ia parar na penultima
 * pagina, sem nenhum aviso.
 *
 * Aqui `"..."` e um MARCADOR, nao um destino — as telas o renderizam como texto.
 *
 * `maxNumeros` e quantos numeros aparecem no total (primeira + janela + ultima).
 */
export function paginasVisiveis(
  page: number,
  totalPages: number,
  maxNumeros = 9,
): (number | "...")[] {
  if (!Number.isFinite(totalPages) || totalPages < 1) return [];
  // Sem espaco para reticencia util: mostra tudo.
  if (totalPages <= maxNumeros) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // `page` fora da faixa (estado velho, URL na mao) nao pode produzir janela
  // negativa nem numero que nao existe.
  const atual = Math.min(Math.max(Math.round(page) || 1, 1), totalPages);

  // Quantos numeros a janela do meio recebe: o total menos a primeira, a ultima
  // e as duas reticencias.
  const meio = Math.max(1, maxNumeros - 4);
  let de = atual - Math.floor((meio - 1) / 2);
  let ate = de + meio - 1;
  // Encosta a janela nas bordas em vez de ultrapassa-las — senao as primeiras e
  // as ultimas paginas exibiriam menos numeros que as do meio.
  if (de < 2) { de = 2; ate = de + meio - 1; }
  if (ate > totalPages - 1) { ate = totalPages - 1; de = ate - meio + 1; }

  const paginas: (number | "...")[] = [1];
  // Reticencia so quando ela esconde ALGO. Se o buraco e de uma pagina so, o
  // numero cabe no lugar dela — e um botao a mais e melhor que um aviso a mais.
  if (de === 3) paginas.push(2);
  else if (de > 3) paginas.push("...");
  for (let i = de; i <= ate; i++) paginas.push(i);
  if (ate === totalPages - 2) paginas.push(totalPages - 1);
  else if (ate < totalPages - 2) paginas.push("...");
  paginas.push(totalPages);
  return paginas;
}

/**
 * Limita a pagina atual ao total existente.
 *
 * POR QUE ISTO EXISTE: `page` e estado, `totalPages` e derivado da lista. Apagar
 * (ou desativar) a unica linha da ultima pagina reduz `totalPages` e deixa `page`
 * apontando para o vazio. Como a barra de paginacao inteira esta sob
 * `totalPages > 1`, ela DESMONTA junto — a tela mostra "No products found" sem
 * nenhum botao de voltar, e o admin so sai de la com F5.
 *
 * Aconteceu em `Produtos.tsx` pelos dois caminhos de escrita: `handleDelete` e
 * `handleActiveChange` (o filtro nasce em "Active", entao desativar a ultima linha
 * da ultima pagina produz o mesmo beco).
 *
 * Derivado no render, e nao um `setPage` em efeito: efeito corrige DEPOIS de ja
 * ter renderizado a tela vazia uma vez.
 *
 * Lista vazia -> pagina 1 (e nao 0): a paginacao do repo e 1-based.
 */
export function paginaValida(page: number, totalPages: number): number {
  return Math.min(page, Math.max(1, totalPages));
}
