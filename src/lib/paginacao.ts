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
