import { describe, it, expect } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do Node
// nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o
// modulo existe (vitest roda em Node).
// @ts-expect-error
import { readFileSync } from "node:fs";

// TESTE DE FIACAO, no mesmo formato de `estoqueUpdateCondicional.test.ts`: as
// guardas moram DENTRO de componentes de pagina, e importar o modulo arrastaria
// layout, router, contexto de auth e o cliente Supabase. O que da para afirmar
// sem montar a tela e a forma da gravacao — que e exatamente o que uma reversao
// apaga.
//
// O QUE ELE PROTEGE — tres defeitos que deixavam a ferramenta MUDA e ERRADA:
//
//  1. `ImportCustomerPrices` fazia `.upsert(..., { onConflict:
//     "cliente_id,produto_id" })`, mas `produto_precos_cliente` so tem a PK em
//     `id` (20260318202244:71-78). Sem o indice, o Postgres recusa TODA linha com
//     42P10: a importacao de precos NUNCA gravou nada.
//  2. `ImportCustomers` nao gravava `user_id`, que e NOT NULL sem DEFAULT
//     (20260317043654:68) — todo INSERT morria com 23502, e o `payload: any`
//     escondia a coluna faltando do `tsc`.
//  3. `ImportCustomerPrices` validava preco com `parseFloat`, que aceita
//     "1,234.56" e devolve 1. Preco errado cobrado com "ok" verde na tela.
//
// Se um dia nascer o UNIQUE (cliente_id, produto_id), o `upsert` volta a ser o
// certo e o item 1 deste teste muda junto, de proposito.

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

/** Sem as linhas de comentario — senao o proprio comentario que EXPLICA o defeito
 *  antigo faz o teste achar que o defeito continua la. */
const soCodigo = (fonte: string) =>
  fonte.split("\n").filter((l: string) => !l.trim().startsWith("//")).join("\n");

describe("importadores gravam de verdade", () => {
  it("ImportCustomerPrices nao usa ON CONFLICT em indice que nao existe", () => {
    const fonte = ler("./ImportCustomerPrices.tsx");
    expect(soCodigo(fonte)).not.toMatch(/onConflict/);
    // Procura antes de gravar, e grava pelo id que leu.
    expect(fonte).toMatch(/from\("produto_precos_cliente"\)\s*\.select\("id"\)/);
    expect(fonte).toMatch(/\.update\(\{ preco \}\)\.eq\("id", existentes\[0\]\.id\)/);
    expect(fonte).toMatch(/\.insert\(\{ cliente_id: clienteId, produto_id: produtoId, preco \}\)/);
  });

  it("ImportCustomerPrices recusa preco que o parseFloat truncaria", () => {
    const fonte = ler("./ImportCustomerPrices.tsx");
    const m = fonte.match(/if \(!(\/\^.*?\/)\.test\(precoBruto\)\)/);
    expect(m, "nao achei a validacao de precoBruto").toBeTruthy();
    // eslint-disable-next-line no-eval
    const re: RegExp = eval(m![1]);
    for (const bom of ["0", "89.90", "1234.56", "7"]) expect(re.test(bom), bom).toBe(true);
    for (const ruim of ["1,234.56", "89,90", "12abc", "$89.90", "", "-5", "1e3", " "]) {
      expect(re.test(ruim), ruim).toBe(false);
    }
  });

  it("ImportCustomers grava o user_id que a coluna NOT NULL exige", () => {
    const fonte = ler("./ImportCustomers.tsx");
    expect(fonte).toMatch(/payload\.user_id = crypto\.randomUUID\(\)/);
  });

  it("as leituras que decidem criar-ou-atualizar leem o error", () => {
    // Leitura solta cujo `error` some vira criacao duplicada com "Created" na tela.
    for (const arquivo of ["./ImportCategories.tsx", "./ImportCustomerPrices.tsx", "./ImportCustomers.tsx"]) {
      const fonte = ler(arquivo);
      const soltas = fonte.match(/const \{ data: \w+ \} = await supabase/g) ?? [];
      expect(soltas, `${arquivo}: leitura com error descartado`).toEqual([]);
    }
  });
});
