import { describe, it, expect } from "vitest";
// Mesma nota de `conteudoErroDeLeitura.test.ts`: `tsconfig.app.json` declara
// `"types": ["vitest/globals"]`, entao os tipos do Node nao entram e o
// `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o modulo existe.
// @ts-expect-error
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

// TESTE DE FIACAO das quatro telas que viram DINHEIRO na fatura. Montar a tela
// exigiria `@testing-library/dom`, que nao esta instalado.
//
// Cada `it` abaixo corresponde a um defeito que ESTAVA no arquivo.

const ler = (arquivo: string) =>
  readFileSync(new URL(arquivo, import.meta.url), "utf8");

describe("telas de dinheiro: leitura que falha nao vira 'nao existe nada'", () => {
  const telas = [
    { arquivo: "./Coupons.tsx", tabela: "coupons" },
    { arquivo: "./PaymentOptions.tsx", tabela: "payment_options" },
  ];
  for (const { arquivo, tabela } of telas) {
    it(`${arquivo}: le o error do select de ${tabela}`, () => {
      const fonte = ler(arquivo);
      const select = fonte.match(
        new RegExp(`const \\{[^}]*\\} = await supabase\\.from\\("${tabela}"\\)\\.select\\([^;]*;`),
      );
      expect(select, `nao achei o select de ${tabela}`).toBeTruthy();
      expect(select![0]).toMatch(/const \{ data, error \}/);
      expect(fonte).toMatch(/if \(error\) toast\.error\(/);
    });
  }

  // Estes dois fazem `Promise.all`, entao o erro nao sai desestruturado.
  it("ShippingOptions.tsx: o Promise.all consolida os dois erros", () => {
    const fonte = ler("./ShippingOptions.tsx");
    expect(fonte).toMatch(/const erro = s\.error \?\? t\.error;/);
    expect(fonte).toMatch(/if \(erro\) toast\.error\(/);
  });

  it("SalesTax.tsx: o Promise.all consolida os quatro erros", () => {
    const fonte = ler("./SalesTax.tsx");
    expect(fonte).toMatch(/const erro = c\.error \?\? g\.error \?\? r\.error \?\? ru\.error;/);
    expect(fonte, "o erro consolidado deixou de virar toast").toMatch(/toast\.error\("Could not load the tax settings: " \+ erro\.message\)/);
    // E TEM QUE PARAR ALI. A versao anterior toastava e SEGUIA para os
    // `setX(... ?? [])`: lista vazia sob um toast de 6 s ainda e lista vazia, e os
    // dialogos gravam a partir dela — com `classes` vazio, "New Sales Tax rate"
    // manda `tax_class_id: ""` e leva 22P02 cru (a coluna e uuid NOT NULL —
    // nao grava, mas a mensagem que o admin ve e do Postgres).
    expect(fonte, "a falha de leitura voltou a seguir para o preenchimento das listas")
      .toMatch(/setClasses\(\[\]\); setGroups\(\[\]\); setRates\(\[\]\); setRules\(\[\]\);[\s\S]{0,60}?return;/);
    // E o banner tem que existir e ser desenhado: toast some em 6 s, a tela nao.
    expect(fonte, "o erro de leitura nao alimenta o loadError").toMatch(/setLoadError\(erro \?/);
    expect(fonte, "o loadError do SalesTax nao e renderizado").toMatch(/\{loadError/);
  });
});

describe("Coupons: codigo gravado tem que casar com cupom_por_codigo", () => {
  // A funcao do banco (20260826050000) casa com
  //   upper(c.codigo) = upper(trim(_codigo))
  // — o `trim` vale so pro que o CLIENTE digita. Codigo gravado com espaco
  // ("SAVE10 ", colado de uma planilha) nunca casa: cupom nasce morto e nada na
  // tela indica isso.
  const casa = (gravado: string, digitado: string) =>
    gravado.toUpperCase() === digitado.trim().toUpperCase();

  it("a regra do banco realmente rejeita o codigo com espaco (o defeito)", () => {
    expect(casa("SAVE10 ", "SAVE10")).toBe(false);
    expect(casa("SAVE10", "SAVE10")).toBe(true);
    expect(casa("SAVE10", " save10 ")).toBe(true);
  });

  it("a tela grava o codigo aparado, e recusa codigo vazio", () => {
    const fonte = ler("./Coupons.tsx");
    expect(fonte).toMatch(/const codigo = form\.codigo\.trim\(\);/);
    expect(fonte).toMatch(/if \(!codigo\) \{ toast\.error\(/);
    // O `...form` continua no payload; sem o `codigo,` depois dele o spread
    // vence e o valor com espaco volta a ser gravado.
    const payload = fonte.match(/const payload = \{ \.\.\.form,[^\n]*/);
    expect(payload, "nao achei o payload").toBeTruthy();
    expect(payload![0]).toMatch(/\{ \.\.\.form, codigo,/);
  });
});

describe("ShippingOptions: `padrao` so e escrito por setDefault", () => {
  // `padrao` morava no form. `openEdit` tirava uma FOTO do valor; clicar
  // "Set default" gravava true no banco mas nao mexia na foto; o "Save"
  // seguinte mandava `padrao: false` de volta e o padrao sumia, com "Updated"
  // na tela. Com dois admins, a foto velha ressuscitava um SEGUNDO padrao.
  const fonte = ler("./ShippingOptions.tsx");

  it("o form nao carrega mais `padrao`", () => {
    expect(fonte).not.toMatch(/^\s*padrao:/m);
  });

  it("o unico write de `padrao` esta dentro de setDefault", () => {
    const writes = fonte.match(/\.update\(\{ padrao: \w+ \}/g) ?? [];
    expect(writes).toHaveLength(2); // limpa todos, depois marca o escolhido
    const setDefault = fatiaEntre(
      fonte,
      "const setDefault",
      "const updateCondition",
    );
    expect((setDefault.match(/\.update\(\{ padrao: \w+ \}/g) ?? [])).toHaveLength(2);
  });

  it("o delete da lista le o error", () => {
    const del = fonte.match(/\n[^\n]*supabase\.from\("shipping_options"\)\.delete\(\)[^;]*;/);
    expect(del, "nao achei o delete").toBeTruthy();
    expect(del![0]).toMatch(/const \{ error \} = await/);
  });
});

describe("SalesTax: nao limpa o is_default dos outros sem id confirmado", () => {
  // `limparOutrosDefault(tabela, undefined)` cai no ramo SEM `neq` e tira o
  // `is_default` de TODAS as linhas. Zero classe padrao =
  // `tax_classes WHERE is_default LIMIT 1` vazio no trigger = imposto ZERO em
  // todo pedido seguinte, calado. Um `update` que nao casa linha nenhuma (outro
  // admin apagou a classe) volta `data: null, error: null` — era exatamente
  // esse caminho.
  const fonte = ler("./SalesTax.tsx");

  it("limparOutrosDefault sem `exceto` mesmo limpa todo mundo (o risco)", () => {
    // A guarda `if (exceto)` e o que faz o `neq` existir; sem id, nao existe.
    const fn = fatiaEntre(
      fonte,
      "const limparOutrosDefault",
      "const saveClass",
    );
    expect(fn).toMatch(/if \(exceto\) q = q\.neq\("id", exceto\)/);
  });

  for (const [save, next, tabela] of [
    ["const saveClass", "const saveGroup", "tax_classes"],
    ["const saveGroup", "const saveRate", "tax_customer_groups"],
  ] as const) {
    it(`${save}: a guarda de \`!data\` vem ANTES de limparOutrosDefault`, () => {
      const corpo = fatiaEntre(fonte, save, next);
      const guarda = corpo.indexOf("if (!data) {");
      // `await ...` e a CHAMADA; o nome sozinho tambem aparece nos comentarios.
      const limpa = corpo.indexOf("await limparOutrosDefault");
      expect(guarda, "nao achei a guarda de !data").toBeGreaterThan(-1);
      expect(limpa, "nao achei a chamada de limparOutrosDefault").toBeGreaterThan(-1);
      expect(guarda).toBeLessThan(limpa);
      // E o id passado tem que ser o CONFIRMADO pelo banco, nao o da tela.
      expect(corpo).toContain(`limparOutrosDefault("${tabela}", data.id)`);
      expect(corpo).not.toMatch(/limparOutrosDefault\([^)]*\?\?/);
    });
  }
});

describe("PaymentOptions nao guarda mais segredo de gateway", () => {
  // ANTES: este describe protegia o `secretInput` — treze campos de credencial
  // (Secret Key da Stripe, Access Token do Square, API Password e Signature do
  // PayPal, Transaction Key do Authorize.Net, API Key do Sola e do Paynote), e a
  // guarda cuidava de um bug de FOCO: declarado como componente dentro do render,
  // o input remontava a cada tecla e a chave so entrava colada.
  //
  // Em 02/set/2026 os treze SAIRAM (decisao da Jessika, SEG 1). O bug de foco
  // deixou de existir junto com os campos, entao a guarda dele nao tem mais o que
  // proteger — e a guarda que importa agora e a OPOSTA: que nao volte segredo
  // para uma tabela que qualquer cliente logado le.
  const fonte = ler("./PaymentOptions.tsx");
  const soCodigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("nenhum campo de credencial voltou para a tela", () => {
    // A RLS de `payment_options` e por LINHA e a policy libera SELECT para todo
    // `authenticated`: o que entrar em `gateway_config` sai pelo console do
    // navegador de qualquer cliente.
    for (const chave of [
      "secret_key", "api_password", "api_signature", "access_token",
      "transaction_key", "api_key", "merchant_id", "publishable_key",
      "api_login", "api_login_id", "application_id",
    ]) {
      expect(soCodigo, `voltou um campo gravando \`${chave}\` em gateway_config`)
        .not.toMatch(new RegExp(`updateConfig\\("${chave}"`));
    }
    expect(soCodigo, "voltou o helper de campo secreto").not.toMatch(/secretInput/);
    expect(soCodigo, "voltou input de senha nesta tela").not.toMatch(/type="password"/);
  });

  it("a tela DIZ onde a credencial deve ficar, em vez de so sumir com o campo", () => {
    // Campo que some sem explicacao vira chamado de suporte, e a proxima pessoa
    // recoloca. O texto e a parte que impede a volta.
    expect(fonte).toMatch(/not stored here/i);
  });
});
