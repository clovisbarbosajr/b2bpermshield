import { DEFAULT_PERMISSIONS } from "./permissions";

/**
 * Permissoes efetivas de um usuario de STAFF.
 *
 * MORA AQUI, e nao dentro do `AuthContext`, por um motivo concreto: enquanto
 * morava la, o teste nao conseguia importa-la (o contexto arrasta o cliente
 * Supabase e o router) e acabou REIMPLEMENTANDO a regra dentro do proprio
 * arquivo de teste. O teste passava exercitando a copia, e o codigo de producao
 * ficava sem cobertura nenhuma: inverter o merge para `{...mapa, ...padrao}` —
 * que faz desmarcar um checkbox deixar de valer — passava verde.
 *
 * O QUE ELA RESOLVE: `user_roles.permissions` e `JSONB DEFAULT '{}'`
 * (20260410000001), e os `DEFAULT_PERMISSIONS` so eram aplicados dentro da TELA
 * de Users, na hora de editar. Quem nunca passou por ela chegava com `{}`, e
 * como `hasPermission` testa `permissions[key] === true`, tudo virava `false`.
 *
 * A REGRA:
 *   - mapa ausente, vazio, ou que nem e objeto  -> default do papel;
 *   - mapa com pelo menos uma chave             -> default, com as chaves
 *     gravadas por cima (o admin decide, chave por chave);
 *   - papel sem default (admin)                 -> devolve o que veio.
 */
export function permissoesDoPapel(papel: string, gravadas: unknown): Record<string, boolean> {
  // `typeof null === "object"`, dai o teste de verdade primeiro. Array passa
  // como objeto e cai no ramo de vazio quando nao tem itens — que e o certo.
  const mapa = (gravadas && typeof gravadas === "object" ? gravadas : {}) as Record<string, boolean>;
  const padrao = (DEFAULT_PERMISSIONS as Record<string, Record<string, boolean>>)[papel];
  if (!padrao) return mapa;
  if (Object.keys(mapa).length === 0) return { ...padrao };
  return { ...padrao, ...mapa };
}
