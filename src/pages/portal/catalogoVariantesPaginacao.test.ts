import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";

// Por que este teste existe:
//
// O catálogo lê `produto_variantes` em lotes de 100 produtos por causa do
// tamanho da URL do `.in()`. O lote limita a URL, NÃO a resposta — e o
// PostgREST corta em 1000 linhas SEM erro. Um lote de 100 produtos de
// vestuário (tamanho × cor) passa disso com folga, e o produto cujas variantes
// caíram depois da milésima linha era lido como "produto sem variante": o grid
// mostrava o botão de adicionar e o item ia pro carrinho SEM tamanho/cor e com
// o preço do pai.
//
// Os dois casos abaixo são o antes e o depois da correção em Catalogo.tsx.

const CAP = 1000; // db-max-rows do PostgREST no Supabase

// 100 produtos × 120 variantes ativas = 12.000 linhas em UM lote de `.in()`.
// Em ordem de id, tudo a partir do nono produto cai depois da milésima linha.
const linhas: { produto_id: string }[] = [];
for (let p = 0; p < 100; p++) {
  for (let v = 0; v < 120; v++) linhas.push({ produto_id: `p${p}` });
}

// Fake do PostgREST: devolve no máximo CAP linhas por request, e `error: null`
// mesmo quando cortou — é justamente esse silêncio que engana.
const leitura = (from: number, to: number) =>
  Promise.resolve({ data: linhas.slice(from, Math.min(to + 1, from + CAP)), error: null });

describe("catalogo: lote de variantes precisa paginar", () => {
  it("uma leitura só perde os produtos depois da milésima linha", async () => {
    const { data } = await leitura(0, CAP - 1);
    const achados = new Set(data.map((r) => r.produto_id));
    expect(achados.size).toBeLessThan(100); // truncou, sem erro nenhum
    expect(achados.has("p99")).toBe(false); // este iria pro carrinho SEM variante
  });

  it("fetchAllRows paginando acha todo produto que tem variante", async () => {
    const todas = await fetchAllRows<{ produto_id: string }>((from, to) => leitura(from, to));
    const achados = new Set(todas.map((r) => r.produto_id));
    expect(todas.length).toBe(linhas.length);
    expect(achados.size).toBe(100);
    expect(achados.has("p99")).toBe(true);
  });
});
