import { describe, it, expect } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do Node
// nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o
// modulo existe (vitest roda em Node). Se um dia `"node"` entrar naquele `types`,
// este comentario passa a reprovar como diretiva sem uso — a correcao e apagar
// estas tres linhas.
// @ts-expect-error
import { readFileSync } from "node:fs";

// TESTE DE FIACAO, pelo mesmo motivo declarado em `gravarProdutoComToken.test.ts`:
// apagar a guarda deixava a suite inteira verde, e guarda contra perda silenciosa
// que morre em silencio nao e guarda. Aqui ela mora DENTRO de um componente de
// pagina — importar o modulo arrastaria layout, router, contexto de auth e o
// cliente Supabase — entao o que da para afirmar sem montar a tela e a forma da
// query, que e exatamente o que a mutacao perigosa apaga.
//
// O QUE ELE PROTEGE: as duas telas gravam `estoque_total` com valor ABSOLUTO (a
// quantidade CONTADA, nao um delta). Elas releem o estoque antes de gravar, mas a
// releitura so ESTREITA a janela: entre o SELECT e o UPDATE cabe a baixa de um
// pedido concluido, e o update absoluto a desfazia em silencio — o estoque voltava
// ao numero que o admin tinha na tela. Quem fecha a janela e o filtro pelo valor
// lido, no MESMO statement do update.
//
// Se um dia a tela passar a pedir um DELTA, o certo deixa de ser o filtro e passa a
// ser `estoque_total = estoque_total + N`; ai este teste muda junto, de proposito.

const ler = (arquivo: string) =>
  readFileSync(new URL(arquivo, import.meta.url), "utf8");

/** O statement de gravacao do estoque, do `.update(` ate o fim da cadeia. */
const statementDeUpdate = (fonte: string) => {
  const m = fonte.match(/\.update\(\{\s*estoque_total[\s\S]*?maybeSingle\(\)/);
  expect(m, "nao achei o update de estoque_total encadeado ate maybeSingle()").toBeTruthy();
  return m![0];
};

describe("ajuste de estoque grava condicionado ao valor que leu", () => {
  for (const arquivo of ["./InventoryAdjustment.tsx", "./Estoque.tsx"]) {
    it(`${arquivo}: filtra por id E por estoque_total no MESMO statement`, () => {
      const stmt = statementDeUpdate(ler(arquivo));
      expect(stmt).toMatch(/\.eq\("id",/);
      // Este e o assert que morre se o bloqueio for removido.
      expect(stmt).toMatch(/\.eq\("estoque_total",/);
      // Sem `.select()` o PostgREST nao devolve linha, e zero-linhas fica
      // indistinguivel de sucesso.
      expect(stmt).toMatch(/\.select\(/);
    });

    it(`${arquivo}: trata zero linhas afetadas em vez de seguir como sucesso`, () => {
      expect(ler(arquivo)).toMatch(/if \(!gravado\)/);
    });
  }
});
