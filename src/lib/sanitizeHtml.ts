// Sanitiza HTML de descrição de produto (vem do B2BWave com <strong>, <p>, <ul>...).
// Renderizar HTML cru seria XSS; aqui mantemos só uma whitelist de tags/atributos de
// formatação e removemos scripts, handlers (on*) e URLs perigosas. Sem dependência
// externa — usa o DOMParser do próprio navegador.

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SPAN", "DIV",
  "UL", "OL", "LI", "A", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE",
]);
const SAFE_URL = /^(https?:|mailto:|tel:)/i;

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  // Ambiente sem DOM (SSR/teste): devolve texto sem tags como fallback seguro.
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return dirty.replace(/<[^>]*>/g, "");
  }
  const doc = new DOMParser().parseFromString(dirty, "text/html");

  const clean = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Tag não permitida: preserva o TEXTO (desembrulha), descarta a tag.
          const text = doc.createTextNode(el.textContent ?? "");
          el.replaceWith(text);
          continue;
        }
        // Remove todos os atributos, exceto href seguro em <a>.
        for (const attr of Array.from(el.attributes)) {
          const keep = el.tagName === "A" && attr.name.toLowerCase() === "href" && SAFE_URL.test(attr.value.trim());
          if (!keep) el.removeAttribute(attr.name);
        }
        if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
        clean(el); // recursivo nos filhos permitidos
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove(); // comentários etc.
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
