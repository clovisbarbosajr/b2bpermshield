// SKU -> id, com o SKU REPETIDO marcado em vez de sorteado.
//
// A UNIQUE de `produtos.sku` foi DROPADA de proposito em `20260708140000`
// ("pra manter 1:1 com o original, a UNIQUE cai"). Desde entao, `mapa[sku] = id`
// escrito em laco guarda o ULTIMO da paginacao — e qualquer importador que resolva
// produto por SKU passa a escrever num produto sorteado pela ordem de leitura, com
// "ok" verde na tela. `ImportCustomerPrices` ja recusava esse caso; a mesma leitura
// em `ImportProductVariants` nao recusava, e ali o estrago e maior (a variante e o
// estoque vao para a ficha errada, e reimportar NAO corrige — a segunda rodada acha
// "ja existe" e atualiza a variante errada de novo).
//
// `trim()` na chave e na consulta: o lookup do arquivo usa `sku.trim()`, entao um
// espaco a mais no cadastro fazia o produto sumir do mapa e a linha virar
// "Parent product not found".
export const mapaSkuSemAmbiguidade = (produtos: { id: string; sku: string | null }[]) => {
  const mapa: Record<string, string> = {};
  const ambiguos = new Set<string>();
  for (const p of produtos) {
    if (!p.sku) continue;
    const k = p.sku.trim();
    if (!k) continue;
    if (mapa[k] && mapa[k] !== p.id) ambiguos.add(k);
    else mapa[k] = p.id;
  }
  return { mapa, ambiguos };
};
