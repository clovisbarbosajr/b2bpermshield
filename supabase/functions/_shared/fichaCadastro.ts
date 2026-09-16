// Ficha do auto-cadastro (T24) — lida pela edge `register-customer`.
//
// Puro (sem Deno/banco) para o vitest exercitar a regra de verdade:
// `supabase/functions/register-customer/cadastroCompleto.test.ts`.
//
// SO LIMITE DE TAMANHO, NENHUM OBRIGATORIO. A tela ja exige telefone/endereco
// (`src/lib/cadastroCliente.ts`), mas o front e a edge sobem separados (Vercel x
// chat do Lovable) e uma aba aberta antes do deploy manda so {email,nome,empresa}.
// Recusar esse corpo acontecia DEPOIS do `signUp`: login criado, ficha nao, e o
// admin sem aviso. A ficha incompleta o admin completa na aprovacao.
//
// Mesmos numeros de `src/lib/cadastroCliente.ts`; o teste compara.
export const MAX_LEN = { texto: 200, email: 254, telefone: 40, cep: 20 };

export const CAMPOS_FICHA = ["telefone", "activity", "endereco", "endereco2", "cidade", "estado", "pais", "cep"] as const;

export type Ficha = Record<(typeof CAMPOS_FICHA)[number], string | null>;

const txt = (x: unknown) => String(x ?? "").trim();

export function lerFicha(body: Record<string, unknown>): { ficha: Ficha; invalido: boolean } {
  const limite = (k: string) => (MAX_LEN as Record<string, number>)[k] ?? MAX_LEN.texto;
  let invalido = txt(body.email).length > MAX_LEN.email
    || txt(body.nome).length > MAX_LEN.texto || txt(body.empresa).length > MAX_LEN.texto;
  const ficha = {} as Ficha;
  for (const k of CAMPOS_FICHA) {
    const v = txt(body[k]);
    if (v.length > limite(k)) invalido = true;
    ficha[k] = v || null;
  }
  return { ficha, invalido };
}
