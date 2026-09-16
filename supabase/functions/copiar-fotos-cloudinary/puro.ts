// Pedacos PUROS da migracao de fotos (sem Deno, sem rede): o vitest roda estes
// helpers em `puro.test.ts`, e o `index.ts` importa exatamente este modulo.

// Pares (tabela, coluna) que podem apontar para o Cloudinary do B2BWave. Uma
// tabela sem URL do Cloudinary sai com 0 candidatas — custa uma consulta.
export const ALVOS: ReadonlyArray<readonly [tabela: string, coluna: string]> = [
  ["produtos", "imagem_url"],
  ["produto_imagens", "imagem_url"],
  ["produto_variantes", "imagem_url"],
  ["categorias", "imagem_url"],
  ["banners", "imagem_url"],
  ["noticias", "imagem_url"],
  ["brands", "logo_url"],
  ["option_values", "imagem_url"],
  ["produto_arquivos", "arquivo_url"],
  ["configuracoes", "logo_url"],
  ["configuracoes", "footer_logo_url"],
  ["configuracoes", "catalog_logo_url"],
  ["configuracoes", "catalog_header_url"],
  ["configuracoes", "catalog_pdf_url"],
  ["configuracoes", "email_logo_url"],
];

export const BUCKET = "product-images";

// As URLs do Cloudinary nao tem extensao: a extensao vem do content-type da
// resposta. Tipo fora do mapa (HTML de erro com 200, por exemplo) e recusado.
const EXTENSOES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["application/pdf", ".pdf"],
]);

export function extensaoPorContentType(contentType: string | null | undefined): string | null {
  const tipo = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return EXTENSOES.get(tipo) ?? null;
}

// Caminho DETERMINISTICO por linha: rodar de novo depois de falha parcial
// regrava o MESMO objeto (upsert) em vez de acumular lixo. Nada de UUID aqui.
export function caminhoNoBucket(tabela: string, coluna: string, id: string | number, ext: string): string {
  const limpo = (s: string | number) => String(s).replace(/[^A-Za-z0-9_-]/g, "");
  const t = limpo(tabela), c = limpo(coluna), i = limpo(id);
  if (!t || !c || !i || !/^\.[a-z0-9]+$/.test(ext)) {
    throw new Error(`caminho invalido: ${tabela}.${coluna}/${id}${ext}`);
  }
  return `cloudinary/${t}.${c}/${i}${ext}`;
}

export function ehCloudinary(url: unknown): boolean {
  return typeof url === "string" && /^https:\/\/res\.cloudinary\.com\//i.test(url);
}
