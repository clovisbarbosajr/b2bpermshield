import { describe, it, expect, vi } from "vitest";
import { enviarAvisosCadastro, LIMITE_AVISOS_HORA, type DadosAviso } from "../_shared/avisosCadastro.ts";

// Os 3 avisos do auto-cadastro, EXERCITADOS. `permitido` falso tem que dar zero
// chamadas — e o que separa um robo sem captcha de 1.508 SMS.

const dados: DadosAviso = {
  sbUrl: "https://x.supabase.co", service: "SRV", anon: "ANON", cronSecret: "CRON",
  emailLc: "jane@acme.com", nome: "Jane", empresa: "Acme",
};

const fetchFalso = () => vi.fn(async () => new Response("{}"));

describe("enviarAvisosCadastro", () => {
  it.each([false, undefined, "true", 1])("permitido=%j -> zero envios", async (p) => {
    const f = fetchFalso();
    expect(await enviarAvisosCadastro(p as boolean, dados, f)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("permitido=true -> exatamente os 3 envios de sempre, com os mesmos corpos e credenciais", async () => {
    const f = fetchFalso();
    expect(await enviarAvisosCadastro(true, dados, f)).toBe(3);
    const chamadas = f.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit];
      return { url, method: init.method, headers: init.headers, body: JSON.parse(String(init.body)) };
    });
    expect(chamadas).toEqual([
      {
        url: "https://x.supabase.co/functions/v1/notify-dispatch", method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": "CRON", apikey: "ANON", Authorization: "Bearer ANON" },
        body: { event: "new_customer", vars: { customer_name: "Jane", customer_company: "Acme", customer_email: "jane@acme.com", customer_phone: "" } },
      },
      {
        url: "https://x.supabase.co/functions/v1/send-email", method: "POST",
        headers: { "Content-Type": "application/json", apikey: "SRV", Authorization: "Bearer SRV" },
        body: { type: "waiting_approval", customerEmail: "jane@acme.com" },
      },
      {
        url: "https://x.supabase.co/functions/v1/send-email", method: "POST",
        headers: { "Content-Type": "application/json", apikey: "SRV", Authorization: "Bearer SRV" },
        body: { type: "new_registration_admin", customerEmail: "jane@acme.com", customerName: "Jane", empresa: "Acme" },
      },
    ]);
  });

  it("falha de um envio nao bloqueia os outros nem lanca", async () => {
    let n = 0;
    const f = vi.fn(async () => { if (n++ === 0) throw new Error("rede"); return new Response("{}"); });
    expect(await enviarAvisosCadastro(true, dados, f)).toBe(2);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("limite de 3 avisos por e-mail por hora", () => {
    expect(LIMITE_AVISOS_HORA).toBe(3);
  });
});
