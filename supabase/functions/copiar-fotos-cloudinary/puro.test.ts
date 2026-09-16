import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fatiaEntre } from "../../../src/test/fatia";
import { ALVOS, BUCKET, caminhoNoBucket, ehCloudinary, extensaoPorContentType } from "./puro";

// A edge nao roda no vitest. O que roda: os helpers puros que ela importa, e
// guardas de fonte sobre o que NAO pode mudar numa funcao que escreve em
// producao — o padrao e `send-email/forceExigePrivilegio.test.ts`.

describe("extensaoPorContentType", () => {
  it("mapeia os tipos de imagem e ignora parametros", () => {
    expect(extensaoPorContentType("image/jpeg")).toBe(".jpg");
    expect(extensaoPorContentType("image/jpeg; charset=binary")).toBe(".jpg");
    expect(extensaoPorContentType("IMAGE/PNG")).toBe(".png");
    expect(extensaoPorContentType("image/webp")).toBe(".webp");
    expect(extensaoPorContentType("application/pdf")).toBe(".pdf");
  });
  it("recusa o que nao e imagem (HTML de erro com 200) e o vazio", () => {
    expect(extensaoPorContentType("text/html; charset=utf-8")).toBeNull();
    expect(extensaoPorContentType("application/octet-stream")).toBeNull();
    expect(extensaoPorContentType("")).toBeNull();
    expect(extensaoPorContentType(null)).toBeNull();
    expect(extensaoPorContentType(undefined)).toBeNull();
    // chave de prototipo nao vira extensao
    expect(extensaoPorContentType("constructor")).toBeNull();
  });
});

describe("caminhoNoBucket", () => {
  it("e deterministico, com prefixo cloudinary/ e um objeto por linha", () => {
    const a = caminhoNoBucket("produtos", "imagem_url", "3f2a-uuid", ".jpg");
    expect(a).toBe("cloudinary/produtos.imagem_url/3f2a-uuid.jpg");
    expect(caminhoNoBucket("produtos", "imagem_url", "3f2a-uuid", ".jpg")).toBe(a);
    expect(caminhoNoBucket("produto_imagens", "imagem_url", 42, ".png"))
      .toBe("cloudinary/produto_imagens.imagem_url/42.png");
  });
  it("nao deixa id ou tabela escapar do prefixo", () => {
    expect(caminhoNoBucket("produtos", "imagem_url", "../x", ".jpg")).toBe("cloudinary/produtos.imagem_url/x.jpg");
    expect(() => caminhoNoBucket("produtos", "imagem_url", "..", ".jpg")).toThrow();
    expect(() => caminhoNoBucket("", "imagem_url", "1", ".jpg")).toThrow();
    expect(() => caminhoNoBucket("produtos", "imagem_url", "1", "jpg")).toThrow();
    expect(() => caminhoNoBucket("produtos", "imagem_url", "1", ".JPG/")).toThrow();
  });
});

describe("ehCloudinary", () => {
  it("so aceita https://res.cloudinary.com/...", () => {
    expect(ehCloudinary("https://res.cloudinary.com/dbrtm8pf6/image/upload/v1/x")).toBe(true);
    expect(ehCloudinary("http://res.cloudinary.com/x")).toBe(false);
    expect(ehCloudinary("https://evil.com/res.cloudinary.com/x")).toBe(false);
    expect(ehCloudinary(null)).toBe(false);
  });
});

