/**
 * As guardas de Estoque, ProductExport, ProductImport, Categorias e Options.
 *
 * Treze defeitos fecharam nestas cinco telas e nenhum tinha teste. Cada `expect`
 * abaixo nasceu de um mutante que reprova o defeito que ele nomeia.
 *
 * E teste de FIACAO, e sabe disso: protege contra reversao, e so. O que pode sair
 * do componente ja saiu e tem teste que EXECUTA — `lib/postgrestOr.ts` e
 * `lib/export-csv.ts`.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const ler = (f: string) => readFileSync(f, "utf-8");
const semComentario = (f: string) =>
  ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Estoque: o ajuste nao pode deixar disponivel negativo", () => {
  const f = () => semComentario("src/pages/admin/Estoque.tsx");

  it("o compare-and-swap trava tambem o `estoque_reservado`", () => {
    // O gatilho de reserva escreve SO em `estoque_reservado`, invisivel ao filtro
    // de `estoque_total`: entre o SELECT e o UPDATE uma reserva nova passava, o
    // CAS aceitava, e `estoque_total - estoque_reservado` ficava NEGATIVO. O
    // produto trava (o proprio gatilho recusa toda reserva nova), nao se recupera
    // sozinho com o pedido concluido, e nao ha CHECK no banco.
    const upd = f().match(/update\(\{ estoque_total: novaQtd \}\)[\s\S]{0,400}?maybeSingle\(\)/);
    expect(upd, "nao achei o update de estoque").toBeTruthy();
    expect(upd![0], "o CAS voltou a ignorar o reservado").toContain('.eq("estoque_total"');
    expect(upd![0], "sumiu o `.lte(\"estoque_reservado\", novaQtd)` que a tela irma ja tem")
      .toContain('.lte("estoque_reservado", novaQtd)');
  });

  it("a trava de clique e por REF, e vale ANTES do primeiro await", () => {
    // `setSaving(true)` so vale no proximo render e fica atras do `await` da
    // releitura: dois cliques no mesmo tick liam `saving === false` os dois, e o
    // segundo mostrava "nothing was saved" DEPOIS de o primeiro ter gravado.
    const src = f();
    expect(src, "sumiu a trava por ref").toContain("ajustandoRef");
    const entrada = src.match(/const handleAjuste = async \(\) => \{[\s\S]{0,200}?try \{/);
    expect(entrada, "nao achei a abertura do handleAjuste").toBeTruthy();
    expect(entrada![0], "a trava nao barra mais antes do await")
      .toMatch(/if \(ajustandoRef\.current\) return;[\s\S]{0,80}ajustandoRef\.current = true;/);
    expect(src, "a trava nunca e liberada").toMatch(/finally \{[\s\S]{0,80}ajustandoRef\.current = false;/);
  });

  it("o realtime aplica UPDATE no lugar, sem recarregar a tabela inteira", () => {
    // Com `event: "*"` + `fetchData()`, salvar 40 linhas no InventoryAdjustment ou
    // uma rodada do sync disparava 40 recargas completas — e, sem guarda de ordem,
    // a resposta de uma recarga antiga podia deixar estoque velho na grade.
    const src = f();
    // NENHUM handler pode ser `event: "*"`: com curinga, todo UPDATE volta a
    // recarregar a tabela inteira, independente do que venha depois.
    expect(src, "o realtime voltou a escutar todos os eventos no mesmo handler")
      .not.toContain('event: "*"');
    expect(src, "o UPDATE deixou de ser aplicado no lugar")
      .toMatch(/event: "UPDATE"[\s\S]{0,300}?setProdutos\(\(prev\) => prev\.map/);
  });
});

describe("ProductExport: o CSV nao pode misturar nem afirmar preco errado", () => {
  const f = () => semComentario("src/pages/admin/ProductExport.tsx");

  it("regua DESATIVADA fica fora do ramo `All`", () => {
    // Desativar nao apaga os itens, e o join to-one traz a inativa igual — o CSV
    // saia com uma coluna de regua morta, com preco obsoleto, indistinguivel das
    // vivas. E o sync do B2BWave desativa sozinho.
    const src = f();
    expect(src, "o select do ramo All parou de trazer `ativo`")
      .toContain('tabelas_preco(nome, ativo)');
    expect(src, "a regua inativa voltou a entrar no CSV")
      .toMatch(/tabelas_preco\?\.ativo === false\) return;/);
  });

  it("o mapa de precos e chaveado por ID, e nao pelo nome", () => {
    // `tabelas_preco.nome` nao tem UNIQUE, e o proprio `handleDuplicate` gera
    // `"<nome> (copy)"` sem contador: duas reguas de mesmo nome viravam UMA coluna
    // com os precos misturados, linha a linha, conforme a ordem de leitura.
    const src = f();
    // A CHAVE TEM QUE SER O ID. Conferir so a ausencia do nome antigo nao
    // bastava: renomear a variavel e continuar atribuindo o NOME a ela passava.
    expect(src, "a chave do priceMap voltou a ser o nome da tabela")
      .toMatch(/const plId = item\.tabela_preco_id;/);
    expect(src, "sumiu o mapa de rotulos separado da chave").toContain("rotulos");
  });

  it("o filtro por grupo de privacidade escapa o valor no `.or()`", () => {
    // O `or=()` separa por virgula e delimita por parenteses: um grupo chamado
    // `Dealers, Northeast` quebrava o export num toast de parser, e um valor com
    // clausula colada reescrevia o filtro que existe para NAO trazer produto de
    // outro grupo.
    const src = f();
    expect(src, "o nome do grupo voltou a ser interpolado cru no .or()")
      .not.toMatch(/grupo_nome\.eq\.\$\{pg\.nome\}/);
    expect(src, "sumiu o escape do valor").toContain("valorOr(pg.nome)");
  });
});

describe("todo `.or()` com texto livre escapa o valor", () => {
  // O `or=()` do PostgREST separa por VIRGULA e delimita por PARENTESES. Sao dois
  // chamadores com texto do usuario: o filtro de grupo de privacidade do export e
  // a busca de produto do pedido. Corrigir so um deixava o outro quebrando com
  // `Acme, Inc` — nome com virgula que o proprio repo cita como dado normal.
  const TELAS = [
    "src/pages/admin/ProductExport.tsx",
    "src/pages/admin/OrderDetail.tsx",
  ];
  it.each(TELAS)("%s", (tela) => {
    const src = semComentario(tela);
    // Um casamento SO por `.or(...)`, sem `indexOf` a mao: recorte a mao com
    // marcador ausente devolve -1 e pega quase o arquivo inteiro, e e por isso
    // que `fatiaSemGuarda.test.ts` o reprova.
    for (const m of src.matchAll(/\.or\(`([^`]*)`/g)) {
      const expr = m[1];
      // Toda interpolacao dentro da expressao tem que passar por `valorOr`.
      for (const interp of expr.match(/\$\{[^}]*\}/g) ?? []) {
        expect(interp, `${tela}: valor interpolado cru dentro do .or() — ${interp}`)
          .toContain("valorOr(");
      }
    }
  });
});

describe("ProductImport: o botao nao promete o que a rota nega", () => {
  it("o atalho de import so aparece para admin", () => {
    // A pagina e `view_products` (manager e warehouse entram), mas
    // `/admin/ferramentas` e admin puro: o clique caia no `Navigate to="/"` e o
    // `LoginLanding` devolvia para `/admin`, sem uma palavra.
    const src = semComentario("src/pages/admin/ProductImport.tsx");
    expect(src, "o botao de import voltou a aparecer para todo mundo")
      .toMatch(/role !== "admin" \?/);
  });
});

describe("Categorias: escrita confirmada, cascata contada, ordem que anda", () => {
  const f = () => semComentario("src/pages/admin/Categorias.tsx");

  it("o update confirma a linha ANTES de mexer na privacidade", () => {
    // A RLS de `categorias` e admin-only, mas a de `categoria_acesso` aceita
    // manager — e a tela e `view_products`. Sem confirmar, o update do manager
    // voltava 204 sem gravar e o `saveAccess` logo abaixo APAGAVA todas as
    // concessoes: categoria que continuou privada, agora invisivel para todos, e
    // a lista apagada nao existe em lugar nenhum.
    const src = f();
    const upd = src.match(/from\("categorias"\)[\s\S]{0,120}?\.update\([\s\S]{0,200}?;/);
    expect(upd, "nao achei o update de categorias").toBeTruthy();
    expect(upd![0], "o update voltou a nao confirmar a linha").toContain(".select(");
    const guarda = src.indexOf("if (!gravado)");
    const acesso = src.indexOf("saveAccess(categoriaId)");
    expect(guarda, "sumiu a guarda de zero linhas").toBeGreaterThan(-1);
    expect(acesso, "nao achei a chamada de saveAccess").toBeGreaterThan(-1);
    expect(guarda, "a privacidade e escrita antes de confirmar que a categoria foi salva")
      .toBeLessThan(acesso);
    // E A GUARDA TEM QUE ABORTAR. Comparar so as POSICOES nao viu o mutante que
    // apaga o `return;` de dentro do `if (!gravado)`: o toast "Nothing was saved"
    // aparecia e o `saveAccess` rodava logo abaixo assim mesmo — a catastrofe
    // inteira, com a suite verde.
    const bloco = src.match(/if \(!gravado\) \{[\s\S]{0,400}?\n      \}/);
    expect(bloco, "nao achei o corpo da guarda").toBeTruthy();
    expect(bloco![0], "a guarda nao interrompe mais o fluxo — o saveAccess roda assim mesmo")
      .toMatch(/return;/);
  });

  it("o delete conta a cascata antes de perguntar, e recusa se nao conseguir contar", () => {
    // "Delete this category?" escondia tres efeitos, dois de acesso: produto com
    // categoria NULA pula a checagem de privacidade (privado vira publico), e
    // `user_locations` em cascade faz quem estava amarrado a uma localizacao
    // passar a ver a producao de TODAS.
    const src = f();
    const del = src.match(/const handleDelete = async \(id: string\) => \{[\s\S]{0,2000}?\n  \};/);
    expect(del, "nao achei o handleDelete").toBeTruthy();
    for (const t of ["produtos", "categorias", "user_locations"]) {
      expect(del![0], `o delete parou de contar ${t}`).toContain(`from("${t}")`);
    }
    expect(del![0], "falha ao contar deixou de recusar o delete")
      .toMatch(/error \|\|[\s\S]{0,250}?return;/);
  });

  it("o erro de refetch aparece TAMBEM com a lista cheia", () => {
    // O outro ponto que mostra `loadError` esta dentro de `flatList.length === 0`.
    // Mas `fetchData()` roda de novo depois de salvar, apagar, mover e ordenar: se
    // ESSE refetch falhar com a lista carregada, o estado ficava setado e a tela
    // nao mostrava nada — a grade seguia exibindo a ordem ANTERIOR e o admin
    // clicava "Move" de novo em cima de dado velho. Mesmo defeito do Catalogo.
    expect(f(), "o erro de refetch voltou a so aparecer com a lista vazia")
      .toMatch(/\{loadError && flatList\.length > 0 &&/);
  });

  it("`Move up/down` reindexa quando os irmaos empatam em `ordem`", () => {
    // `ordem` e NOT NULL DEFAULT 0 e o formulario parte de 0: irmaos criados pela
    // tela ficavam todos com 0, a troca gravava 0 e 0, as duas escritas passavam e
    // o botao nao fazia nada — sem erro e sem toast.
    expect(f(), "o empate de ordem voltou a gravar dois valores iguais")
      .toMatch(/swapCat\.ordem === cat\.ordem[\s\S]{0,400}?update\(\{ ordem: i \}/);
  });
});

describe("Options: escrita confirmada e estado que nao envelhece", () => {
  const f = () => semComentario("src/pages/admin/Options.tsx");

  it("UPDATE que casa zero linhas para o laco e avisa", () => {
    // O `.maybeSingle()` ja estava la, mas o resultado so era lido no ramo do
    // INSERT: outro admin apagando o valor fazia o update nao pegar nada e a tela
    // dizia "Option updated" com o que foi digitado perdido.
    const src = f();
    expect(src, "o update de option_values voltou a ignorar zero linhas")
      .toMatch(/existente && !error && !gravado/);
    // A GUARDA TEM QUE ABORTAR E APLICAR OS IDS JA GRAVADOS. Conferir so a
    // condicao deixava passar dois mutantes: apagar o `return;` (o laco seguia e a
    // tela dizia "Option updated" com o valor perdido) e apagar o
    // `aplicaIdsNovos()` (o Save seguinte reprocessava com os `temp-` no estado e
    // DUPLICAVA os valores ja inseridos — o defeito que o comentario do arquivo
    // diz ter fechado).
    const bloco = src.match(/if \(existente && !error && !gravado\) \{[\s\S]{0,500}?\n      \}/);
    expect(bloco, "nao achei o corpo da guarda").toBeTruthy();
    expect(bloco![0], "a guarda nao interrompe mais o laco").toMatch(/return;/);
    expect(bloco![0], "a guarda perdeu o `aplicaIdsNovos()` — o retry volta a duplicar")
      .toContain("aplicaIdsNovos()");
  });

  it("remover valor nao regrava o array velho por cima", () => {
    // O `values` da closure e o do render ANTERIOR ao await do delete, e os inputs
    // nao ficam desabilitados: digitar noutra linha durante a remocao fazia o
    // texto antigo voltar, e ser regravado no Save seguinte.
    const src = f();
    expect(src, "o removeValue voltou a usar o snapshot da closure")
      .not.toMatch(/setValues\(values\.filter/);
    expect(src, "sumiu a forma funcional do removeValue")
      .toMatch(/setValues\(\(prev: any\[\]\) => prev\.filter/);
  });

  it("o delete conta quantos produtos perdem a opcao", () => {
    // `produto_opcoes.option_id ON DELETE CASCADE` desatribui a opcao de todo
    // produto que a usa, e nao ha como saber depois quais eram.
    const src = f();
    expect(src, "o delete parou de contar produto_opcoes").toContain('from("produto_opcoes")');
    expect(src, "falha ao contar deixou de recusar o delete")
      .toMatch(/if \(cErr\)[\s\S]{0,160}?return;/);
  });
});
