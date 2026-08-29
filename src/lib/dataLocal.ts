/**
 * Conversão entre o `<input type="date">` (que fala `YYYY-MM-DD` no fuso do
 * navegador) e a coluna `timestamptz` do Postgres.
 *
 * MORA AQUI, e não dentro da tela, porque a versão inline não tinha como ser
 * testada por comportamento — e três mutantes provaram isso: trocar
 * `new Date(iso)` por `new Date()` (que reescreveria as duas datas de todo cupom
 * editado para HOJE), tirar o `+ 1` do mês, e somar 1 ao dia — os três passavam
 * com a suíte inteira verde, porque o teste casava o TEXTO da fonte.
 *
 * O PAR TEM QUE SER SIMÉTRICO. Cada ponta sozinha já quebrou uma vez:
 *
 *  - só a ida (sem fuso): `"2026-08-10T23:59:59"` era lido como UTC, e no leste
 *    dos EUA o cupom com fim "10/ago" morria às 19h do dia 10 — e o com início
 *    "10/ago" passava a valer às 20h do dia 9;
 *  - só a volta (`split("T")[0]` sobre a string UTC): reabrir o cupom mostrava um
 *    dia A MAIS, e como o diálogo salvava aquilo de novo, cada Edit+Save empurrava
 *    o fim mais um dia. Deriva cumulativa.
 *
 * `ActivityLogs.setQuickRange` já carregava o comentário desta armadilha
 * ("`toISOString()` converte para UTC ANTES de cortar… a janela inteira deslizava
 * um dia"); o cupom caiu nela mesmo assim.
 */

/** `YYYY-MM-DD` + hora local → instante ISO. Vazio/inválido → `null`. */
export function paraInstanteLocal(data: string | null | undefined, hora: string): string | null {
  if (!data) return null;
  // `new Date("2026-08-10T00:00:00")` — SEM `Z` e SEM offset — é interpretado no
  // fuso local, que é o do admin que está preenchendo o formulário. É o que se
  // quer: ele digitou uma data de calendário, não um instante UTC.
  const d = new Date(`${data}T${hora}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Instante ISO → `YYYY-MM-DD` no fuso LOCAL. Vazio/inválido → `""`. */
export function soDataLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `getFullYear/getMonth/getDate` leem no fuso local — o MESMO que a ida usou.
  // `toISOString().split("T")[0]` aqui devolveria o dia errado a oeste de UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
