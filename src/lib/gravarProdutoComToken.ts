import { gravacaoRecusadaComCerteza } from "./gravacaoRecusada";

/**
 * Grava a ficha do produto com BLOQUEIO OTIMISTA.
 *
 * POR QUE ISTO E UMA FUNCAO, e nao tres linhas dentro do `handleSave`: enquanto
 * estava la, apagar o `.eq("admin_rev", rev)` NAO quebrava teste nenhum — a suite
 * inteira (120 verdes) passava com o bloqueio removido. Uma guarda contra perda
 * silenciosa que morre em silencio nao e guarda. Aqui ela tem `gravarProdutoComToken.test.ts`
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
  | { tipo: "conflito" }
  | { tipo: "recusado"; mensagem: string }
  | { tipo: "incerto"; mensagem: string };

export async function gravarProdutoComToken(
  sb: any,
  id: string,
  payload: Record<string, any>,
  rev: number,
): Promise<ResultadoGravacao> {
  const { data, error, status } = await sb
    .from("produtos")
    // O incremento vai no MESMO statement do filtro. Separar em dois (ler, decidir,
    // gravar) reabre a corrida no meio.
    .update({ ...payload, admin_rev: rev + 1 })
    .eq("id", id)
    .eq("admin_rev", rev)
    .select("admin_rev")
    .maybeSingle();

  if (error) {
    return gravacaoRecusadaComCerteza(status, error)
      ? { tipo: "recusado", mensagem: error.message }
      : { tipo: "incerto", mensagem: error.message };
  }
  // `maybeSingle()` sem erro e sem linha = o filtro nao casou. Como o `id` veio da
  // propria tela, o que nao casou foi o token.
  if (!data) return { tipo: "conflito" };
  return { tipo: "ok", rev: (data as any).admin_rev ?? rev + 1 };
}
