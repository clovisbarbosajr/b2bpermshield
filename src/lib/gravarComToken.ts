import { gravacaoRecusadaComCerteza } from "./gravacaoRecusada";

/**
 * Grava uma ficha com BLOQUEIO OTIMISTA, contra a coluna `admin_rev`.
 *
 * `tabela` e parametro porque o MESMO defeito existe em `produtos` e em
 * `clientes`: as duas telas apagam-e-reescrevem tabelas filhas a partir do estado
 * da TELA. Uma copia por tela divergiria — e esta funcao levou sete rodadas de
 * revisao para ficar certa, entao duplicar seria duplicar o risco.
 *
 * POR QUE ISTO E UMA FUNCAO, e nao tres linhas dentro do `handleSave`: enquanto
 * estava la, apagar o `.eq("admin_rev", rev)` NAO quebrava teste nenhum — a suite
 * inteira (120 verdes) passava com o bloqueio removido. Uma guarda contra perda
 * silenciosa que morre em silencio nao e guarda. Aqui ela tem `gravarComToken.test.ts`
 * em cima, e o teste reprova se o filtro ou o incremento sumirem.
 *
 * O QUE ELA IMPEDE, medido contra o banco (`docs/ESTRESSE-SAVE-PRODUTO.sql`,
 * testes 1/2/3): dois admins com a mesma ficha aberta, o segundo a salvar apaga o
 * trabalho do primeiro, porque o `saveSubData` reescreve as tabelas filhas a
 * partir do estado da TELA. Os dois leem "Product saved".
 *
 * Os quatro desfechos sao distintos de proposito — cada um pede uma acao
 * diferente do admin, e junta-los ja produziu erro grave nas revisoes:
 *
 *   ok        gravou; `rev` e o token novo, para o proximo save da mesma tela.
 *   conflito  o `id` casou e o token nao: alguem gravou no meio. NAO siga para o
 *             `saveSubData` — e ele que destroi.
 *   recusado  o PostgREST respondeu com `code`: a transacao abortou, nada foi
 *             escrito e o token continua valendo. Corrigir e salvar de novo.
 *   incerto   nao houve resposta estruturada (rede caiu, 5xx de gateway). Pode ou
 *             nao ter commitado — tentar de novo as cegas acusa um colega que nao
 *             existe. So recarregando e conferindo.
 */
export type ResultadoGravacao =
  | { tipo: "ok"; rev: number }
  // `porFiltroExtra`: zero linhas com o TOKEN ainda valendo — quem barrou foi a
  // condicao extra do chamador, e nao outro admin.
  | { tipo: "conflito"; porFiltroExtra?: boolean }
  | { tipo: "recusado"; mensagem: string }
  | { tipo: "incerto"; mensagem: string };

/**
 * `filtroExtra` deixa o chamador acrescentar CONDICOES ao mesmo statement.
 *
 * Existe por um caso concreto: `ProductEdit` grava `estoque_total` e precisa da
 * mesma trava que `Estoque.tsx:178` e `InventoryAdjustment.tsx:221` ja aplicam —
 * `.lte("estoque_reservado", novaQtd)`. O gatilho de reserva escreve SO em
 * `estoque_reservado`, invisivel para o `admin_rev`: entre o carregamento da ficha
 * e o Save um checkout reserva mais unidades, o token continua valendo, e o save
 * grava um `estoque_total` MENOR que o reservado. O produto TRAVA (o proprio
 * gatilho passa a recusar toda reserva nova), nao se recupera sozinho, e nao ha
 * CHECK no banco segurando isso.
 *
 * Tem que ir no MESMO statement: ler-decidir-gravar reabre a corrida no meio.
 *
 * O preco disso e que zero linha deixa de ter causa unica — pode ser o token OU o
 * filtro extra. Por isso o desfecho `conflito` ganhou `porFiltroExtra`, para o
 * chamador poder dizer a verdade em vez de acusar um colega que nao existe.
 */
export async function gravarComToken(
  sb: any,
  tabela: string,
  id: string,
  payload: Record<string, any>,
  rev: number,
  filtroExtra?: (q: any) => any,
): Promise<ResultadoGravacao> {
  let q = sb
    .from(tabela)
    // O incremento vai no MESMO statement do filtro. Separar em dois (ler, decidir,
    // gravar) reabre a corrida no meio.
    .update({ ...payload, admin_rev: rev + 1 })
    .eq("id", id)
    .eq("admin_rev", rev);
  if (filtroExtra) q = filtroExtra(q);
  const { data, error, status } = await q
    .select("admin_rev")
    .maybeSingle();

  if (error) {
    return gravacaoRecusadaComCerteza(status, error)
      ? { tipo: "recusado", mensagem: error.message }
      : { tipo: "incerto", mensagem: error.message };
  }
  // `maybeSingle()` sem erro e sem linha = algum filtro nao casou. Como o `id` veio
  // da propria tela, sobra o token — ou o `filtroExtra`, quando existe. Uma leitura
  // a mais separa os dois: sem ela, a trava de estoque acusaria um colega que nao
  // existe ("outro admin gravou no meio"), e o admin recarregaria a ficha para ver
  // exatamente o mesmo numero.
  if (!data) {
    if (!filtroExtra) return { tipo: "conflito" };
    const { data: atual } = await sb.from(tabela).select("admin_rev").eq("id", id).maybeSingle();
    // Token ainda de pe => quem barrou foi o filtro extra.
    return { tipo: "conflito", porFiltroExtra: !!atual && (atual as any).admin_rev === rev };
  }
  return { tipo: "ok", rev: (data as any).admin_rev ?? rev + 1 };
}
