import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

/**
 * VENDA 2, segunda metade — decisao da Jessika em 03/set:
 *
 *   "O negativo pode mostrar apenas no administrativo, o cliente pode ver so
 *    como pre order."
 *
 * NADA precisou ser implementado: o comportamento ja era esse. Estas guardas
 * existem para que continue sendo — sao a unica coisa entre a decisao dela e um
 * `Math.max(0, ...)` bem-intencionado no admin, ou um "Available: -37" na cara
 * do cliente.
 *
 * Como o negativo aparece: o gatilho `fn_reserve_stock_on_order_item`
 * (20260618234500) ISENTA pre-venda da reserva condicional — soma
 * `estoque_reservado` sem exigir saldo. Entao `estoque_total - estoque_reservado`
 * fica negativo sozinho, sem nenhuma coluna negativa no banco.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const soCodigo = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("o ADMIN ve o negativo", () => {
  const estoque = soCodigo(ler("src/pages/admin/Estoque.tsx"));

  it("`disponivel` nao tem piso em zero", () => {
    // `Math.max(0, total - reservado)` esconderia exatamente o numero que ela
    // pediu para ver. A subtracao crua e a feature.
    expect(estoque, "o calculo de disponivel sumiu da tela de estoque")
      .toMatch(/const disponivel = \(p: any\) => p\.estoque_total - p\.estoque_reservado;/);
  });

  it("a coluna Available imprime o valor, sem clamp", () => {
    const celula = fatiaEntre(estoque, "<Badge variant={disponivel(p)", "</TableCell>", 4);
    expect(celula, "o valor deixou de ser impresso").toMatch(/\{disponivel\(p\)\}/);
    expect(celula, "apareceu um piso em zero — o negativo do backorder some")
      .not.toMatch(/Math\.max/);
  });
});

describe("o CLIENTE nunca ve o numero em pre-order", () => {
  /**
   * Devolve SO o que roda quando o produto e pre-order: o trecho entre o `?` e o
   * `:` do ternario.
   *
   * Recortar o ternario inteiro nao serve — o ramo do "senao" imprime a
   * quantidade DE PROPOSITO, e casaria com qualquer assert sobre o bloco todo.
   *
   * A ancora e a LINHA do rotulo, e nao o texto que abre o ternario: esse
   * aparece antes, no `className` do Badge, e o `indexOf` pegava a ocorrencia
   * errada — o recorte saia com 70 linhas em vez de uma.
   */
  function ramoPreOrder(fonte: string, rotulo: string): string {
    // A linha tem que ter o rotulo E o `?`: o Catalogo mostra "Pre-order" tambem
    // num Badge, linhas acima, dentro de um condicional multilinha cujo `?` mora
    // na linha anterior — o `find` pelo rotulo sozinho pegava esse Badge.
    const linha = soCodigo(fonte).split("\n")
      .find((l) => l.includes(rotulo) && l.includes("?"));
    expect(linha, `sumiu a linha de ternario que mostra "${rotulo}"`).toBeTruthy();
    const i = linha!.indexOf("?");
    // Ternario numa linha so (`ProdutoDetalhe`): o ramo vai ate o `:`. Ternario
    // quebrado em linhas (`Catalogo`): a linha do `?` E o ramo inteiro, e o `:`
    // mora na linha seguinte.
    const j = linha!.indexOf(":", i);
    return linha!.slice(i + 1, j > i ? j : undefined);
  }

  for (const [arq, rotulo] of [
    ["src/pages/portal/Catalogo.tsx", "Pre-order"],
    ["src/pages/portal/ProdutoDetalhe.tsx", "BACK ORDER"],
  ] as const) {
    it(`${arq.split("/").pop()}: pre-order mostra rotulo, nao quantidade`, () => {
      const ramo = ramoPreOrder(ler(arq), rotulo);

      expect(ramo, "o ramo de pre-order perdeu o rotulo").toContain(rotulo);

      // A CONSEQUENCIA: o ramo nao cita a quantidade de forma nenhuma.
      //
      // A versao anterior proibia so a forma de template literal, e dois
      // mutantes passaram por baixo: um imprimindo a quantidade em JSX (sem
      // cifrao) e outro trocando a string do rotulo por uma crase com
      // interpolacao. Proibir o IDENTIFICADOR fecha as duas e qualquer terceira.
      expect(ramo, "o ramo de pre-order voltou a imprimir a quantidade")
        .not.toMatch(/\b(disponivel|effectiveDisponivel)\b/);
    });
  }

  it("Catalogo: o numero so aparece no ramo de quem NAO e pre-order", () => {
    // O ternario inteiro, para provar a ORDEM: pre-order -> rotulo; senao,
    // disponivel > 0 -> numero; senao, Sold Out. Invertida, o ramo do numero
    // casa antes e o negativo vaza.
    const bloco = fatiaEntre(soCodigo(ler("src/pages/portal/Catalogo.tsx")),
      "{isPreOrder(p)", "</p>", 10);
    const iPre = bloco.indexOf("Pre-order");
    const iNum = bloco.indexOf("Available:");
    expect(iPre, "sumiu o rotulo de pre-order").toBeGreaterThan(-1);
    expect(iNum, "sumiu a quantidade para quem nao e pre-order").toBeGreaterThan(-1);
    expect(iPre, "o numero passou na frente do rotulo — pre-order voltaria a mostrar negativo")
      .toBeLessThan(iNum);
  });

  it("o carrinho nao promete saldo para pre-order", () => {
    // `checkCartStock` isenta pre-order do piso de estoque; se o carrinho
    // passasse o `disponivel` real como teto, o campo travaria num negativo e o
    // cliente nao conseguiria aumentar a quantidade.
    const cat = soCodigo(ler("src/pages/portal/Catalogo.tsx"));
    expect(cat, "o teto do carrinho parou de isentar pre-order")
      .toMatch(/preOrder \? 999999 : disponivel\(p\)/);
  });
});

