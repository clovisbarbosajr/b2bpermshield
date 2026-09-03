import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

// A CLASSE INTEIRA: "escrita que nao confirma linha afetada" nas telas de
// importacao.
//
// UPDATE e DELETE nao sao RECUSADOS por RLS — sao FILTRADOS. A linha que o
// `USING` da policy esconde simplesmente nao casa, o PostgREST devolve
// `error: null` com zero linha, e a tela comemora. O mesmo desfecho vem de
// concorrencia banal: todo importador daqui monta um SNAPSHOT (mapa de SKU, de
// e-mail, de categoria) ANTES do laco e escreve pelo id que leu — outro admin
// apagando a linha no meio produz exatamente o mesmo `error: null` com zero
// linha.
//
// O estrago nao e cosmetico. "Updated" sobre escrita que nao houve faz o
// operador fechar a tela; e em `ImportCustomers` e pior, porque o e-mail
// continua no snapshot: reimportar o arquivo NAO cria o cliente, ele nunca entra,
// e toda execucao diz que atualizou.
//
// Cada guarda depende de DUAS coisas, e o teste prende as duas: o `.select(...)`
// na cadeia (sem ele o PostgREST devolve `data: null` e a guarda dispara em TODA
// linha, invertendo o defeito) e a CONSEQUENCIA — a linha do relatorio virando
// `error`. Prender so a chamada de `nadaFoiEscrito` deixa passar o mutante que
// mantem a chamada e devolve "ok" mesmo assim.

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

/** Sem comentario — senao o texto que EXPLICA o defeito antigo casa como se fosse
 *  codigo. */
const soCodigo = (fonte: string) =>
  fonte.split("\n").filter((l: string) => !l.trim().startsWith("//")).join("\n");

