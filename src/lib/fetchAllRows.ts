/**
 * Lê uma tabela INTEIRA, em páginas.
 *
 * O PostgREST corta a resposta em `db-max-rows` (1000 no Supabase) SEM avisar:
 * um `.select()` sem `.range()` volta com 1000 linhas e `error: null`. Nos
 * relatórios isso é pior que um erro — o total sai plausível e errado (some a
 * venda mais antiga, ou a mais nova, dependendo do `order`).
 *
 * SEMPRE passe um `.order()` por coluna UNICA (normalmente `id`) — ver o aviso
 * abaixo. O exemplo aqui ensinava o padrao errado.
 *
 * Uso:
 *   const itens = await fetchAllRows((from, to) =>
 *     supabase.from("pedido_itens").select("pedido_id, quantidade")
 *       .order("id", { ascending: true }).range(from, to));
 */
// IMPORTANTE para quem chamar: passe SEMPRE um `.order()` por coluna unica
// (normalmente `id`). Isto aqui pagina com `.range()`, que vira LIMIT/OFFSET, e
// no Postgres LIMIT/OFFSET sem ORDER BY nao tem ordem definida. Cada pagina e um
// request separado; se uma linha for atualizada entre a pagina 1 e a 2 — e
// `pedidos`/`produtos` mudam o tempo todo — ela pode ser lida duas vezes ou
// nenhuma. O sintoma e cruel: o MESMO relatorio, aberto duas vezes seguidas,
// mostra receita diferente, e nenhum dos dois numeros esta certo.

export async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  { chunk = 1000, maxRows = 200_000 }: { chunk?: number; maxRows?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  const vistos = new Set<unknown>();
  for (let from = 0; from < maxRows; from += chunk) {
    const { data, error } = await buildQuery(from, from + chunk - 1);
    if (error) {
      // `causa` carrega o erro CRU do PostgREST. Sem isso, `new Error(message)`
      // apagava o `code` — e quem chama nao conseguia distinguir "esta coluna nao
      // existe" (42703, que tem tratamento proprio) de "a rede caiu no meio da
      // pagina 2", que precisa virar erro na tela. `ProducaoStatus` depende disso.
      const e = new Error(error.message ?? String(error)) as Error & { causa?: any };
      e.causa = error;
      throw e;
    }
    const page = data ?? [];
    // DEDUPE POR `id`, e nao e paranoia.
    //
    // `.range()` vira LIMIT/OFFSET, que conta POSICOES. Se uma linha entrar no
    // meio da ordenacao entre a pagina 1 e a 2 — e entra: `created_at` e
    // `DEFAULT now()`, e `now()` congela no INICIO da transacao, entao duas
    // gravacoes sobrepostas podem comitar fora de ordem — tudo desce uma casa e a
    // linha da fronteira e servida DUAS vezes. O efeito e feio e silencioso: key
    // repetida no React, linha duplicada na tabela, e total somando a mesma venda
    // duas vezes num relatorio.
    //
    // Ordenar por `created_at` ascendente reduz muito a frequencia (a insercao
    // normal cai no fim e nao empurra nada), mas nao fecha a retroativa. Fechar
    // de verdade custa uma linha, aqui, para todos os chamadores de uma vez.
    // Pular linha continua possivel — delecao concorrente encurta o inicio — e
    // isso o dedupe nao resolve nem finge resolver.
    for (const linha of page) {
      const id = (linha as any)?.id;
      if (id === undefined || id === null) { out.push(linha); continue; }
      if (vistos.has(id)) continue;
      vistos.add(id);
      out.push(linha);
    }
    if (page.length < chunk) return out;   // última página
  }
  // Teto de segurança: não é pra acontecer, mas melhor parar do que rodar sem fim.
  console.warn(`fetchAllRows: parou no teto de ${maxRows} linhas`);
  return out;
}
