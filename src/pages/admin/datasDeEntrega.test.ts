import { describe, it, expect } from "vitest";
// @ts-expect-error — tsconfig.app.json nao inclui os tipos do Node; vitest roda em Node.
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

/**
 * DATA DE ENTREGA E DATA DE CALENDARIO, NAO INSTANTE.
 *
 * `pedidos.delivery_date` e `timestamptz` gravado a meia-noite UTC (vem de um
 * `<input type="date">`). Formatar no fuso do navegador mostrava o DIA ANTERIOR
 * em qualquer fuso a oeste de Greenwich: o cliente via a entrega um dia antes no
 * portal e no CSV, e na lista do admin a coluna discordava do proprio filtro.
 *
 * `created_at` e o oposto (instante real) e continua no fuso local — por isso o
 * teste exige as DUAS coisas em cada tela.
 */
const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("data de entrega e lida em UTC em toda tela que a mostra", () => {
  it("admin/Pedidos: coluna Delivery em UTC, coluna Created no fuso local", () => {
    const s = semComentario(ler("src/pages/admin/Pedidos.tsx"));
    expect(s).toMatch(/const fmtEntrega = \(d: string\) => new Date\(d\)\.toLocaleDateString\("en-US", \{[^}]*timeZone: "UTC"[^}]*\}\)/);
    expect(s).toContain("{p.delivery_date ? fmtEntrega(p.delivery_date) : \"\"}");
    // e o formatador local NAO pode voltar a desenhar entrega
    expect(s).not.toMatch(/fmtDate\(p\.delivery_date\)/);
    expect(s).toContain("fmtDate(p.created_at)");
  });

  it.each([
    ["src/pages/portal/Pedidos.tsx", 2],
    ["src/pages/portal/PedidoDetalhe.tsx", 1],
  ])("%s: fmtDateShort (so entrega) usa getUTC*", (arquivo, chamadas) => {
    const s = semComentario(ler(arquivo));
    const corpo = fatiaEntre(s, "const fmtDateShort", "};", 10);
    expect(corpo).toContain("getUTCMonth()");
    expect(corpo).toContain("getUTCDate()");
    expect(corpo).toContain("getUTCFullYear()");
    // toda chamada dele e de `delivery_date` (se virar instante, o teste cai)
    const usos = [...s.matchAll(/fmtDateShort\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !a.includes("d: string"));
    expect(usos).toHaveLength(chamadas);
    for (const u of usos) expect(u).toContain("delivery_date");
  });

  it("preview de e-mail: entrega em UTC, como o envio real (Deno roda em UTC)", () => {
    const s = semComentario(ler("src/pages/admin/settings/Notificacoes.tsx"));
    expect(s).toMatch(/deliveryDate: pedido\.delivery_date \? new Date\(pedido\.delivery_date\)\.toLocaleDateString\('en-US', \{ timeZone: 'UTC' \}\) : '-'/);
    // `orderDate` e instante: continua no formatador local
    expect(s).toContain("orderDate: fmt(pedido.created_at)");
  });
});