/** Toda guarda desta classe termina a linha do relatorio como ERRO. */
const exigeConsequenciaDeErro = (guarda: string, ondeEsta: string) => {
  expect(guarda, `${ondeEsta}: a guarda nao empurra linha nenhuma para o relatorio`)
    .toMatch(/res\.push\(/);
  expect(guarda, `${ondeEsta}: a guarda existe mas a linha sai como sucesso`)
    .toMatch(/status: "error"/);
  expect(guarda, `${ondeEsta}: a guarda ainda anuncia escrita`)
    .not.toMatch(/"(Updated|Created|Inserted)"/);
  // E NAO nomeia a causa. Zero linha tem DUAS causas — RLS filtrando a escrita e
  // a linha ter sumido por concorrencia — e o codigo nao sabe qual foi. A
  // primeira versao da mensagem de `BulkUpdateOrders` dizia "could not be changed
  // by you", e ali a causa citada e a menos provavel das duas: a tela e
  // `requiredRole="admin"` e admin tem `FOR ALL` em `pedidos`
  // (20260317043654:211), entao RLS exigiria perder o papel no meio do lote.
  // Mandar conferir permissao quando o dado sumiu manda investigar a coisa
  // errada. Fica no helper, e nao num teste so, porque a tentacao de explicar a
  // causa aparece igual nas seis telas.
  expect(guarda, `${ondeEsta}: a mensagem afirma uma causa que o codigo nao sabe`)
    .not.toMatch(/by you|not allowed|permission/i);
};

describe("importadores nao anunciam escrita que nao aconteceu", () => {
  it("ImportCategories confirma a linha do UPDATE de categoria", () => {
    const f = soCodigo(ler("./ImportCategories.tsx"));
    // `maybeSingle()` devolve OBJETO ou `null`, nao array — por isso o helper
    // precisa tratar as duas formas.
    expect(f).toMatch(/\.update\(campos\)\.eq\("id", existenteId\)\.select\("id"\)\.maybeSingle\(\)/);
    const guarda = fatiaEntre(f, "} else if (existenteId && nadaFoiEscrito(gravada, error)) {", "} else {", 8);
    exigeConsequenciaDeErro(guarda, "ImportCategories");
  });

  it("ImportCustomerPrices confirma a linha do UPDATE de preco", () => {
    const f = soCodigo(ler("./ImportCustomerPrices.tsx"));
    expect(f).toMatch(/\.update\(\{ preco \}\)\.eq\("id", existentes\[0\]\.id\)\.select\("id"\)/);
    const guarda = fatiaEntre(f, "} else if (jaTinha && nadaFoiEscrito(gravada, error)) {", "} else {", 8);
    exigeConsequenciaDeErro(guarda, "ImportCustomerPrices");
  });

  it("ImportCustomers confirma a linha do UPDATE por e-mail", () => {
    const f = soCodigo(ler("./ImportCustomers.tsx"));
    // Pelo `id`, nao por `.ilike("email", ...)`: o filtro textual divergia da
    // chave que decide `isExisting` (ela normaliza com `trim()`, `ilike` nao), e
    // ficha com espaco sobrando casava ZERO linhas — a tela dizia "no longer
    // there" sobre cliente que esta la, e como o ramo e UPDATE ele nunca era
    // criado. Escrever por `id` mata a divergencia; escrever por texto a traz de
    // volta.
    expect(f, "voltou a escrever por filtro de texto").not.toMatch(/\.ilike\("email"/);
    expect(f).toMatch(/\.eq\("id", idPorEmail\.get\(emailLc\)!\)\.select\("id"\)/);
    expect(f, "a flag tem que sair do resultado REAL da escrita")
      .toMatch(/recusaSilenciosa = nadaFoiEscrito\(r2\.data, r2\.error\)/);
    const guarda = fatiaEntre(f, "} else if (recusaSilenciosa) {", "} else {", 8);
    exigeConsequenciaDeErro(guarda, "ImportCustomers");
  });

  it("ImportProductVariants confirma a linha do UPDATE de variante", () => {
    const f = soCodigo(ler("./ImportProductVariants.tsx"));
    expect(f).toMatch(/\}\)\.eq\("id", jaExiste\)\.select\("id"\)/);
    expect(f, "a flag tem que sair do resultado REAL da escrita")
      .toMatch(/recusaSilenciosa = nadaFoiEscrito\(r2\.data, r2\.error\)/);
    const guarda = fatiaEntre(f, "} else if (recusaSilenciosa) {", "} else {", 8);
    exigeConsequenciaDeErro(guarda, "ImportProductVariants");
  });

  it("ImportCustomers RECUSA e-mail repetido na base antes de escrever", () => {
    // A outra metade da mesma classe: `clientes` nao tem UNIQUE em `email`
    // (20260331183125:21 e a unica UNIQUE da tabela, em `user_id`), e a duplicata
    // ja aconteceu em producao (`b2bwave-sync/index.ts:57`). O UPDATE usa
    // `.ilike("email", ...)`, e filtro do PostgREST NAO tem LIMIT: com duas
    // fichas no mesmo e-mail o UPDATE casa AS DUAS e sobrescreve nome, empresa,
    // telefone e endereco das duas com a MESMA linha do CSV — uma linha "Updated"
    // verde e o cadastro do outro cliente perdido.
    //
    // Tem que ser PRE-VOO. Conferir `data.length > 1` DEPOIS do UPDATE reportaria
    // erro sobre estrago ja consumado — por isso o assert exige o `continue`
    // antes da escrita, e nao so a existencia da mensagem.
    const f = soCodigo(ler("./ImportCustomers.tsx"));
    expect(f, "a ambiguidade tem que sair da MESMA leitura que monta o snapshot")
      .toMatch(/if \(idPorEmail\.has\(k\) && idPorEmail\.get\(k\) !== c\.id\) emailAmbiguo\.add\(k\)/);
    const recusa = fatiaEntre(f, "if (emailAmbiguo.has(emailLc)) {", "const isExisting", 10);
    expect(recusa).toMatch(/status: "error"/);
    expect(recusa, "recusa sem `continue` cai no UPDATE assim mesmo").toMatch(/continue;/);
    // A recusa vem ANTES da escrita, nao depois.
    expect(f.indexOf("if (emailAmbiguo.has(emailLc)) {"))
      .toBeLessThan(f.indexOf('.update(payload)'));
    // UM mapa so decide "ja existe" e "qual id". Dois conjuntos paralelos
    // dessincronizam: com `existingEmails` separado, a SEGUNDA linha do mesmo CSV
    // com o mesmo e-mail entrava no ramo de UPDATE com id `undefined`.
    expect(f, "o INSERT nao registra o id da ficha que acabou de criar")
      .toMatch(/if \(!error && novoId\) idPorEmail\.set\(emailLc, novoId\)/);
    expect(f).toMatch(/const isExisting = idPorEmail\.has\(emailLc\)/);
    // Sem `.select("id")` no INSERT, `novoId` e sempre `undefined`, o `set` nunca
    // roda e a SEGUNDA linha do mesmo CSV volta a INSERIR — duplicata de cliente,
    // que e o defeito que este bloco inteiro existe para evitar. Prender so o
    // `if (novoId)` deixa isso passar: o mutante que remove o `.select` mantem a
    // linha do `set` intacta.
    expect(f, "o INSERT nao pede o id de volta — `novoId` sempre undefined")
      .toMatch(/\.insert\(payload\)\.select\("id"\)/);
    // E a chave normaliza ESPACO, nao so caixa. `b2bwave-sync` grava e-mail sem
    // trim, entao a base tem ` john@x.com`; sem o `trim()` aqui essa ficha nao
    // casa com `john@x.com` do CSV, `isExisting` da false e a tela cria a
    // duplicata — o item 3 dos tres defeitos de dedupe que o comentario do
    // arquivo lista como ja tendo acontecido.
    expect(f, "a chave do snapshot perdeu a normalizacao de espaco")
      .toMatch(/const k = String\(c\.email\)\.trim\(\)\.toLowerCase\(\)/);
  });

  // TESTES REMOVIDOS em 02/set/2026 junto com as telas que eles protegiam:
  // `BulkUpdateOrders.tsx` e `ImportOrders.tsx` foram apagadas quando o cliente
  // decidiu que o sistema nasce com ZERO pedidos e sem sync do B2BWave.
  // Ver `docs/DESLIGAR-SYNC-B2BWAVE.md`.
});
