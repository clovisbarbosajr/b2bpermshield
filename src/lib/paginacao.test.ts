import { describe, it, expect } from "vitest";
import { paginasVisiveis, paginaValida } from "./paginacao";

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

describe("paginaValida: o beco sem saida depois de apagar a ultima linha", () => {
  // O CENARIO REAL, medido: 26 produtos, PAGE_SIZE 25, admin na pagina 2 (uma
  // linha). Apaga essa linha -> 25 produtos -> totalPages 1. Sem o limite, a
  // fatia era `slice(25, 50)` = vazio e a barra sumia (esta sob `totalPages > 1`).
  it("volta para a ultima pagina que existe", () => {
    expect(paginaValida(2, 1)).toBe(1);
    expect(paginaValida(9, 3)).toBe(3);
  });

  it("nao mexe na pagina quando ela existe", () => {
    expect(paginaValida(1, 1)).toBe(1);
    expect(paginaValida(2, 5)).toBe(2);
    expect(paginaValida(5, 5)).toBe(5);
  });

  // `Math.min(page, totalPages)` sozinho devolveria 0 com a lista vazia, e a
  // fatia viraria `slice(-25, 0)` — as ULTIMAS 25 linhas, nao as primeiras.
  // Este assert e o que mata essa versao.
  it("lista vazia devolve pagina 1, nunca 0", () => {
    expect(paginaValida(1, 0)).toBe(1);
    expect(paginaValida(7, 0)).toBe(1);
  });

  // A fatia calculada com o resultado tem que cair dentro da lista. Sem o limite
  // este loop devolve vazio para os casos de page > totalPages.
  it("a fatia resultante nunca fica vazia com lista nao vazia", () => {
    const TAM = 25;
    for (const total of [1, 26, 51, 100]) {
      for (const page of [1, 2, 3, 9, 40]) {
        const totalPages = Math.ceil(total / TAM);
        const ok = paginaValida(page, totalPages);
        const fatia = Array.from({ length: total }, (_, i) => i)
          .slice((ok - 1) * TAM, ok * TAM);
        expect(fatia.length, `total=${total} page=${page}`).toBeGreaterThan(0);
      }
    }
  });
});
