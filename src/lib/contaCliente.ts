// Situacao da conta do cliente — a MESMA regra que o banco aplica em
// `cliente_conta_liberada()` (migration 20260825280000) e em
// `fn_block_order_inactive_customer` (20260623020000).
//
// Fica em arquivo proprio, e nao dentro do AuthContext, para poder ser testada
// sem montar React. As tres travas (catalogo, pedido, tela) precisam concordar:
// hoje o sistema BARRA o pedido do cliente pendente e MOSTRA o catalogo para ele.

// DENYLIST, nao allowlist. Conservadora de proposito: status desconhecido NAO
// bloqueia, para nao derrubar cliente legitimo cujo status ninguem previu no dia
// do lancamento. Se o front e o banco divergirem, o banco vence — e o sintoma e
// catalogo vazio, nao dado vazado.
export const STATUS_BLOQUEADOS = new Set([
  "pendente", "inativo", "rejeitado", "suspenso",
  "pending", "inactive", "rejected", "suspended", "blocked",
]);

export type FichaCliente = {
  status?: string | null;
  is_active?: boolean | null;
} | null | undefined;

export function contaLiberada(c: FichaCliente): boolean {
  // Sem ficha nao e cliente. O banco decide igual.
  if (!c) return false;
  // `is_active === false` bloqueia; `null`/`undefined` nao — a coluna e opcional
  // e ficha antiga pode nao ter valor.
  if (c.is_active === false) return false;
  return !STATUS_BLOQUEADOS.has(String(c.status ?? "").toLowerCase().trim());
}
