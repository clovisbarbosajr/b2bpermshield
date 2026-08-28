import { describe, it, expect } from "vitest";
import { gravacaoRecusadaComCerteza } from "@/lib/gravacaoRecusada";

// Esta funcao decide se um erro de escrita significa "com certeza nao gravou".
// Errar isso custa caro nos dois sentidos: assumir que nao gravou faz o proximo
// Save criar um produto DUPLICADO no catalogo; assumir que gravou faz a tela
// acusar de conflito um colega que nao existe.
//
// Eu errei esta decisao DUAS vezes antes de escrever o teste — as duas
// testando `status === 0`, que erra nas duas direcoes. Os casos abaixo saem de
// `node_modules/@supabase/postgrest-js/dist/index.mjs`, nao de suposicao.

describe("gravacaoRecusadaComCerteza", () => {
  // ── DEFINITIVO: o PostgREST respondeu com estrutura, a transacao abortou ────
  it.each([
    [400, "22003", "numero fora da faixa do integer"],
    [400, "PGRST204", "coluna nao existe no schema cache"],
    [409, "23505", "violacao de unique"],
    [403, "42501", "RLS negou"],
    [401, "PGRST301", "JWT expirado"],
  ])("status %i code %s (%s) => nada foi gravado", (status, code) => {
    expect(gravacaoRecusadaComCerteza(status, { code, message: "x" })).toBe(true);
  });

  // ── INCERTO: pode ter commitado e a resposta nao voltou ────────────────────
  it("falha de fetch (status 0) e incerta", () => {
    // O `catch` de transporte do postgrest-js devolve status 0 e code "".
    expect(gravacaoRecusadaComCerteza(0, { code: "", message: "FetchError" })).toBe(false);
  });

  it.each([502, 503, 504, 520, 522, 524])(
    "5xx de gateway SEM code (%i) e incerto, mesmo com status HTTP real",
    (status) => {
      // Corpo HTML de proxy: o postgrest-js cai no `catch` do JSON.parse e devolve
      // `{ message: body }` — SEM `code`. A escrita pode ter chegado ao Postgres.
      // A propria lib lista 520 e 503 como retentaveis e ainda assim se recusa a
      // repetir POST/PATCH, exatamente por isso.
      expect(gravacaoRecusadaComCerteza(status, { message: "<html>...</html>" })).toBe(false);
    },
  );

  // ── 5xx COM code: o PostgREST respondeu, entao o desfecho e CONHECIDO ───────
  // Sao justamente os erros de concorrencia, os mais comuns sob carga. A versao
  // anterior exigia 4xx e mandava todos eles para o balde do "incerto", travando a
  // tela num erro que com certeza abortou a transacao.
  it.each([
    [500, "57014", "statement timeout"],
    [500, "40001", "falha de serializacao"],
    [500, "40P01", "deadlock"],
    [503, "53300", "conexoes demais"],
  ])("status %i code %s (%s) => nada foi gravado", (status, code) => {
    expect(gravacaoRecusadaComCerteza(status, { code, message: "x" })).toBe(true);
  });

  it("resposta 200 com corpo nao-JSON e incerta (aqui provavelmente ATE gravou)", () => {
    // `processResponse`: no ramo `res.ok`, um `JSON.parse` que falha vira
    // `error = { message: body }` mantendo status 200.
    expect(gravacaoRecusadaComCerteza(200, { message: "<html>...</html>" })).toBe(false);
  });

  it("4xx SEM code e incerto — nao veio do PostgREST", () => {
    // Um 404 de proxy, por exemplo. Sem `code` nao ha resposta estruturada.
    expect(gravacaoRecusadaComCerteza(404, { message: "Not Found" })).toBe(false);
  });

  it("code vazio (o que o catch de transporte produz) nao conta como code", () => {
    expect(gravacaoRecusadaComCerteza(0, { code: "", message: "FetchError" })).toBe(false);
  });

  it("erro nulo ou sem code nao e tratado como definitivo", () => {
    expect(gravacaoRecusadaComCerteza(400, null)).toBe(false);
    expect(gravacaoRecusadaComCerteza(400, undefined)).toBe(false);
    expect(gravacaoRecusadaComCerteza(400, {})).toBe(false);
  });

  // Os dois erros que ja foram cometidos aqui, fixados como teste.
  it("a regra NAO e `status !== 0` — 5xx de gateway sem code seria dado como definitivo", () => {
    expect(gravacaoRecusadaComCerteza(500, { message: "boom" })).toBe(false);
  });

  it("a regra NAO exige 4xx — erro de concorrencia vem como 5xx e e definitivo", () => {
    expect(gravacaoRecusadaComCerteza(500, { code: "40001", message: "x" })).toBe(true);
  });
});
