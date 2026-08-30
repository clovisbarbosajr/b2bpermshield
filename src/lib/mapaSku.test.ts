import { describe, it, expect } from "vitest";
import { mapaSkuSemAmbiguidade } from "./mapaSku";

// A UNIQUE de `produtos.sku` foi dropada em `20260708140000`, entao SKU repetido e
// dado LEGAL. O que nao pode e o importador escolher um por conta propria.
describe("mapaSkuSemAmbiguidade", () => {
  it("SKU repetido NAO entra no mapa como se fosse um so — vai para `ambiguos`", () => {
    const { mapa, ambiguos } = mapaSkuSemAmbiguidade([
      { id: "p1", sku: "PROD-001" },
      { id: "p2", sku: "PROD-001" },
    ]);
    expect(ambiguos.has("PROD-001")).toBe(true);
    // O defeito original era `mapa[sku] = id` ultimo-vence: o mapa respondia "p2"
    // com toda a confianca, e a variante ia para a ficha errada com "Inserted"
    // verde. Quem consulta TEM de checar `ambiguos` — este assert existe para o
    // caso de alguem "simplificar" o helper devolvendo so o mapa.
    expect(mapa["PROD-001"]).toBe("p1");
  });

  it("a mesma linha lida duas vezes nao vira ambiguidade", () => {
    // Paginacao com sobreposicao entregaria o mesmo id duas vezes. Isso e a mesma
    // ficha, nao duas — marcar como ambiguo aqui recusaria importacao legitima.
    const { ambiguos } = mapaSkuSemAmbiguidade([
      { id: "p1", sku: "PROD-001" },
      { id: "p1", sku: "PROD-001" },
    ]);
    expect(ambiguos.size).toBe(0);
  });

  it("chaveia com `trim`, porque o lookup do arquivo usa `sku.trim()`", () => {
    // Sem `trim` na chave, um espaco a mais no CADASTRO fazia o produto sumir do
    // mapa e a linha do CSV virar "Parent product not found" — mensagem mentirosa.
    const { mapa } = mapaSkuSemAmbiguidade([{ id: "p1", sku: " PROD-001 " }]);
    expect(mapa["PROD-001"]).toBe("p1");
  });

  it("SKU vazio ou so espaco nao vira chave", () => {
    // Chave "" casaria com qualquer linha cujo `parent_sku` ficasse vazio depois do
    // trim, pendurando variante num produto aleatorio.
    const { mapa, ambiguos } = mapaSkuSemAmbiguidade([
      { id: "p1", sku: "" }, { id: "p2", sku: "   " }, { id: "p3", sku: null },
    ]);
    expect(Object.keys(mapa)).toHaveLength(0);
    expect(ambiguos.size).toBe(0);
  });

  it("distingue caixa — SKU e codigo, nao texto livre", () => {
    const { mapa, ambiguos } = mapaSkuSemAmbiguidade([
      { id: "p1", sku: "prod-001" }, { id: "p2", sku: "PROD-001" },
    ]);
    expect(ambiguos.size).toBe(0);
    expect(mapa["prod-001"]).toBe("p1");
    expect(mapa["PROD-001"]).toBe("p2");
  });
});
