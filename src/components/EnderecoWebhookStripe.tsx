import { stripeWebhookEndpoint, AVISO_WEBHOOK_SEM_HOST } from "@/lib/stripeWebhookEndpoint";

/**
 * O endereco que o admin COPIA daqui e cola no painel da Stripe.
 *
 * Vive num componente proprio, e nao solto dentro de `Configuracoes.tsx`, por um
 * motivo de TESTE, nao de organizacao: enquanto isto era JSX no meio da tela, a
 * unica cobertura possivel era ler o texto do arquivo — e assert de fonte nao
 * distingue "esta escrito" de "aparece na tela". Sobreviviam verdes um
 * `{false && <p>…</p>}` em volta do bloco e um `<code className="hidden">`.
 * Isolado, o componente e renderizado de verdade no teste.
 */
export const EnderecoWebhookStripe = ({ supabaseUrl }: { supabaseUrl?: string }) => {
  const url = stripeWebhookEndpoint(supabaseUrl);
  // SEM `hidden` no `<p>`. O bloco inteiro estava com a classe `hidden` do
  // Tailwind (`display: none`), entao o endereco que o admin precisa COPIAR e
  // colar no painel da Stripe nunca aparecia — e o texto estava todo la, o que faz
  // qualquer assert de fonte passar verde. E exatamente o motivo pelo qual este
  // componente foi extraido: renderizado de verdade no teste, o `hidden` cai.
  return (
    <p className="text-xs text-muted-foreground mt-1">
      To receive webhook events (payment confirmation), set the webhook endpoint in Stripe Dashboard to:<br />
      <code className="text-xs bg-muted px-1 rounded">{url || AVISO_WEBHOOK_SEM_HOST}</code>
    </p>
  );
};

export default EnderecoWebhookStripe;
