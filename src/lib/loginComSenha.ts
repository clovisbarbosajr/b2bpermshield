// Login com senha que NUNCA deixa a tela parada.
//
// `signInWithPassword` do auth-js grava a sessao e SO DEPOIS avisa os
// assinantes de `onAuthStateChange`; se um assinante estoura, a promise REJEITA
// em vez de devolver `{ error }` (GoTrueClient: `_saveSession` -> `_notifyAllSubscribers`,
// que faz `throw errors[0]`). As telas de login faziam `await` sem try/catch:
// botao preso em "Signing in...", sem toast, sem navigate — e a sessao ja
// existia, por isso o F5 "entrava" (16/set). Aqui a excecao vira erro visivel.
// Nada mais muda: mesma autenticacao, mesmo destino, mesma checagem de papel.

type AuthComSenha = {
  signInWithPassword: (c: { email: string; password: string }) =>
    Promise<{ data?: { user?: unknown } | null; error?: { message?: string } | null }>;
};

// Forma unica (nao uniao discriminada): o projeto compila sem strictNullChecks
// e o narrowing por `ok` nao acontece.
export type ResultadoLogin = { ok: boolean; user: unknown; motivo: string };

export async function entrarComSenha(auth: AuthComSenha, email: string, password: string): Promise<ResultadoLogin> {
  try {
    const { data, error } = await auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, user: null, motivo: error.message || "Could not sign in" };
    return { ok: true, user: data?.user ?? null, motivo: "" };
  } catch (e) {
    return { ok: false, user: null, motivo: (e as Error)?.message || "Unexpected error while signing in" };
  }
}
