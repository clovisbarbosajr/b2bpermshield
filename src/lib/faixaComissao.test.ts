// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// ESTE ARQUIVO ENCOLHEU DE PROPOSITO.
//
// Antes ele extraia o corpo de `faixaComissao` de dentro de `Representantes.tsx`
// por regex e o remontava com `new Function` — o unico jeito de EXERCITAR uma
// funcao presa num componente. Funcionava, e era fragil: qualquer mudanca de
// formatacao no arquivo derrubava a extracao, e foi o que aconteceu.
//
// A logica saiu para `lib/percentual.ts`, que tem teste que executa de verdade
// (`percentual.test.ts`) e cobre os dois chamadores — porque o MESMO defeito
// (`parseFloat(x) || 0` nao pega negativo, `-8.25` e truthy) estava aqui e em
// `SalesTax`, e la ele chega ao imposto cobrado no pedido.
//
// O que sobra aqui e a fiacao: cobrar que a tela use a funcao compartilhada em
// vez de reintroduzir uma copia.
const fonte = readFileSync("src/pages/admin/Representantes.tsx", "utf-8");

describe("Representantes: a comissao passa pela faixa compartilhada", () => {
  it("usa `percentualEmFaixa` e nao uma copia local", () => {
    expect(fonte, "sumiu o import da funcao compartilhada")
      .toContain('import { percentualEmFaixa } from "@/lib/percentual"');
    expect(fonte, "o campo de comissao voltou a nao limitar o valor")
      .toContain("comissao_percentual: faixaComissao(e.target.value)");
    // O IDIOMA FURADO NAO PODE VOLTAR. `parseFloat(v) || 0` deixa negativo passar,
    // e `min`/`max` no `<input>` so valida dentro de um `<form>` que faz submit —
    // este dialogo nao e `<form>`, entao os atributos ali sao decorativos.
    expect(fonte, "voltou o `parseFloat(...) || 0`, que nao pega negativo")
      .not.toMatch(/comissao_percentual: parseFloat\([^)]*\) \|\| 0/);
  });

  it("o campo continua anunciando a faixa que o B2BWave usa", () => {
    // Conferido ao vivo no B2BWave (do qual este sistema e clone): o campo de
    // comissao la e `min="0" max="100" step="0.1"`.
    expect(fonte).toContain('type="number" min="0" max="100" step="0.1"');
  });
});
