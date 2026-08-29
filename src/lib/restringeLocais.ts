/**
 * A tela de producao deve filtrar os produtos pelos locais do usuario?
 *
 * A REGRA TEM TRES ESTADOS, e o defeito era tratar dois deles como um.
 * `user_locations` vazio significava, ao mesmo tempo, "este usuario nao tem
 * local cadastrado" e "nao consegui ler os locais" — porque o `error` era
 * descartado no `?? []`. E o vazio ABRE o acesso: a policy de `categorias`
 * (migration 20260619220000) libera TODAS as localizacoes para quem nao tem
 * linha em `user_locations`. Uma falha de rede promovia o warehouse de um
 * galpao a ver, e a lancar producao em, todos os galpoes.
 *
 * Sem cadastro o acesso amplo e proposital. Sem CONSEGUIR LER, nao: ai fecha.
 */
export const restringeLocais = (
  role: string | null | undefined,
  locaisCadastrados: number,
  erroDeLeitura: string | null,
): boolean => role !== "admin" && (locaisCadastrados > 0 || erroDeLeitura !== null);
