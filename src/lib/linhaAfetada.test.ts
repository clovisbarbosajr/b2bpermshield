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

  it("resultado de `maybeSingle()` e OBJETO, e objeto e escrita que aconteceu", () => {
    // `.select("id").maybeSingle()` devolve `{ id }` ou `null`, nunca array —
    // e `ImportCategories` usa essa forma. A versao anterior deste helper so
    // tratava array: `data?.length ?? 0` sobre um objeto da `undefined`, virava
    // 0, e a funcao afirmava "nada foi escrito" sobre a linha que ESTAVA ali.
    // Toda categoria atualizada sairia como erro.
    expect(nadaFoiEscrito({ id: "1" }, null)).toBe(false);
    // O objeto vazio tambem e uma linha — `.select("id")` de uma tabela sem a
    // coluna pedida devolveria `{}`, e "veio linha" continua sendo a resposta.
    expect(nadaFoiEscrito({}, null)).toBe(false);
    // E o `null` do `maybeSingle()` que nao achou linha e a recusa silenciosa.
    expect(nadaFoiEscrito(null, null)).toBe(true);
  });
});
