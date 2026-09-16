// Cadastro publico do cliente (T24) — mesma ficha do B2BWave.
//
// A edge `register-customer` NAO importa de `src/`: ela le a ficha com
// `supabase/functions/_shared/fichaCadastro.ts` (MAX_LEN e CAMPOS_FICHA proprios),
// e `register-customer/cadastroCompleto.test.ts` compara os dois. Mudou aqui, muda la.

// Chave PUBLICA do reCAPTCHA v2 (vai no bundle de proposito). A secreta fica no
// Lovable Cloud como `registercustomer` e so a edge a le.
export const RECAPTCHA_SITE_KEY = "6Lfzbr8tAAAAAO6uRXXdiPdomCjJu72P12fFHyPd";

export const ACTIVITY_OPTIONS = ["Other", "Contractor", "Retailer", "Wholesaler", "Distributor", "Manufacturer"];

export const COUNTRIES = ["United States", "Canada", "United Kingdom", "Brazil"];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

export type CadastroForm = {
  empresa: string; nome: string; telefone: string; activity: string;
  endereco: string; endereco2: string; cidade: string; estado: string; pais: string; cep: string;
  email: string; password: string; passwordConfirm: string;
};

export const REQUIRED = ["empresa", "nome", "telefone", "endereco", "cidade", "pais", "cep", "email", "password", "passwordConfirm"] as const;

export const MAX_LEN = { texto: 200, email: 254, telefone: 40, cep: 20 };

export const LABELS: Record<keyof CadastroForm, string> = {
  empresa: "Company name", nome: "Full name", telefone: "Phone", activity: "Activity",
  endereco: "Address", endereco2: "Address line 2", cidade: "City", estado: "State", pais: "Country",
  cep: "Postal code", email: "Email", password: "Password", passwordConfirm: "Password confirmation",
};

export const limiteDe = (k: keyof CadastroForm): number | undefined =>
  k === "password" || k === "passwordConfirm" ? undefined
    : (MAX_LEN as Record<string, number>)[k] ?? MAX_LEN.texto;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Primeira mensagem de erro (em ingles, vai para o toast) ou null. */
export function validarCadastro(f: CadastroForm): string | null {
  for (const k of REQUIRED) if (!f[k].trim()) return `${LABELS[k]} is required`;
  for (const k of Object.keys(LABELS) as (keyof CadastroForm)[]) {
    const max = limiteDe(k);
    if (max !== undefined && f[k].trim().length > max) return `${LABELS[k]} must be at most ${max} characters`;
  }
  if (!EMAIL_RE.test(f.email.trim())) return "Please enter a valid email";
  if (f.password.length < 8) return "Password must be at least 8 characters";
  if (f.password !== f.passwordConfirm) return "Password confirmation does not match";
  return null;
}

/** O que vai no corpo do `register-customer` alem de email/nome/empresa. Vazio vira null. */
export function montarFicha(f: CadastroForm) {
  const t = (s: string) => s.trim() || null;
  return {
    telefone: t(f.telefone), activity: t(f.activity), endereco: t(f.endereco), endereco2: t(f.endereco2),
    cidade: t(f.cidade), estado: t(f.estado), pais: t(f.pais), cep: t(f.cep),
  };
}
