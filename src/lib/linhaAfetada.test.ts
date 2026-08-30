import { describe, it, expect } from "vitest";
import { nadaFoiEscrito } from "./linhaAfetada";

// O caso que nao tem erro nenhum: sob RLS, `USING` de policy FILTRA em UPDATE e
// DELETE em vez de levantar. Zero linhas + `error: null` era lido como sucesso.
describe("nadaFoiEscrito", () => {
  it("array vazio SEM erro e recusa silenciosa — o defeito inteiro", () => {
    expect(nadaFoiEscrito([], null)).toBe(true);
  });

  it("linha devolvida e escrita de verdade", () => {
    expect(nadaFoiEscrito([{ id: "1" }], null)).toBe(false);
  });

  it("com erro, quem responde e `gravacaoRecusadaComCerteza` — este helper se cala", () => {
    // Dois donos para a mesma pergunta dariam mensagens contraditorias na tela: o
    // erro ja tem tratamento proprio e mais informado (ele sabe se o commit
    // aconteceu). Aqui, erro presente => nao e este o caso.
    expect(nadaFoiEscrito([], { code: "42501" })).toBe(false);
    expect(nadaFoiEscrito(null, { code: "PGRST301" })).toBe(false);
  });

  it("`data` nulo (chamada sem `.select()`) NAO e tratado como escrita boa", () => {
    // Falha FECHADA de proposito: sem `.select()` nao da para distinguir "nao
    // gravou" de "nao pedi para ver". Assumir que gravou e o defeito de origem;
    // o helper acusa e a tela e corrigida para pedir o `.select()`.
    expect(nadaFoiEscrito(null, null)).toBe(true);
    expect(nadaFoiEscrito(undefined, null)).toBe(true);
  });
});
