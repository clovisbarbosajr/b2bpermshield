/**
 * Valor seguro dentro de um `.or(...)` do PostgREST.
 *
 * A expressao do `or=()` e separada por VIRGULA e delimitada por PARENTESES.
 * Interpolar texto livre ali quebra o parser — e um grupo de privacidade chamado
 * `Dealers, Northeast` ou `Dealers (West)` derrubava o export inteiro num toast
 * com mensagem crua de parser, em vez de exportar.
 *
 * Pior: um valor com uma clausula colada dentro
 * (`X,privacy_group_id.not.is.null`) MUDA a semantica do filtro. Aqui quem
 * escreve o nome e admin, entao nao e fronteira de privilegio — mas o filtro
 * existe justamente para nao trazer produto de outro grupo, e filtro que pode ser
 * reescrito pelo proprio dado nao presta para isso.
 *
 * O PostgREST aceita o valor entre ASPAS DUPLAS dentro do `or=()`; dentro delas,
 * a aspa e a barra invertida se escapam com barra invertida.
 */
export function valorOr(v: unknown): string {
  const texto = v == null ? "" : String(v);
  const BARRA = String.fromCharCode(92);
  const ASPA = String.fromCharCode(34);
  const escapado = texto.split(BARRA).join(BARRA + BARRA).split(ASPA).join(BARRA + ASPA);
  return ASPA + escapado + ASPA;
}
