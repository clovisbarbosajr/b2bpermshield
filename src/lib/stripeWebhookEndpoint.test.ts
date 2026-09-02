/**
 * A URL do webhook da Stripe e DITADA ao operador para colar no painel da
 * Stripe. Errada, ela nao da erro em lugar nenhum: o admin cola, preenche o
 * `whsec_`, ve "Live mode" na tela, e os eventos morrem em silencio.
 *
 * O que estes asserts prendem, e por que:
 *   - o segmento de funcao tem que EXISTIR em `supabase/functions/` — o valor
 *     antigo, "stripe-webhook", nao existe (o handler mora dentro de
 *     `stripe-checkout`, roteado pelo header `stripe-signature`);
 *   - o que sai do helper e "" ou uma URL ABSOLUTA — nunca um caminho com cara de
 *     endereco. Duas versoes anteriores deste teste erraram aqui: uma proibia so
 *     `/^\/functions/` (e `"functions/v1/..."` sem barra sobrevivia), outra so
 *     testava entradas que ja passavam (e host sem `https://` sobrevivia);
 *   - o esquema tem que sobreviver — `.replace(/^http/, "https")` produzia
 *     "httpss://" em producao.
 *
 * A parte de EXIBICAO fica em `EnderecoWebhookStripe.test.tsx`, que RENDERIZA o
 * componente. Assert de fonte nao distingue "esta escrito" de "aparece na tela".
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em
// execucao o modulo existe (vitest roda em Node). Mesmo padrao de `src/test/ast.ts`.
import { readFileSync, existsSync } from "node:fs";
import { stripeWebhookEndpoint, FUNCAO_WEBHOOK_STRIPE, AVISO_WEBHOOK_SEM_HOST } from "./stripeWebhookEndpoint";

describe("endpoint do webhook da Stripe", () => {
  it("aponta para uma edge function que EXISTE no repo", () => {
    expect(existsSync(`supabase/functions/${FUNCAO_WEBHOOK_STRIPE}`)).toBe(true);
  });

  it("a funcao apontada e a que trata o header `stripe-signature`", () => {
    const fn = readFileSync(`supabase/functions/${FUNCAO_WEBHOOK_STRIPE}/index.ts`, "utf8");
    expect(fn).toContain('req.headers.get("stripe-signature")');
  });

  it("monta em cima do host do Supabase, com o esquema intacto", () => {
    expect(stripeWebhookEndpoint("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co/functions/v1/stripe-checkout",
    );
    // o bug do `^http`: "https" comeca com "http"
    expect(stripeWebhookEndpoint("https://abc.supabase.co")).not.toContain("httpss");
    expect(stripeWebhookEndpoint("http://localhost:54321")).toBe(
      "http://localhost:54321/functions/v1/stripe-checkout",
    );
  });

  it("normaliza barra final, inclusive repetida", () => {
    for (const host of ["https://abc.supabase.co/", "https://abc.supabase.co//", "  https://abc.supabase.co/  "]) {
      expect(stripeWebhookEndpoint(host)).toBe("https://abc.supabase.co/functions/v1/stripe-checkout");
    }
  });

  it('so emite "" ou URL absoluta — nada que apenas PARECA endereco', () => {
    for (const entrada of [
      undefined, "", "   ", "\t\n",
      "abc.supabase.co", "/functions/v1", "supabase.co/x",
      // caminho e espaco no meio: a guarda `[^/\s]+$` so fica presa se alguem
      // exercitar as duas coisas que ela existe para recusar.
      "https://abc.supabase.co/rest", "https://abc.supabase.co/rest/v1",
      "https://abc supabase.co", "https://abc.supabase.co/a/b",
      // lixo ANTES do esquema e host vazio: sem estes, a ancora `^` e o `+` da
      // guarda nao ficam presos por nada, e `url=https://abc.supabase.co` voltava
      // a virar endereco colavel.
      "url=https://abc.supabase.co", "<https://abc.supabase.co", " x https://abc.supabase.co",
      "https://", "http://",
    ]) {
      expect(() => stripeWebhookEndpoint(entrada)).not.toThrow();
      expect(stripeWebhookEndpoint(entrada)).toBe("");
    }
    const absoluta = /^https?:\/\/[^\s/]+\/functions\/v1\/stripe-checkout$/;
    for (const entrada of [undefined, "", "abc.supabase.co", "https://abc.supabase.co", "http://localhost:54321/"]) {
      const u = stripeWebhookEndpoint(entrada);
      expect(u === "" || absoluta.test(u)).toBe(true);
    }
  });

  it("o aviso de host ausente nao e vazio nem confundivel com uma URL", () => {
    // Prender so `functions/v1` nao bastava: um aviso do tipo
    // "https://your-project.supabase.co (fill in your host)" passava, e a tela
    // voltava a DITAR um endereco com cara de valido — o defeito original de
    // volta pela porta do fallback. O aviso nao pode conter NADA parecido com
    // endereco.
    expect(AVISO_WEBHOOK_SEM_HOST.trim()).not.toBe("");
    expect(AVISO_WEBHOOK_SEM_HOST).not.toMatch(/functions\/v1/);
    expect(AVISO_WEBHOOK_SEM_HOST).not.toMatch(/https?:\/\//i);
    expect(AVISO_WEBHOOK_SEM_HOST).not.toMatch(/\S+\.(com|co|io|net|org|dev|app)\b/i);
  });
});
