// Espelhamento entre Container # e Tracking # dos itens de Producao.
//
// No frete maritimo os dois sao o mesmo numero, e a dona reportou (25/ago) que
// digitar num campo nao preenchia o outro. Estas funcoes decidem QUANDO copiar —
// a parte dificil nao e copiar, e saber quando NAO copiar.
//
// Ficam aqui, fora do componente, porque a regra so e confiavel com teste: a
// primeira versao (uma unica funcao simetrica) destruia o container real assim
// que os dois campos ficavam iguais. Os casos que provaram isso estao em
// `espelhoContainer.test.ts`.

/** Normaliza como o `sync-container-eta`: maiusculas, so letras e numeros. */
export const normNum = (v: string | null | undefined) =>
  (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Container -> Tracking (editor).
 *
 * Preenche quando o tracking esta vazio, ou quando ele so estava ACOMPANHANDO o
 * container antigo — assim corrigir um digito no container leva o tracking
 * junto. Nunca por cima de um tracking diferente.
 *
 * O teste "nao mudou" impede a RESSURREICAO: sem ele, abrir o editor so pra
 * trocar a quantidade re-espelhava o container e trazia de volta um tracking que
 * o admin tinha acabado de apagar na lista.
 *
 * @returns o valor a gravar, ou `undefined` para nao mexer no campo.
 */
export function espelharTracking(
  novoContainer: string | null | undefined,
  trackingAtual: string | null | undefined,
  containerAntigo: string | null | undefined,
): string | undefined {
  const n = (novoContainer ?? "").trim();
  if (!n || normNum(n) === normNum(containerAntigo)) return undefined;
  const t = normNum(trackingAtual);
  return (!t || t === normNum(containerAntigo)) ? n : undefined;
}

/**
 * Tracking -> Container (lista).
 *
 * SO preenche container VAZIO. Assimetrico de proposito:
 *   1. a lista NAO exibe a coluna Container — sobrescrever ali seria uma escrita
 *      cega, num campo que o admin nem esta vendo;
 *   2. o Tracking pode legitimamente ser um numero de courier, diferente do
 *      container.
 *
 * NAO tem o teste "nao mudou" que a outra direcao tem. E de proposito: a base
 * antiga tem linhas com tracking preenchido e container vazio, e com o guard elas
 * nunca receberiam container — so espelhariam se alguem redigitasse o tracking.
 * Como o gatilho aqui ja e "container vazio", espelhar sempre faz o backfill
 * dessas linhas no primeiro Save.
 *
 * Consequencia aceita: container apagado de proposito pode voltar. Vale para o
 * Save da lista E para o botao "On the way", que espelha SEM o admin digitar
 * nada — basta clicar numa linha com tracking preenchido e container vazio.
 * Nao da pra separar os dois casos: "legado nunca teve container" e "admin
 * apagou o container" sao o mesmo estado no banco. Nao ha perda de dado (o campo
 * estava vazio) e o audit log registra a escrita; o incomodo e que a lista ativa
 * nao exibe a coluna Container, entao a mudanca so aparece no editor ou no
 * Received log. Container vazio + tracking preenchido nao e um estado que o
 * negocio queira preservar — os dois sao o mesmo numero.
 *
 * @returns o valor a gravar, ou `undefined` para nao mexer no campo.
 */
export function espelharContainer(
  novoTracking: string | null | undefined,
  containerAtual: string | null | undefined,
): string | undefined {
  const n = (novoTracking ?? "").trim();
  if (!n) return undefined;
  return normNum(containerAtual) ? undefined : n;
}
