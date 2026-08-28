import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// A tela cria o cliente do Supabase no import e o vitest.config.ts nao injeta
// VITE_SUPABASE_URL. O que esta sob teste aqui e formatacao pura de data.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { formatDeliveryDate, formatOrderDateTime } from "./Dashboard";

// O bug so aparece FORA de UTC — em UTC as duas versoes dao o mesmo resultado.
// Por isso o teste roda num fuso a oeste de Greenwich.
beforeAll(() => { vi.stubEnv("TZ", "America/Sao_Paulo"); });
afterAll(() => { vi.unstubAllEnvs(); });

describe("formatDeliveryDate — data de calendario, le em UTC", () => {
  it("timestamptz gravado a meia-noite UTC mostra o dia que o admin digitou", () => {
    // `delivery_date` e timestamptz, mas o valor vem de <input type="date">:
    // o Postgres grava 2026-08-27T00:00:00Z. Formatado em horario local
    // (UTC-3) isso era 26/ago — a entrega aparecia um dia ANTES.
    expect(formatDeliveryDate("2026-08-27T00:00:00+00:00")).toBe("08/27/2026");
  });

  it("literal YYYY-MM-DD do fallback em `observacoes` tambem nao anda pra tras", () => {
    // `new Date("2026-08-27")` e meia-noite UTC, nao meia-noite local.
    expect(formatDeliveryDate("2026-08-27")).toBe("08/27/2026");
  });

  it("virada de ano: 01/jan nao vira 31/dez", () => {
    expect(formatDeliveryDate("2027-01-01T00:00:00+00:00")).toBe("01/01/2027");
  });
});

describe("formatOrderDateTime — instante, mostra em fuso local", () => {
  it("pedido das 21h fica no dia 27, o mesmo dia em que o grafico o conta", () => {
    // O grafico agrupa por mes LOCAL (`d.getMonth()`). A lista mostrava UTC
    // (`toISOString`), entao este pedido saia como "2026-08-28" na lista e
    // contava em agosto no grafico.
    const instante = new Date(2026, 7, 27, 21, 0, 0);
    expect(formatOrderDateTime(instante.toISOString())).toBe("2026-08-27 21:00:00");
  });

  it("bate componente a componente com o fuso do navegador, seja qual for", () => {
    const d = new Date("2026-03-01T02:15:09-05:00");
    const p = (n: number) => String(n).padStart(2, "0");
    expect(formatOrderDateTime(d.toISOString())).toBe(
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    );
  });
});
