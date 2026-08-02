/**
 * Formata o `valores_opcao` de uma variante (vindo do B2BWave) em texto legível.
 * Robusto a vários formatos: objeto {Size:"M"}, array de strings, array de
 * {name,value}.
 *
 * Morava dentro de `ProdutoDetalhe.tsx`. Foi promovido a módulo porque o
 * re-order (`Pedidos.tsx`) precisa remontar o mesmo rótulo — antes ele não
 * tinha como, e a variante se perdia ao repetir um pedido.
 */
export const formatOpcao = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x == null) return "";
      if (typeof x === "string" || typeof x === "number") return String(x);
      const name = x.option_name ?? x.name ?? x.key ?? x.label;
      const val = x.value ?? x.valor ?? x.v;
      if (name != null && val != null) return `${name}: ${val}`;
      return String(val ?? name ?? "");
    }).filter(Boolean).join(" / ");
  }
  if (typeof v === "object") {
    return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(" / ");
  }
  return String(v);
};
