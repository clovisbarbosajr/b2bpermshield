/**
 * A nova ordem dos irmaos depois de um "Move up/down".
 *
 * Existe como funcao pura porque a versao anterior morava dentro da tela e so
 * podia ser vigiada por regex no texto-fonte — e o regex acabou TRAVANDO a forma
 * que continha o defeito: a suite ficava verde justamente sobre o bug.
 *
 * A regra e uma so: reindexar 0..n-1. Trocar dois valores de `ordem` parecia
 * equivalente e nao e, porque `ordem` e `NOT NULL DEFAULT 0`, o formulario de
 * categoria nova parte de 0 e o sync do B2BWave nao garante valor distinto
 * (`parseInt(c.position || c.sort_order || "0") || 0`) — empate e o estado normal
 * desta arvore. Com empate no par a troca gravava 0 e 0 (o botao nao fazia nada);
 * com empate entre OUTROS irmaos ela movia DUAS casas, porque a releitura ordena
 * por `(ordem, nome)`.
 */
export function reordenarIrmaos<T>(irmaos: T[], idx: number, direcao: "up" | "down"): T[] {
  const alvo = direcao === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || idx >= irmaos.length || alvo < 0 || alvo >= irmaos.length) return irmaos;
  const nova = [...irmaos];
  nova[idx] = irmaos[alvo];
  nova[alvo] = irmaos[idx];
  return nova;
}

/**
 * A ordem em que a tela LE as categorias: `ordem` primeiro, `nome` como
 * desempate — o mesmo `.order("ordem").order("nome")` do `fetchData`. Usada no
 * teste para conferir o que o admin vai ver DEPOIS de gravar, que e onde o
 * defeito das duas casas aparecia.
 */
export function comoARecarregaOrdena<T extends { ordem: number; nome: string }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}
