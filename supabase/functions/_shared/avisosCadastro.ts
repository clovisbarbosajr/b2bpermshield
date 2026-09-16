// Os 3 avisos do auto-cadastro (register-customer): SMS `new_customer` para o dono,
// e-mail "recebemos seu cadastro" para o cliente e e-mail "novo cadastro" para o admin.
//
// Isolado e puro (fetch vem de fora) para o teste EXERCITAR a regra, em vez de ler
// o texto da edge: `permitido` falso => ZERO envios. Esse e o botao que um robo
// aperta (incidente de 25/ago: 1.508 SMS). A edge nao tem nenhum `fetch(` proprio;
// `register-customer/captcha.test.ts` prende isso.
export const LIMITE_AVISOS_HORA = 3;

export type DadosAviso = {
  sbUrl: string; service: string; anon: string; cronSecret: string;
  emailLc: string; nome: string; empresa: string;
};

/** Devolve quantos envios foram disparados sem lancar. Falha de um nao bloqueia os outros. */
export async function enviarAvisosCadastro(permitido: boolean, d: DadosAviso, fetchFn: typeof fetch): Promise<number> {
  if (permitido !== true) return 0;
  const comService = { "Content-Type": "application/json", apikey: d.service, Authorization: `Bearer ${d.service}` };
  const envios: [string, Record<string, string>, unknown][] = [
    [`${d.sbUrl}/functions/v1/notify-dispatch`,
      { "Content-Type": "application/json", "x-cron-secret": d.cronSecret, apikey: d.anon, Authorization: `Bearer ${d.anon}` },
      { event: "new_customer", vars: { customer_name: d.nome || "", customer_company: d.empresa || "", customer_email: d.emailLc, customer_phone: "" } }],
    [`${d.sbUrl}/functions/v1/send-email`, comService, { type: "waiting_approval", customerEmail: d.emailLc }],
    [`${d.sbUrl}/functions/v1/send-email`, comService,
      { type: "new_registration_admin", customerEmail: d.emailLc, customerName: d.nome || "", empresa: d.empresa || "" }],
  ];
  let feitos = 0;
  for (const [url, headers, body] of envios) {
    try {
      await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body) });
      feitos++;
    } catch (_e) { /* nao bloqueia */ }
  }
  return feitos;
}
