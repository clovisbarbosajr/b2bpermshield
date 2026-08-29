import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

const cup = readFileSync("src/pages/admin/settings/Coupons.tsx", "utf8");
const inv = readFileSync("src/pages/admin/InventoryAdjustment.tsx", "utf8");

describe("Coupons: valor dentro da faixa que o servidor aceita", () => {
  // O servidor CLAMPA (`LEAST(GREATEST(_d,0), NEW.subtotal)`); a tela nao. A
  // divergencia nao vira desconto errado — vira checkout QUEBRADO: com 150% e
  // subtotal 100, a guarda de preco do Checkout barra o pedido com "The price
  // changed while you were checking out", mensagem que nao tem relacao com a
  // causa. E negativo e pior: a guarda so dispara quando o banco cobra MAIS,
  // entao o cliente ve "Discount -$20" com total inflado e paga o inflado.
  const save = fatiaEntre(cup, "const codigo = form.codigo.trim()", "const { error } = editing", 60);

  it("recusa valor negativo", () => {
    expect(save).toMatch(/valor < 0/);
    expect(save, "sem `return`, salva assim mesmo").toMatch(/toast\.error\("Value must be zero or more\."\); return;/);
  });

  it("recusa percentual acima de 100", () => {
    expect(save).toMatch(/form\.tipo === "percentual" && valor > 100/);
    expect(save).toMatch(/cannot be over 100%/);
  });

  it("o payload usa o valor VALIDADO, nao o do form", () => {
    // `valor: Number(form.valor)` no payload pularia a validacao acima.
    expect(save, "o payload voltou a ler o form cru").not.toMatch(/valor: Number\(form\.valor\)/);
  });

  it("o input tambem mostra o limite antes de salvar", () => {
    expect(cup).toMatch(/min=\{0\} max=\{form\.tipo === "percentual" \? 100 : undefined\}/);
  });
});

describe("Coupons: as datas vao com o fuso do admin", () => {
  // `timestamptz` + sessao UTC: string sem offset era lida como UTC. No leste dos
  // EUA o cupom com fim "10/ago" morria as 19h do dia 10, e o inicio "10/ago"
  // passava a valer as 20h do dia 9.
  it("converte pelo fuso local em vez de mandar a string crua", () => {
    expect(cup).toMatch(/const comFuso = \(data: string, hora: string\)/);
    expect(cup, "`new Date(...)` sem `toISOString` nao carrega o offset")
      .toMatch(/\.toISOString\(\)/);
  });

  it("as duas pontas usam a conversao", () => {
    expect(cup).toMatch(/const inicio = form\.data_inicio \? comFuso\(form\.data_inicio, "00:00:00"\) : null/);
    expect(cup).toMatch(/const fimDoDia = form\.data_fim \? comFuso\(form\.data_fim, "23:59:59"\) : null/);
    expect(cup, "`data_inicio: form.data_inicio` crua era metade do defeito")
      .not.toMatch(/data_inicio: form\.data_inicio \|\| null/);
  });

  // O ROUND-TRIP: a volta tem que desfazer o fuso que a ida aplicou.
  //
  // `split("T")[0]` corta a string UTC. Com a ida gravando `2026-08-10` fim do
  // dia em UTC-4 como `2026-08-11T03:59:59Z`, a volta devolvia `2026-08-11` — um
  // dia A MAIS. E como o dialogo reabre com a data errada, cada Edit+Save
  // empurrava o fim do cupom mais um dia: deriva cumulativa, e o admin so
  // descobre quando o cupom morre fora de hora.
  it("`openEdit` converte de volta pelo fuso local, nao corta a string UTC", () => {
    expect(cup, "`split(\"T\")[0]` sobre string UTC volta um dia errado")
      .not.toMatch(/data_fim: r\.data_fim\?\.split\("T"\)/);
    expect(cup).not.toMatch(/data_inicio: r\.data_inicio\?\.split\("T"\)/);
    expect(cup).toMatch(/const soData = /);
    // `getFullYear/getMonth/getDate` leem no fuso LOCAL — o mesmo que a ida usou.
    expect(cup).toMatch(/d\.getFullYear\(\)/);
    expect(cup, "`toISOString` aqui reintroduz o UTC que a ida desfez")
      .not.toMatch(/soData[\s\S]{0,300}?toISOString/);
    expect(cup).toMatch(/data_inicio: soData\(r\.data_inicio\), data_fim: soData\(r\.data_fim\)/);
  });

  it("data invalida nao vira `Invalid Date` no banco", () => {
    expect(cup).toMatch(/Number\.isNaN\(d\.getTime\(\)\) \? null :/);
  });
});

describe("InventoryAdjustment: a reserva entra no mesmo statement", () => {
  // A checagem de reservado era feita sobre o SELECT, e o gatilho de reserva
  // escreve SO em `estoque_reservado` — invisivel para o filtro de
  // `estoque_total`. Um checkout na janela deixava disponivel NEGATIVO, e aí o
  // produto trava e para de vender sem ninguem ser avisado.
  it("o UPDATE filtra tambem por `estoque_reservado`", () => {
    const upd = fatiaEntre(inv, 'update({ estoque_total: q })', ".maybeSingle()", 6);
    expect(upd).toContain('.eq("estoque_total", p.estoque_total)');
    expect(upd, "sem isto a reserva concorrente passa batida")
      .toContain('.lte("estoque_reservado", q)');
  });

  it("a grade trava durante o save", () => {
    // 4 round-trips por linha, em serie: redigitar uma linha ja gravada no lote
    // fazia a limpeza de estado levar o numero novo junto.
    const input = fatiaEntre(inv, 'value={newQty[p.id] ?? ""}', "className=", 6);
    expect(input, "so o botao tinha `disabled`").toContain("disabled={saving}");
  });
});