describe("copiar-fotos-cloudinary: o que a edge NAO pode fazer", () => {
  const fonte = readFileSync("supabase/functions/copiar-fotos-cloudinary/index.ts", "utf8");
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("usa os helpers testados, e nao copias", () => {
    expect(fonte).toMatch(/from "\.\/puro\.ts"/);
    expect(semComentario).toContain("caminhoNoBucket(tabela, coluna, id, ext)");
    expect(semComentario).toContain("extensaoPorContentType(contentType)");
    expect(semComentario).not.toContain("randomUUID");
    expect(ALVOS.map(([t, c]) => `${t}.${c}`)).toContain("produtos.imagem_url");
    expect(ALVOS.map(([t, c]) => `${t}.${c}`)).toContain("produto_imagens.imagem_url");
    expect(BUCKET).toBe("product-images");
  });

  it("dry_run e o padrao: so escreve quando vier literalmente false", () => {
    expect(semComentario).toContain("const dryRun = body?.dry_run !== false;");
    // no ensaio o laco de escrita nem comeca
    expect(semComentario).toMatch(/if \(dryRun \|\| !linhas\?\.length\) continue;/);
  });

  it("nao envia nada, nao mexe em auth, nao apaga, nao chama o B2BWave", () => {
    // o cabecalho CITA os arquivos proibidos; o que conta e o import
    expect(semComentario).not.toMatch(/_shared\/(dispatch|senders)/);
    expect(semComentario).not.toMatch(/\b(sendEmail|sendSms|dispatch|Resend|twilio)\b/i);
    expect(semComentario).not.toMatch(/\.(delete|remove)\(/);
    expect(semComentario).not.toMatch(/auth\.admin\./);
    expect(semComentario).not.toMatch(/b2bwave/i);
    expect(semComentario).not.toMatch(/user_roles"\)\.(update|insert|upsert|delete)/);
  });

  it("URL morta (!res.ok) vai para `mortas` ANTES de qualquer escrita, e a linha fica como esta", () => {
    const trecho = fatiaEntre(semComentario, "if (!res.ok) {", "const contentType", 8);
    expect(trecho).toContain("mortas.push(");
    expect(trecho).toContain("continue;");
    expect(trecho).not.toMatch(/upload\(|update\(/);
    // a ordem: o !res.ok vem antes do upload e do update
    const iMorta = semComentario.indexOf("if (!res.ok) {");
    const iUpload = semComentario.indexOf(".upload(caminho");
    const iUpdate = semComentario.indexOf(".update({ [coluna]: novaUrl })");
    expect(iMorta).toBeGreaterThan(-1);
    expect(iMorta).toBeLessThan(iUpload);
    expect(iUpload).toBeLessThan(iUpdate);
  });

  it("o upload e upsert (caminho fixo) e o update troca SO a coluna da URL, na linha certa, confirmando 1 linha", () => {
    expect(semComentario).toContain("upsert: true");
    const upd = fatiaEntre(semComentario, ".update({ [coluna]: novaUrl })", "copiadas++", 8);
    expect(upd).toContain('.eq("id", id)');
    expect(upd).toContain('.select("id").maybeSingle()');
    expect(upd).toMatch(/if \(updErr \|\| !atualizada\)/);
    expect(upd).toContain("continue;");
    expect(semComentario).not.toContain("admin_rev");
  });

  it("content-type fora do mapa nao escreve", () => {
    const trecho = fatiaEntre(semComentario, "const ext = extensaoPorContentType(contentType);", "const bytes", 6);
    expect(trecho).toMatch(/if \(!ext\) \{[\s\S]*?erros\.push\([\s\S]*?continue;/);
  });

  it("variantes entram na varredura (o portal mostra a foto da variante antes da do produto)", () => {
    expect(ALVOS.map(([t, c]) => `${t}.${c}`)).toContain("produto_variantes.imagem_url");
  });

  it("contagem final que falha vira `restantes: null`, nunca 0", () => {
    const trecho = fatiaEntre(semComentario, "let restantes: number | null = 0;", "return json({", 14);
    expect(trecho).toContain("error: cntErr");
    expect(trecho).toMatch(/if \(cntErr \|\| count === null\) \{[\s\S]*?restantes = null;/);
    // A consequencia: o null tem que SOBREVIVER as iteracoes seguintes. Em JS
    // `null + 3 === 3`, entao um `else` simples volta a somar e o relatorio
    // diz "acabou". O tsc do projeto nao cobre `supabase/functions`.
    expect(trecho, "o null e sobrescrito pela proxima contagem")
      .toMatch(/\} else if \(restantes !== null\) \{[\s\S]*?restantes \+= count;/);
    expect(trecho).not.toMatch(/\} else \{/);
  });

  it("o criterio de parada documentado e `copiadas`, nao `restantes = 0`", () => {
    expect(fonte).toMatch(/repetir enquanto `copiadas > 0`/);
    expect(fonte).not.toMatch(/repetir ate restantes = 0/);
  });

  it("sem offset: o conjunto encolhe a cada update", () => {
    expect(semComentario).not.toMatch(/\.range\(|\.offset\(/);
    expect(semComentario).toContain('.ilike(coluna, "%res.cloudinary.com%")');
  });
});
