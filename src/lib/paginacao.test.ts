import { describe, it, expect } from "vitest";
import { paginasVisiveis } from "./paginacao";

const numeros = (r: (number | "...")[]) => r.filter((x): x is number => typeof x === "number");

describe("paginasVisiveis", () => {
  it("mostra todas quando cabem", () => {
    expect(paginasVisiveis(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(paginasVisiveis(3, 3)).toEqual([1, 2, 3]);
    expect(paginasVisiveis(1, 1)).toEqual([1]);
  });

  // O DEFEITO ORIGINAL, nas duas formas em que ele aparecia.
  it("a pagina atual SEMPRE tem botao — era o bug das quatro telas", () => {
    // portal/Pedidos: com 8 paginas exatas, a 8 nao tinha botao.
    for (let p = 1; p <= 8; p++) expect(numeros(paginasVisiveis(p, 8))).toContain(p);
    // admin: com 20 paginas, 8..18 nao tinham botao.
    for (let p = 1; p <= 20; p++) expect(numeros(paginasVisiveis(p, 20))).toContain(p);
    // varredura larga, para nao depender dos dois numeros que eu escolhi
    for (const total of [10, 11, 12, 13, 25, 40, 137]) {
      for (let p = 1; p <= total; p++) {
        expect(numeros(paginasVisiveis(p, total)), `page ${p}/${total}`).toContain(p);
      }
    }
  });

  it("primeira e ultima sempre presentes, e a lista e crescente e sem repetido", () => {
    for (const total of [10, 12, 20, 137]) {
      for (let p = 1; p <= total; p++) {
        const r = paginasVisiveis(p, total);
        const n = numeros(r);
        expect(n[0]).toBe(1);
        expect(n[n.length - 1]).toBe(total);
        expect(n).toEqual([...n].sort((a, b) => a - b));
        expect(new Set(n).size).toBe(n.length);
      }
    }
  });

  it("nunca passa de maxNumeros numeros", () => {
    for (const total of [10, 20, 137]) {
      for (let p = 1; p <= total; p++) {
        expect(numeros(paginasVisiveis(p, total)).length).toBeLessThanOrEqual(9);
      }
    }
  });

  it("reticencia so quando esconde mais de uma pagina", () => {
    // buraco de 1 pagina vira o numero, nao "..."
    const r = paginasVisiveis(6, 20);
    const i = r.indexOf("...");
    if (i > 0) {
      const antes = r[i - 1] as number;
      const depois = r[i + 1] as number;
      expect(depois - antes).toBeGreaterThan(2);
    }
    for (const total of [10, 11, 12, 13, 20, 137]) {
      for (let p = 1; p <= total; p++) {
        const lista = paginasVisiveis(p, total);
        lista.forEach((x, idx) => {
          if (x !== "...") return;
          expect(idx > 0 && idx < lista.length - 1).toBe(true);
          expect((lista[idx + 1] as number) - (lista[idx - 1] as number)).toBeGreaterThan(2);
        });
      }
    }
  });

  // O clamp de `page` so tem efeito VISIVEL aqui: sem ele, `page` NaN faz a
  // janela virar `[1, "...", 20]` — tres itens, sem os numeros do meio. Descobri
  // plantando o mutante `const atual = page`, que passava por todo o resto.
  it("page NaN ou fracionaria cai na pagina inteira mais proxima", () => {
    expect(paginasVisiveis(NaN, 20)).toEqual(paginasVisiveis(1, 20));
    expect(paginasVisiveis(undefined as unknown as number, 20)).toEqual(paginasVisiveis(1, 20));
    expect(paginasVisiveis(6.4, 20)).toEqual(paginasVisiveis(6, 20));
    expect(paginasVisiveis(0, 20)).toEqual(paginasVisiveis(1, 20));
    expect(paginasVisiveis(999, 20)).toEqual(paginasVisiveis(20, 20));
  });

  it("page fora da faixa nao inventa pagina", () => {
    for (const p of [0, -5, 999, NaN]) {
      const n = numeros(paginasVisiveis(p as number, 20));
      expect(Math.min(...n)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...n)).toBeLessThanOrEqual(20);
    }
  });

  it("total invalido devolve lista vazia em vez de quebrar a tela", () => {
    expect(paginasVisiveis(1, 0)).toEqual([]);
    expect(paginasVisiveis(1, NaN)).toEqual([]);
  });
});
