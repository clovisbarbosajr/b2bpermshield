// Lista de categorias em ÁRVORE achatada, no formato do B2BWave:
//   Union NJ
//   - One Plus
//   - Lite
//   -- Character
// Ordena por `ordem` (posição manual, igual ao original) e desempata por nome.
// Usar em TODOS os dropdowns de categoria (padrão único).

export type CatNode = { id: string; nome: string; parent_id: string | null; ordem?: number | null };

// Caminho completo da categoria, do topo (localização) até ela: "Union NJ › One Plus".
// Usado onde precisa distinguir produtos homônimos (ex.: modal de adicionar produto).
export function categoryPath(cats: CatNode[], id: string | null | undefined): string {
  if (!id) return "";
  const byId = new Map(cats.map((c) => [c.id, c]));
  const chain: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 12) { chain.unshift(cur.nome); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return chain.join(" › ");
}

/**
 * Categorias de PRIMEIRO NÍVEL a exibir.
 *
 * Não é `filter(c => !c.parent_id)`: a lista chega filtrada (`ativo = true` e a
 * visibilidade por cliente), então uma categoria pode ficar ÓRFÃ — apontando pra
 * um pai que não veio. Sem contar a órfã como raiz, o dono desativar uma
 * categoria-pai fazia sumir a barra do catálogo E a árvore da sidebar inteira,
 * porque nenhuma das filhas tinha `parent_id` nulo.
 */
export function rootCategories(cats: CatNode[]): CatNode[] {
  const existe = new Set(cats.map((c) => c.id));
  return cats.filter((c) => !c.parent_id || !existe.has(c.parent_id));
}

/**
 * Botões de categoria a mostrar no catálogo do portal.
 *
 * Regra: mostrar sempre o NÍVEL em que o cliente está navegando.
 *   - sem categoria escolhida  → as raízes
 *   - categoria COM filhas     → as filhas (descer um nível)
 *   - categoria FOLHA          → as IRMÃS, não uma lista vazia
 *
 * A última linha é a correção do pedido do dono (03/ago): antes era só
 * "filhas da atual", então abrir uma folha (Accessories - FL › PermTread)
 * apagava a barra inteira, e pra ir de PermTread pra Reducer o cliente
 * precisava voltar na categoria-pai pelo breadcrumb A CADA troca.
 *
 * `categoriaId` que não existe na lista (categoria privada, filtrada pela
 * visibilidade do cliente) cai nas raízes em vez de sumir com tudo.
 */
export function catalogCategoryButtons(cats: CatNode[], categoriaId: string | null | undefined): CatNode[] {
  const childrenOf = (pid: string | null) => cats.filter((c) => (c.parent_id ?? null) === pid);
  const roots = rootCategories(cats); // conta órfã como raiz — ver comentário acima
  if (!categoriaId) return roots;

  const atual = cats.find((c) => c.id === categoriaId);
  if (!atual) return roots;

  const filhas = childrenOf(atual.id);
  if (filhas.length > 0) return filhas;

  return atual.parent_id ? childrenOf(atual.parent_id) : roots;
}

export function categoryTreeOptions(cats: CatNode[]): { id: string; label: string }[] {
  const sorted = (list: CatNode[]) =>
    [...list].sort((a, b) => ((a.ordem ?? 0) - (b.ordem ?? 0)) || a.nome.localeCompare(b.nome));
  const childrenOf = (pid: string | null) =>
    sorted(cats.filter((c) => (c.parent_id ?? null) === pid));
  const out: { id: string; label: string }[] = [];
  const walk = (c: CatNode, depth: number) => {
    if (depth > 10) return; // guarda contra ciclo de parent_id
    out.push({ id: c.id, label: depth ? `${"-".repeat(depth)} ${c.nome}` : c.nome });
    childrenOf(c.id).forEach((ch) => walk(ch, depth + 1));
  };
  childrenOf(null).forEach((r) => walk(r, 0));
  return out;
}