describe("a trava de nome dos status de fabrica", () => {
  // DADO 3. Ela pediu travar a EDICAO e deixar o DELETE livre, ciente do risco:
  // apagar tem o mesmo efeito que renomear. A migration protege metade da porta
  // DE PROPOSITO — e o delete deixa rastro, para o dia em que um produto voltar
  // sozinho para a vitrine.
  const sql = ler("supabase/migrations/20260904120000_trava_nome_status_fabrica.sql")
    .replace(/^\s*--.*$/gm, "");

  it("recusa renomear, e so quando o nome muda", () => {
    expect(sql, "o gatilho de UPDATE sumiu")
      .toMatch(/BEFORE UPDATE ON public\.product_statuses/);
    // A comparacao tem que ser sobre o NOME. Um gatilho que recuse todo UPDATE
    // travaria tambem cor e ordem, que ela nao pediu para travar.
    expect(sql, "o gatilho recusa qualquer UPDATE, nao so a troca de nome")
      .toMatch(/lower\(btrim\(NEW\.nome\)\) IS DISTINCT FROM lower\(btrim\(OLD\.nome\)\)/);
    expect(sql, "a recusa nao lanca").toMatch(/RAISE EXCEPTION 'STATUS_FABRICA_NOME_TRAVADO'/);
  });

  it("nomeia os seis de fabrica", () => {
    for (const s of ["available", "limited stock", "sold out",
                     "pre-order", "not available", "discontinued"]) {
      expect(sql, `o status de fabrica "${s}" saiu da lista`).toContain(`'${s}'`);
    }
  });

  it("NAO bloqueia o DELETE — decisao dela — mas registra", () => {
    // Se um dia isto virar bloqueio, foi alguem "consertando" contra a decisao.
    //
    // Procura dentro do CORPO da funcao do delete, e nao depois do
    // `CREATE TRIGGER`: a funcao e declarada ANTES do trigger, entao um
    // `RAISE EXCEPTION` plantado nela ficava fora da janela e sobrevivia.
    const corpoDelete = fatiaEntre(
      sql, "FUNCTION public.fn_status_apagado_deixa_rastro()", "RETURN OLD;", 45);
    expect(corpoDelete, "o DELETE foi bloqueado; ela pediu explicitamente para deixar livre")
      .not.toMatch(/RAISE EXCEPTION/);
    expect(sql, "o rastro do delete sumiu")
      .toMatch(/BEFORE DELETE ON public\.product_statuses/);
    // O numero de produtos orfaos e o que mede o estrago. Sem ele o log diz que
    // alguem apagou algo, e nao o que isso causou.
    expect(sql, "o rastro nao conta os produtos que ficaram orfaos")
      .toMatch(/produtos_que_ficaram_com_status_orfao/);
  });
});
