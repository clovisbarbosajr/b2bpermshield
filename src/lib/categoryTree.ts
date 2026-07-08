// Lista de categorias em ÁRVORE achatada, no formato do B2BWave:
//   Union NJ
//   - One Plus
//   - Lite
//   -- Character
// Ordena por `ordem` (posição manual, igual ao original) e desempata por nome.
// Usar em TODOS os dropdowns de categoria (padrão único).

export type CatNode = { id: string; nome: string; parent_id: string | null; ordem?: number | null };

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
