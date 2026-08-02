/**
 * Lê uma tabela INTEIRA, em páginas.
 *
 * O PostgREST corta a resposta em `db-max-rows` (1000 no Supabase) SEM avisar:
 * um `.select()` sem `.range()` volta com 1000 linhas e `error: null`. Nos
 * relatórios isso é pior que um erro — o total sai plausível e errado (some a
 * venda mais antiga, ou a mais nova, dependendo do `order`).
 *
 * Uso:
 *   const itens = await fetchAllRows((from, to) =>
 *     supabase.from("pedido_itens").select("pedido_id, quantidade").range(from, to));
 */
export async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  { chunk = 1000, maxRows = 200_000 }: { chunk?: number; maxRows?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += chunk) {
    const { data, error } = await buildQuery(from, from + chunk - 1);
    if (error) throw new Error(error.message ?? String(error));
    const page = data ?? [];
    out.push(...page);
    if (page.length < chunk) return out;   // última página
  }
  // Teto de segurança: não é pra acontecer, mas melhor parar do que rodar sem fim.
  console.warn(`fetchAllRows: parou no teto de ${maxRows} linhas`);
  return out;
}
