import { describe, it, expect } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do Node
// nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o
// modulo existe. Mesma nota de `importadoresLoteGuardas.test.ts`.
// @ts-expect-error
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

// Contratos da leva de 30/ago sobre as telas que ainda nao tinham teste nenhum.
//
// TESTE DE FIACAO, pelo mesmo motivo dos vizinhos: as guardas moram DENTRO de
// componentes de pagina e importar o modulo arrastaria layout, router, contexto de
// auth e o cliente Supabase. Cada assert corresponde a um defeito que ESTAVA no
// arquivo, e cada um foi verificado plantando o defeito de volta — mutante que nao
// morre nao vira assert.
const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");
// Codigo sem comentario: um assert que casa com o texto do comentario que EXPLICA
// o defeito passaria verde com a correcao revertida.
const semComentario = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("importacao em massa: default de CRIAR nao vaza para o ATUALIZAR", () => {
  it("ImportProductVariants: o UPDATE so escreve `quantidade` se o arquivo trouxe `stock`", () => {
    const f = semComentario(ler("./admin/tools/ImportProductVariants.tsx"));
    // O defeito: um unico objeto `dados` com `quantidade: stock` servindo insert E
    // update. Arquivo so com `parent_sku,variant_sku` zerava o estoque de todas as
    // variantes tocadas, e `fn_reserve_stock_on_order_item` passava a recusar
    // pedido com INSUFFICIENT_STOCK — numero que nao volta, ninguem mais escreve.
    const update = fatiaEntre(f, ".update({", '.eq("id", jaExiste)', 10);
    expect(update, "o UPDATE voltou a gravar quantidade incondicionalmente").toMatch(/temStock \? \{ quantidade/);
    expect(update, "o UPDATE voltou a gravar valores_opcao incondicionalmente").toMatch(/temOpcao \? \{ valores_opcao/);
    // E o INSERT tem de MANTER o default — variante nova sem `stock` e 0 mesmo.
    const insert = fatiaEntre(f, ".insert({", '.select("id").single()', 10);
    expect(insert, "o INSERT perdeu o default de estoque").toMatch(/quantidade: stock/);
  });

  it("ImportProductVariants: SKU de pai repetido RECUSA a linha", () => {
    const f = semComentario(ler("./admin/tools/ImportProductVariants.tsx"));
    // A UNIQUE de `produtos.sku` caiu em `20260708140000`. O mapa ultimo-vence
    // mandava a variante e o estoque para a ficha sorteada pela paginacao, com
    // "Inserted" verde — e reimportar NAO corrigia: a segunda rodada achava "ja
    // existe" e atualizava a variante errada de novo.
    expect(f, "voltou a montar o mapa a mao, sem marcar SKU ambiguo").toMatch(/mapaSkuSemAmbiguidade\(produtos\)/);
    const guarda = fatiaEntre(f, "if (skuAmbiguo.has(parentSku))", "continue;", 6);
    expect(guarda, "a recusa por SKU de pai ambiguo sumiu").toMatch(/status: "error"/);
  });

  it("ImportCategories: o UPDATE nao reativa categoria nem apaga descricao", () => {
    const f = semComentario(ler("./admin/tools/ImportCategories.tsx"));
    // A condicao do ramo "nada a mudar", explicita: ele so pode valer com `campos`
    // VAZIO. Trocado por `>= 0` (ou pelo `existenteId` sozinho) ele engole TODO
    // update — nada mais e reordenado nem redescrito, e tudo sai "nothing to
    // change" em verde. O marcador do `fatiaEntre` abaixo mataria o segundo caso
    // por acidente; este assert mata os dois de proposito.
    expect(f, "o ramo 'nada a mudar' deixou de exigir payload vazio — engole todo UPDATE")
      .toMatch(/if \(existenteId && Object\.keys\(campos\)\.length === 0\)/);
    const campos = fatiaEntre(f, "const campos: any = {", "if (existenteId &&", 8);
    // `ativo: true` no payload compartilhado republicava na loja as categorias que
    // o proprio sistema desativa em massa (`20260320204242:34`), e `ativo` e o
    // filtro de visibilidade do catalogo (`20260701130000:56`).
    expect(campos, "`ativo: true` voltou para o payload que o UPDATE usa").not.toMatch(/ativo:\s*true/);
    // `descricao: ... || null` apagava a descricao do catalogo inteiro quando a
    // coluna nao vinha no arquivo.
    expect(campos, "descricao voltou a ser escrita mesmo sem vir no arquivo").toMatch(/temDescricao \? \{ descricao/);
    // `nome`/`parent_id` sao a CHAVE do match, nao dado a atualizar: com o match
    // agora case-insensitive, deixa-los no UPDATE RENOMEAVA a categoria para o
    // caixa da planilha, mudando o rotulo do menu da loja.
    expect(campos, "`nome` voltou para o UPDATE — o CSV renomeia a categoria").not.toMatch(/nome:\s*name/);
    expect(campos, "`parent_id` voltou para o UPDATE").not.toMatch(/parent_id:/);
    // O INSERT continua definindo tudo — categoria nova nasce completa e ativa.
    const insert = fatiaEntre(f, ".insert({ ...campos", '.select("id").maybeSingle()', 4);
    expect(insert, "categoria nova parou de nascer ativa").toMatch(/ativo:\s*true/);
    expect(insert, "o INSERT perdeu o nome").toMatch(/nome:\s*name/);
    expect(insert, "o INSERT perdeu o pai").toMatch(/parent_id:\s*categoriaPaiId/);
  });

  it("ImportCategories: nome de pai homonimo RECUSA a linha em vez de sortear", () => {
    const f = semComentario(ler("./admin/tools/ImportCategories.tsx"));
    // O proprio arquivo ja dizia que existem homonimas de proposito ("One Plus" em
    // 3 estados) e que "nome + pai identifica" — mas so a busca de EXISTENCIA
    // respeitava isso. A do PAI era ultimo-vence, e 40 subcategorias iam para a
    // categoria errada com "Created" verde.
    const guardaPai = fatiaEntre(f, "if (nomeAmbiguo.has(pn))", "continue;", 6);
    expect(guardaPai, "a recusa por nome de pai homonimo sumiu").toMatch(/status: "error"/);
    const guardaChave = fatiaEntre(f, "if (chaveAmbigua.has(chave))", "continue;", 6);
    expect(guardaChave, "a recusa por (nome,pai) ja duplicado sumiu").toMatch(/status: "error"/);
    // A leitura precisa trazer `parent_id`, senao a chave composta e mentira e o
    // mapa volta a ser "por nome" com outro nome.
    expect(f, "parou de ler parent_id — a chave (nome,pai) fica falsa").toMatch(/select\("id, nome, parent_id"\)/);
  });
});

describe("ImportAddresses: os obrigatorios sao obrigatorios", () => {
  const f = semComentario(ler("./admin/tools/ImportAddresses.tsx"));

  it("recusa a linha em vez de gravar string vazia num NOT NULL", () => {
    // `logradouro/cidade/estado/cep` sao NOT NULL (`20260317043654:83-89`) e string
    // VAZIA satisfaz NOT NULL: um cabecalho divergente (`address_line1`,
    // `postal_code` — o export do B2BWave sai assim) gravava 3.000 enderecos em
    // branco, a tela dizia "Imported 3000 of 3000" e o log registrava `success`.
    // TRIM ANTES DA CHECAGEM, nos quatro. Com `r["address"] || ""` a celula de
    // espacos passa por preenchida — a checagem de vazio le " " como valor — e o
    // endereco em branco entra do mesmo jeito, so que agora com um espaco dentro.
    // Planilha exportada e reimportada produz celula assim o tempo todo.
    for (const [campo, coluna] of [["logradouro", "address"], ["cidade", "city"], ["estado", "state"], ["cep", "zip"]]) {
      expect(f, `${campo} voltou a ser lido sem trim — celula de espacos passa por preenchida`)
        .toMatch(new RegExp(`const ${campo} = \\(r\\["${coluna}"\\] \\?\\? ""\\)\\.trim\\(\\)`));
    }
    const guarda = fatiaEntre(f, "if (faltando.length > 0)", "continue;", 6);
    expect(guarda, "sumiu a recusa por campo obrigatorio ausente").toMatch(/Missing required: \$\{faltando\.join/);
  });

  it("nao duplica endereco ja cadastrado — e nao confunde salas do mesmo predio", () => {
    // Era a UNICA das quatro telas de importacao sem deduplicacao. E o fluxo que
    // duplica e o normal: ver 40 "Customer not found", corrigir os 40 e-mails e
    // resubir o arquivo INTEIRO — a tela nao oferece "so os que falharam".
    expect(f, "sumiu a deduplicacao — resubir o arquivo duplica tudo").toMatch(/const existenteId = jaTem\.get\(chave\)/);
    // `complemento` TEM de entrar na chave: "123 Main St / Suite 100" e "Suite 200"
    // sao o mesmo predio com CEP igual e enderecos DIFERENTES — a forma normal de
    // conta B2B. Deduplicar demais perde dado legitimo E diz "ok".
    // Assert no CORPO da chave, nao na assinatura: um mutante que tira
    // `complemento` so da lista e mantem o parametro passava verde no assert que
    // olhava a assinatura. Foi o que aconteceu na primeira rodada de mutacao.
    const corpoDaChave = fatiaEntre(f, "const chaveEndereco = (", ".join(\"|\")", 4);
    expect(corpoDaChave, "`complemento` saiu da chave — salas do mesmo predio colidem")
      .toMatch(/\[clienteId, logradouro, complemento, cep\]/);
    expect(f, "a leitura parou de trazer `complemento`, entao a chave fica falsa")
      .toMatch(/select\("id, cliente_id, logradouro, complemento, cep"\)/);
  });

  it("`principal` novo desmarca o anterior — inclusive em endereco ja cadastrado", () => {
    // Sem isso o cliente ficava com dois principais, e `Checkout` pre-selecionava o
    // antigo em parte das visitas — pedido despachado para o endereco errado, sem
    // sinal nenhum no admin.
    expect(f, "parou de desmarcar o principal anterior")
      .toMatch(/update\(\{ principal: false \}\)\.eq\("cliente_id", clienteId\)\.neq\("id", idDesteEndereco\)/);
    // Os DOIS caminhos chamam a promocao — o de endereco novo tambem. Um mutante
    // que anula so a condicao do INSERT sobrevivia enquanto o assert olhava apenas
    // o corpo da funcao e o ramo do dedupe.
    expect(f, "endereco NOVO voltou a nao desmarcar o principal anterior")
      .toMatch(/if \(querPrincipal && criado\?\.id\) \{\s*const err = await promoveAPrincipal\(criado\.id\);/);
    // A falha do DESMARQUE tem de abortar. Sem isto, a primeira escrita falha, a
    // segunda marca o novo, e o cliente fica com DOIS principais — o estado que
    // esta correcao inteira existe para impedir — reportado como "ok". Mutante que
    // apagava esta linha sobrevivia a todos os outros asserts.
    expect(f, "a falha do desmarque voltou a ser ignorada").toMatch(/if \(limpaErr\) return limpaErr;/);
    // E a segunda escrita confirma a linha: `existenteId` vem de um snapshot lido
    // antes do laco, e o endereco pode ter sido apagado no meio (`portal/Conta.tsx`,
    // `admin/CustomerEdit.tsx`). Zero linhas volta `error: null` e a tela dizia
    // "set as primary" com o cliente ficando SEM principal nenhum.
    // A CONSEQUENCIA, nao so a chamada: trocar o corpo por `return null` deixa a
    // chamada no arquivo e reintroduz o defeito inteiro — a tela volta a dizer
    // "set as primary" com o cliente sem principal nenhum. Regex solto no arquivo
    // passava verde nesse mutante.
    const confirma = fatiaEntre(f, "if (nadaFoiEscrito(posto, poeErr))", "return null;", 4);
    expect(confirma, "a promocao voltou a nao confirmar a linha").toMatch(/no longer exists/);
    // A gemea do `limpaErr`, e o unico ponto da funcao que ficou sem rede numa
    // rodada anterior: sem ela, o desmarque commita, a marcacao falha com erro,
    // `nadaFoiEscrito` devolve `false` (e `!error && ...`) e a funcao volta `null` —
    // a tela diz "set as primary" com o cliente SEM principal nenhum.
    expect(f, "a falha da marcacao voltou a ser engolida").toMatch(/if \(poeErr\) return poeErr;/);
    // As duas mensagens de falha da promocao NAO podem afirmar estado: ha tres
    // saidas de erro e elas terminam em estados diferentes (principal antigo
    // intacto, dois principais, ou nenhum). Uma versao anterior dizia "this
    // customer now has NO primary address" e era falsa justamente no caminho do
    // desmarque, onde o UPDATE atomico nao mudou nada.
    expect((f.match(/primary flag was not applied cleanly — check this customer's primary address/g) ?? []).length,
      "mensagem de falha da promocao voltou a afirmar um estado que o codigo nao sabe").toBe(2);
    // O `.select("id")` e parte da guarda, nao enfeite: sem ele o PostgREST devolve
    // `data: null` e `nadaFoiEscrito` — que falha FECHADA de proposito — passa a
    // recusar TODA promocao. Barulhento, mas quebra o recurso inteiro.
    expect(f, "a promocao parou de pedir a linha de volta — a guarda recusa tudo")
      .toMatch(/\.update\(\{ principal: true \}\)\.eq\("id", idDesteEndereco\)\.select\("id"\)/);
    // O caminho que o dedupe criou: o admin ja tinha importado o endereco, corrige
    // a planilha para `is_primary=yes` e resobe. Sem isto a linha saia "ok" e o
    // `is_primary` era descartado em silencio — justamente o fluxo que a dedupe
    // existe para atender.
    // A CONDICAO, e nao so a chamada: um mutante que troca `if (querPrincipal)` por
    // `if (false)` deixa a chamada no arquivo e passaria verde num assert que so
    // procura `promoveAPrincipal(existenteId)`. Aconteceu na primeira rodada.
    const jaExiste = fatiaEntre(f, "if (existenteId) {", "not imported again", 22);
    expect(jaExiste, "endereco ja cadastrado voltou a descartar o `is_primary`")
      .toMatch(/if \(querPrincipal\) \{\s*const err = await promoveAPrincipal\(existenteId\);/);
  });
});

describe("area de drop travada durante a importacao, nas seis telas", () => {
  // So o `<Button>` interno estava `disabled` em tres delas: a moldura seguia
  // clicavel e aceitando drop, e dois lotes concorrentes liam "nao existe" para a
  // mesma chave e inseriam os dois. Em `ImportCustomerPrices` isso QUEBRA o preco
  // do cliente: `pricing.ts` usa `.maybeSingle()`, que com duas linhas devolve
  // PGRST116 e lanca.
  const TELAS = [
    "./admin/tools/ImportAddresses.tsx", "./admin/tools/ImportCategories.tsx",
    "./admin/tools/ImportCustomerPrices.tsx", "./admin/tools/ImportProductVariants.tsx",
  ];
  for (const t of TELAS) {
    it(`${t}: clique e drop recusados enquanto \`importing\``, () => {
      const f = semComentario(ler(t));
      expect(f, "o clique na moldura voltou a abrir o seletor durante a importacao")
        .toMatch(/if \(!importing\) inputRef\.current\?\.click\(\)/);
      expect(f, "a moldura voltou a aceitar drop durante a importacao")
        .toMatch(/onDrop=\{\(e\) => \{ e\.preventDefault\(\); if \(importing\) return;/);
    });
  }
});

describe("escrita que nao encontrou linha nao pode dizer que salvou", () => {
  it("UsersManagement: revogar acesso confirma a linha apagada", () => {
    const f = semComentario(ler("./admin/settings/UsersManagement.tsx"));
    // A policy de `user_roles` e admin-only, mas a ROTA e liberada por permissao de
    // staff (`view_users_management`): o `USING` FILTRA em vez de levantar, zero
    // linhas, `error: null` — e a tela dizia "Access removed" numa tela cujo unico
    // proposito e revogar acesso.
    expect(f, "o delete voltou a nao pedir a linha de volta")
      .toMatch(/\.delete\(\)\.eq\("user_id", u\.user_id\)\.select\("user_id"\)/);
    const guarda = fatiaEntre(f, "if (nadaFoiEscrito(data, error))", "return;", 6);
    expect(guarda, "sumiu a checagem de zero linhas").toMatch(/NOT removed/);
  });

  it("ShippingOptions: save e `set as default` confirmam a linha", () => {
    const f = semComentario(ler("./admin/settings/ShippingOptions.tsx"));
    expect(f, "o update do save voltou a nao confirmar a linha")
      .toMatch(/\.update\(payload\)\.eq\("id", editing\.id\)\.select\("id"\)/);
    // O pior dos dois: a PRIMEIRA escrita ja tirou o padrao de TODOS. Se a segunda
    // casa zero linhas em silencio, o sistema fica sem padrao nenhum e a tela
    // comemora — exatamente o desfecho que o comentario ali diz evitar.
    const guarda = fatiaEntre(f, "if (nadaFoiEscrito(posto, poeErr))", "return;", 6);
    expect(guarda, "o segundo update do setDefault voltou a ser cego").toMatch(/no longer exists/);
  });
});

describe("portal: leitura que falhou nao pode sair como lista/valor legitimo", () => {
  it('Team: erro de leitura nao vira "No employees yet."', () => {
    const f = semComentario(ler("./portal/Team.tsx"));
    // A edge `company-member` JA lanca 500 para nao devolver `members: []` — a TELA
    // reintroduzia o estrago, e o dono recadastrava a equipe inteira, criando linha
    // duplicada em `clientes` (que nao tem UNIQUE em `email`).
    expect(f, "o erro do invoke voltou a ser so um toast").toMatch(/if \(error\) \{ setErro\(true\)/);
    expect(f, "a leitura boa parou de limpar o estado de erro").toMatch(/setErro\(false\); setMembers/);
    // O estado tem de CHEGAR no render: `setErro` que ninguem le e estado MORTO, o
    // vicio que esta serie ja pegou duas vezes.
    const tabela = fatiaEntre(f, "{loading ? (", ": members.map((m) => (", 14);
    expect(tabela, "`erro` nao e lido no render da tabela").toMatch(/\) : erro \? \(/);
    expect(tabela, "a mensagem nao diz que a lista NAO esta vazia").toMatch(/this is NOT an empty list/i);
  });

  it("Dashboard do portal: ficha nao encontrada nao vira $0.00", () => {
    const f = semComentario(ler("./portal/Dashboard.tsx"));
    // `maybeSingle()` devolve `null` SEM erro quando a linha nao existe ou a RLS a
    // esconde. A guarda do `clienteErr` ja existia; esta metade nao — e os cartoes
    // afirmavam "$0.00 / 0 pedidos", que e o que o comentario ali diz nao poder.
    expect(f, "voltou a sair sem marcar erro quando nao ha ficha")
      .toMatch(/if \(!cliente\) \{ setErro\(true\); setLoading\(false\); return; \}/);
  });

  it("Checkout: a lista de enderecos vem ordenada, nao na ordem fisica", () => {
    const f = semComentario(ler("./portal/Checkout.tsx"));
    // `find(e => e.principal)` pega o PRIMEIRO da lista. Sem `.order()`, "primeiro"
    // e o que o Postgres devolver — e nao ha indice garantindo um so principal.
    expect(f, "o select de enderecos voltou a nao ordenar")
      .toMatch(/\.order\("principal", \{ ascending: false \}\)\.order\("created_at", \{ ascending: false \}\)/);
  });
});

describe("nenhuma tela mostra mojibake ao usuario", () => {
  // `email || "â€”"` estava no codigo: o travessao U+2014 salvo como UTF-8 e relido
  // como latin-1. Aparece LITERALMENTE assim na tabela de resultados, e um dos
  // quatro casos era pior — o `TEMPLATE_ROW` de `ImportCategories` traz
  // "Produtos QuÃ­micos" como exemplo de `parent_name`, ou seja, o admin BAIXA o
  // template com o nome corrompido e reimporta criando a categoria errada.
  const TELAS = [
    "./admin/tools/ImportAddresses.tsx", "./admin/tools/ImportCategories.tsx",
    "./admin/tools/ImportCustomerPrices.tsx", "./admin/tools/ImportProductVariants.tsx",
    "./portal/Team.tsx", "./portal/Dashboard.tsx",
    "./admin/settings/UsersManagement.tsx", "./admin/settings/ShippingOptions.tsx",
  ];
  for (const t of TELAS) {
    it(`${t}: sem sequencia de UTF-8 lido como latin-1`, () => {
      // As marcas classicas: `â€` abre todo caractere de pontuacao (— ' " ), e `Ã`
      // abre toda vogal acentuada.
      expect(ler(t), "voltou texto corrompido — provavel edicao por ferramenta que nao respeitou UTF-8")
        .not.toMatch(/â€|Ã[\u0080-\u00bf]/);
    });
  }
});
