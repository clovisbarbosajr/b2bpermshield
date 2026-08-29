import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// A resolucao de rota da edge function `api` nao da pra importar: o arquivo faz
// `serve(...)` no topo e importa de `https://deno.land` / `https://esm.sh`, que o
// vitest nao resolve. Entao o teste EXTRAI o bloco de rota do proprio index.ts e
// o EXECUTA — nao e leitura de texto, e o codigo real rodando.
//
// O QUE ELE PROTEGE: a versao anterior procurava o primeiro segmento "v1" com
// `segments.indexOf("v1")`. Na URL nativa da funcao — /functions/v1/api/... — esse
// "v1" e o do gateway do Supabase, entao `resource` virava "api" e TODA chamada
// respondia 404 "Unknown resource". O fallback `?resource=` ficava num `else` que
// nunca era alcancado, entao o formato ensinado pela propria mensagem de ajuda
// tambem nao funcionava.

// Caminho relativo a RAIZ do repo, e nao `new URL(..., import.meta.url)`.
//
// O vitest serve os modulos por http para transformar TypeScript, entao
// `import.meta.url` aqui e uma URL http — e `readFileSync` so aceita `file:`.
// Este teste existia desde 28/ago e NUNCA tinha rodado: o `include` do
// `vitest.config.ts` era so `src/**`, entao ninguem executava e ninguem via que
// ele nem carregava. Teste que nao roda afirma cobertura que nao existe.
const fonte = readFileSync("supabase/functions/api/index.ts", "utf8");

const bloco = fonte.match(
  /const segments = url\.pathname[\s\S]*?const resourceId = rest\[1\][^;]*;/,
);

// Se o bloco mudou de forma, o teste tem que MORRER, nao passar vazio.
expect(bloco, "nao achei o bloco de resolucao de rota em index.ts").toBeTruthy();

const resolver = new Function(
  "url",
  `${bloco![0]} return { resource, resourceId };`,
) as (url: URL) => { resource: string; resourceId: string };

const rota = (u: string) => resolver(new URL(u, "https://x.supabase.co"));

describe("api: resolucao de recurso a partir da URL", () => {
  it("URL nativa da edge function com /v1 da API", () => {
    expect(rota("/functions/v1/api/v1/products")).toEqual({ resource: "products", resourceId: "" });
    expect(rota("/functions/v1/api/v1/orders/abc-123")).toEqual({ resource: "orders", resourceId: "abc-123" });
  });

  it("URL nativa sem o /v1 da API", () => {
    expect(rota("/functions/v1/api/customers/42")).toEqual({ resource: "customers", resourceId: "42" });
  });

  it("query param, que era o caminho ensinado na mensagem de ajuda", () => {
    expect(rota("/functions/v1/api?resource=products")).toEqual({ resource: "products", resourceId: "" });
    expect(rota("/functions/v1/api?resource=orders&id=9")).toEqual({ resource: "orders", resourceId: "9" });
  });

  it("dominio proprio /api/v1/{recurso}", () => {
    expect(rota("/api/v1/inventory")).toEqual({ resource: "inventory", resourceId: "" });
  });

  it("sem recurso nenhum devolve vazio (cai no 404 'Unknown resource')", () => {
    expect(rota("/functions/v1/api")).toEqual({ resource: "", resourceId: "" });
  });

  it("nunca devolve o nome da funcao como recurso", () => {
    for (const u of ["/functions/v1/api", "/functions/v1/api/v1/products", "/api/v1/orders/1"]) {
      expect(rota(u).resource).not.toBe("api");
      expect(rota(u).resource).not.toBe("v1");
    }
  });
});
