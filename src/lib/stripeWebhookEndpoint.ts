/**
 * Endereco que o admin cola no painel da Stripe.
 *
 * A tela DITAVA a URL errada em tres eixos ao mesmo tempo, e o admin nao tinha
 * como perceber:
 *   1. host — usava `window.location.origin`, a origem do SPA. As edge functions
 *      ficam em `VITE_SUPABASE_URL` (todo o resto do repo monta assim:
 *      portal/Checkout.tsx:17, settings/Profile.tsx:1165). E o `vercel.json` tem
 *      catch-all para `index.html`, entao a Stripe receberia 200 OK com HTML:
 *      entrega "bem-sucedida", sem retry e sem alerta.
 *   2. funcao — apontava para `stripe-webhook`, que NAO EXISTE. O handler mora
 *      dentro de `stripe-checkout`, roteado pelo header `stripe-signature`
 *      (supabase/functions/stripe-checkout/index.ts:19).
 *   3. `.replace(/^http/, "https")` — `^http` casa tambem o comeco de "https",
 *      entao em producao "https://app.com" virava "httpss://app.com". Justo onde
 *      a URL seria usada de verdade. O `origin` ja vem com o esquema certo; nao
 *      ha o que reescrever.
 *
 * Sem host, devolve "" em vez de "/functions/v1/...": um caminho RELATIVO parece
 * uma URL valida na tela e o admin colaria na Stripe do mesmo jeito. Melhor a
 * tela dizer que nao sabe o endereco do que ditar um errado.
 */
export const FUNCAO_WEBHOOK_STRIPE = "stripe-checkout";

/** Exibido no lugar da URL quando o build nao sabe o host. */
export const AVISO_WEBHOOK_SEM_HOST =
  "unavailable — this build has no Supabase URL configured; ask your developer instead of guessing";

export const stripeWebhookEndpoint = (supabaseUrl: string | undefined): string => {
  const host = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  // Exige esquema: `VITE_SUPABASE_URL=abc.supabase.co` (sem `https://`) dava
  // "abc.supabase.co/functions/v1/..." — de novo um endereco relativo com cara de
  // absoluto, que e justamente o que este modulo promete nunca emitir. Fronteira
  // de confianca: o que sai daqui vai para o painel da Stripe pela mao do admin.
  return /^https?:\/\/[^/\s]+$/.test(host) ? `${host}/functions/v1/${FUNCAO_WEBHOOK_STRIPE}` : "";
};
