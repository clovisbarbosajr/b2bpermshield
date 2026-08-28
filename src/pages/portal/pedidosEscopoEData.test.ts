import { describe, it, expect, vi } from "vitest";

// A tela cria o cliente do Supabase no import e o vitest.config.ts nao injeta
// VITE_SUPABASE_URL. O que esta sob teste aqui e regra pura.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { escoparPelaRls, limiteDataISO } from "./Pedidos";

// Trava as duas regras do historico do cliente que estavam quebradas:
//
// 1. ESCOPO. A lista fixava `cliente_id = a minha ficha`, o que anulava as
//    policies `Sub-customer reads parent history` e `Parent reads sub-customer
//    orders` — as flags do admin nao mudavam nada no portal. Agora a RLS decide,
//    MENOS quando quem esta logado nao e uma conta de cliente comum: staff le
//    TODOS os pedidos (`Admins can manage` / `Managers manage` / `Warehouse
//    read`) e `/portal/pedidos` nao exige papel nenhum em App.tsx.
// 2. LIMITE DE DATA. A lista convertia o dia local para ISO e o export mandava o
//    literal cru — resolvido em UTC. O CSV saia sem pedidos que estavam na tela.
describe("escoparPelaRls", () => {
  it("cliente comum: deixa a RLS escopar (pedido do pai / do sub-usuario aparece)", () => {
    expect(escoparPelaRls("cliente", null)).toBe(true);
    expect(escoparPelaRls("cliente", undefined)).toBe(true);
  });

  it("staff filtra sempre — le todos os pedidos do banco", () => {
    for (const papel of ["admin", "manager", "warehouse"]) {
      expect(escoparPelaRls(papel, null)).toBe(false);
    }
  });

  it('"view as": o AuthContext finge role="cliente", mas a sessao HTTP e a do admin', () => {
    expect(escoparPelaRls("cliente", "cliente-impersonado-1")).toBe(false);
  });

  it("falha fechado: papel desconhecido ou ausente filtra", () => {
    expect(escoparPelaRls(null, null)).toBe(false);
    expect(escoparPelaRls(undefined, null)).toBe(false);
    expect(escoparPelaRls("", null)).toBe(false);
  });
});

describe("limiteDataISO", () => {
  it("o fim do dia local cobre o dia inteiro e nao invade o dia seguinte", () => {
    const inicio = limiteDataISO("2026-08-28", "inicio");
    const fim = limiteDataISO("2026-08-28", "fim");
    expect(new Date(fim).getTime() - new Date(inicio).getTime()).toBe(86_400_000 - 1);
  });

  it("as bordas batem com a MEIA-NOITE LOCAL — e nao com a UTC", () => {
    // O bug do export: mandar o literal cru fazia o Postgres resolver em UTC.
    // Fora de UTC, esse instante nao e a meia-noite local do dia pedido.
    const inicio = new Date(limiteDataISO("2026-08-28", "inicio"));
    expect(inicio.getFullYear()).toBe(2026);
    expect(inicio.getMonth()).toBe(7); // agosto
    expect(inicio.getDate()).toBe(28);
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);

    const fim = new Date(limiteDataISO("2026-08-28", "fim"));
    expect(fim.getDate()).toBe(28);
    expect(fim.getHours()).toBe(23);
    expect(fim.getMinutes()).toBe(59);
  });

  it("um pedido feito as 20h locais entra no filtro 'ate hoje'", () => {
    // Este e o caso que o cliente reclamava: comprou de tarde, filtrou "ate
    // hoje", e o pedido nao vinha no CSV porque 20h local ja era o dia seguinte
    // em UTC.
    const pedido = new Date(2026, 7, 28, 20, 0, 0);
    expect(pedido.toISOString() <= limiteDataISO("2026-08-28", "fim")).toBe(true);
    expect(pedido.toISOString() >= limiteDataISO("2026-08-28", "inicio")).toBe(true);
  });
});
