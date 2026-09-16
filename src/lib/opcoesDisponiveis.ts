// Quais opcoes de frete/pagamento o cliente VE no checkout.
//
// A aba "Customer shipping options"/"Payment options" da ficha do cliente e uma
// RESTRICAO: marcou alguma, ele ve so as marcadas (publicas ou privadas). Nao
// marcou nenhuma, ele ve todas as publicas. Privada sem marcacao nunca aparece.
//
// Antes a regra era `!privado || atribuida`, que mostrava toda publica mesmo
// desmarcada: 5 fretes publicos, cliente com 3 marcados, checkout com 5.
//
// Atribuicao a id que nao esta em `opcoes` (inativa, sumiu) nao conta — senao a
// conta ficaria sem opcao nenhuma. O gatilho `fn_pedido_opcoes_validas` aplica a
// mesma regra no servidor.
export function opcoesDisponiveis<T extends { id: string; privado?: boolean | null }>(
  opcoes: T[],
  atribuidas: Set<string>,
): T[] {
  const minhas = opcoes.filter((o) => atribuidas.has(o.id));
  return minhas.length ? minhas : opcoes.filter((o) => !o.privado);
}
