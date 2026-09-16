// reCAPTCHA v2 do auto-cadastro (T25). Puro: o fetch vem de fora para o vitest
// exercitar a regra (`register-customer/cadastroCompleto.test.ts`).
//
// "indisponivel" = o problema e NOSSO (secret ausente/errado, Google fora do ar):
// a edge fecha (503) em vez de deixar passar sem verificar. "falhou" = token
// ausente, vencido (2 min), repetido ou forjado.
export type ResultadoCaptcha = "ok" | "falhou" | "indisponivel";

const SECRET_INVALIDO = ["missing-input-secret", "invalid-input-secret"];

export async function verificarCaptcha(
  token: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<ResultadoCaptcha> {
  if (!secret) return "indisponivel";
  if (!token) return "falhou";
  try {
    const res = await fetchFn("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
    });
    const r = await res.json();
    if (r?.success === true) return "ok";
    const codigos: string[] = Array.isArray(r?.["error-codes"]) ? r["error-codes"] : [];
    return codigos.some((c) => SECRET_INVALIDO.includes(c)) ? "indisponivel" : "falhou";
  } catch {
    return "indisponivel";
  }
}
