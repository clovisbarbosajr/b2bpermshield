import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node). Mesma nota dos outros testes de fonte.
import { readFileSync } from "node:fs";

// TESTE DE FIACAO: as guardas moram dentro de componentes de pagina, e importar o
// modulo arrastaria layout, router, contexto de auth e o cliente Supabase. O que
// da para afirmar sem montar a tela e a FORMA da leitura — que e o que uma
// reversao apaga. A regra de estoque em si e exercitada de verdade em
// `src/lib/stock.test.ts`.

const carrinho = readFileSync("src/pages/portal/Carrinho.tsx", "utf8");
const cart = readFileSync("src/contexts/CartContext.tsx", "utf8");

/** Fatia entre dois marcadores, exigindo que os DOIS existam e na ordem certa —
 *  fatia solta ja passou por construcao neste projeto mais de uma vez. */
function trecho(fonte: string, de: string, ate: string) {
  const i = fonte.indexOf(de);
  expect(i, `marcador inicial sumiu: ${de}`).toBeGreaterThan(-1);
  const f = fonte.indexOf(ate, i + de.length);
  expect(f, `marcador final sumiu depois do inicial: ${ate}`).toBeGreaterThan(i);
  return fonte.slice(i, f);
}

describe("Carrinho: o imposto na tela nao pode mentir", () => {
  // `tax_rules` NAO tem unique em (tax_class_id, tax_customer_group_id) e a tela
  // de Sales Tax insere sem checar. Duas regras para o mesmo par faziam o
  // `maybeSingle()` errar; o `error` era descartado e a cascata inteira caia num
  // `setTaxRate(0)` indistinguivel de "este cliente nao paga imposto". A tela
  // mostrava Sales Tax $0.00 e Gross Total = subtotal, enquanto o banco (que
  // resolve com LIMIT 1) cobrava o imposto de verdade.
  const cascata = trecho(carrinho, "const fetchTaxRate = async", "fetchTaxRate();");

  it("toda etapa da cascata olha o `error`", () => {
    for (const e of ["cliErr", "clsErr", "dgErr", "ruleErr", "rateErr"]) {
      expect(cascata, `a etapa ${e} voltou a descartar o erro`).toContain(`error: ${e}`);
      expect(cascata, `${e} e lido mas nao usado`).toContain(`if (${e})`);
    }
  });

  it("erro de leitura vira 'nao sei', nao 'zero'", () => {
    expect(cascata).toContain("const naoSei = () => { setTaxRate(0); setTaxOk(false); }");
    expect(cascata, "sem `semImposto` separado, some o caso legitimo de isencao")
      .toContain("const semImposto = () => { setTaxRate(0); setTaxOk(true); }");
  });

  it("a busca da regra casa com o que o BANCO faz", () => {
    // O trigger do banco usa LIMIT 1. Com regra duplicada, o cliente tem que ver
    // o mesmo numero que vai pagar — e `maybeSingle()` erra nesse caso.
    const regra = trecho(cascata, 'from("tax_rules")', "const taxRateId");
    expect(regra).toContain(".limit(1)");
    expect(regra, "maybeSingle erra com regra duplicada").not.toContain("maybeSingle");
  });

  it("com a taxa desconhecida, a tela para de afirmar um total", () => {
    expect(carrinho).toContain('{taxOk ? `$${salesTax.toFixed(2)}` : "—"}');
    expect(carrinho).toContain('{taxOk ? `$${grossTotal.toFixed(2)}` : "—"}');
    expect(carrinho).toContain("Sales tax could not be calculated");
  });
});

describe("Carrinho: leitura de variantes", () => {
  // `.in(...)` sem `.range()` para em 1000 linhas com `error: null`. Variante que
  // ficou fora do corte vira "Out of stock" numa linha que TEM estoque; e produto
  // cujas variantes todas ficaram fora deixa de acionar a guarda de
  // linha-sem-variante, que e a que impede a linha de chegar ao pedido com o
  // preco do produto-pai.
  it("as variantes do carrinho sao lidas paginadas", () => {
    const leitura = trecho(carrinho, "ids.length\n          ? fetchAllRows", ": Promise.resolve");
    expect(leitura).toContain("produto_variantes");
    expect(leitura, "paginar sem `.order` por coluna unica repete e perde linha")
      .toContain('.order("id", { ascending: true })');
    expect(leitura).toContain(".range(f, t)");
  });
});

describe("CartContext: quantidade nao e corrigida em silencio", () => {
  // `estoque_disponivel` e gravado no localStorage quando o item ENTRA no carrinho
  // e nada nunca o atualiza — nem o watcher de 10s (que escreve so em
  // `insufficientItems`), nem re-adicionar pelo catalogo. Carrinho parado por dias
  // com um piso de 2 unidades continuava valendo 2 depois do deposito repor 500:
  // o cliente digitava 100, o campo voltava para 2, sem toast e sem badge.
  const upd = trecho(cart, "const updateQuantity", "const updatePrice");

  it("`updateQuantity` nao clampa mais pelo estoque congelado", () => {
    expect(upd, "quem sabe o estoque de verdade e o checkCartStock, com dado fresco")
      .not.toContain("Math.min(pedido, i.estoque_disponivel)");
    expect(upd, "o minimo do produto continua valendo")
      .toContain("Math.max(i.quantidade_minima ?? 1, pedido)");
  });

  it("o `max` do campo vem do teto FRESCO, nao do congelado", () => {
    expect(carrinho, "`max={item.estoque_disponivel}` travava em estoque antigo")
      .not.toContain("max={item.estoque_disponivel}");
    expect(carrinho).toContain("max: insufficientItems.get(cartKey(item))");
  });
});
