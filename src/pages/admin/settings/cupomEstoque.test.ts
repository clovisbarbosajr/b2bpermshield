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

describe("Coupons: as datas passam pela lib, nas DUAS pontas", () => {
  // A regra em si e exercitada de verdade em `src/lib/dataLocal.test.ts` — ela
  // saiu da tela justamente porque, inline, so dava para casar o TEXTO da fonte,
  // e tres mutantes comportamentais passavam verdes (inclusive `new Date()` no
  // lugar de `new Date(iso)`, que reescreveria as datas de todo cupom editado
  // para HOJE). Aqui so se garante a FIACAO: a tela nao pode voltar a fazer a
  // conversao a mao.
  it("a ida usa `paraInstanteLocal`", () => {
    expect(cup).toMatch(/const inicio = paraInstanteLocal\(form\.data_inicio, "00:00:00"\)/);
    expect(cup).toMatch(/const fimDoDia = paraInstanteLocal\(form\.data_fim, "23:59:59"\)/);
    expect(cup, "string crua era metade do defeito de fuso")
      .not.toMatch(/data_inicio: form\.data_inicio \|\| null/);
    expect(cup, "concatenar a hora a mao volta a gravar sem offset")
      .not.toMatch(/`\$\{form\.data_fim\}T23:59:59`/);
  });

  it("a volta usa `soDataLocal`", () => {
    expect(cup).toMatch(/data_inicio: soDataLocal\(r\.data_inicio\), data_fim: soDataLocal\(r\.data_fim\)/);
    // `split("T")[0]` sobre a string UTC devolvia um dia A MAIS, e o dialogo
    // salvava aquilo de volta: deriva cumulativa a cada Edit+Save.
    expect(cup).not.toMatch(/data_fim: r\.data_fim\?\.split\("T"\)/);
    expect(cup).not.toMatch(/data_inicio: r\.data_inicio\?\.split\("T"\)/);
  });

  it("a regra nao foi reimplementada dentro da tela", () => {
    // Duplicar aqui devolveria o codigo de producao para o ponto cego.
    expect(cup).not.toMatch(/const comFuso = /);
    expect(cup).not.toMatch(/const soData = /);
    expect(cup).toMatch(/import \{ paraInstanteLocal, soDataLocal \} from "@\/lib\/dataLocal"/);
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
