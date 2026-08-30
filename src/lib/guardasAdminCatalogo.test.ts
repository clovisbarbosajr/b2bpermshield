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
import { fatiaEntre } from "@/test/fatia";

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

  it("a recarga e por RAJADA e a leitura tem guarda de ordem", () => {
    // Historico: era `event: "*"` + `fetchData()` direto, uma recarga por evento
    // (40 linhas no InventoryAdjustment = 40 recargas). A tentativa seguinte
    // aplicou `payload.new` em memoria e criou dois defeitos piores: a publicacao
    // de `produtos` so traz `(id, estoque_total, estoque_reservado)`
    // (20260828010000), e esta tela EXIBE e BUSCA por `nome`/`sku` — rename nunca
    // chegava na grade; e sumiu o refetch, que era quem reparava resposta
    // atrasada. A forma certa e recarga debounced + guarda de ordem.
    const src = f();
    // Asserts por SUBSTRING, e nao por regex: regex escrito por gerador ja
    // chegou aqui sem as barras de escape, virando um assert que nao protegia
    // nada (`docs/LOG-TRABALHO.md`, o caso dos dois bytes de backspace).
    expect(src, "o patch em memoria voltou, e com ele o rename que nunca chega")
      .not.toContain("setProdutos((prev) => prev.map");
    expect(src, "sumiu o debounce: voltou uma recarga por evento")
      .toContain("clearTimeout(recargaRef.current);");
    expect(src, "sumiu o timer que junta a rajada numa leitura so")
      .toContain("recargaRef.current = setTimeout(() => fetchData(), 300);");
    expect(src, "o timer nao e limpo no cleanup do efeito")
      .toContain("return () => { clearTimeout(recargaRef.current); supabase.removeChannel(channel); };");
    // A guarda de ordem mora no `fetchData`, e vale para TODOS os chamadores.
    expect(src, "sumiu o contador de carga").toContain("const minha = ++cargaSeq.current;");
    expect(fatiaEntre(src, "const minha = ++cargaSeq.current;", "setProdutos(data)", 12),
      "a resposta atrasada voltou a poder escrever na grade")
      .toContain("if (minha !== cargaSeq.current) return;");
    // A leitura precisa continuar trazendo as colunas que a grade exibe e filtra.
    expect(src, "a leitura deixou de trazer nome/sku")
      .toContain('select("id, nome, sku, estoque_total, estoque_reservado")');
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

  it("`Move up/down` usa o reordenador puro, que tem teste que EXECUTA", () => {
    // O assert anterior exigia literalmente `swapCat.ordem === cat.ordem` — ou
    // seja, travava a forma que continha o defeito (o ramo de troca ainda movia
    // DUAS casas quando o empate era entre OUTROS irmaos). A regra saiu da tela
    // para `lib/ordemCategorias.ts` e o comportamento e conferido em
    // `ordemCategorias.test.ts`, com o caso `Z(0), A(1), B(1)`. Aqui fica so a
    // fiacao: a tela nao pode voltar a calcular ordem por conta propria.
    const src = f();
    expect(src, "a tela deixou de usar o reordenador").toContain("reordenarIrmaos(siblings, idx, direction)");
    expect(src, "voltou a trocar dois valores de ordem dentro da tela")
      .not.toContain("update({ ordem: swapCat.ordem }");
    // Move e Sort escrevem em `categorias`, cuja RLS e admin-only, numa tela que
    // manager e warehouse alcancam (`perm="view_products"`). Sem confirmar a
    // linha, o Move era no-op MUDO e o Sort dizia "sorted" com zero gravacoes.
    expect(src, "`Move` voltou a gravar ordem sem confirmar a linha")
      .toContain('.eq("id", c.id).select("id")');
    expect(src, "`Sort` voltou a gravar ordem sem confirmar a linha")
      .toContain('.eq("id", sorted[i].id).select("id")');
    // A recusa do Move precisa nomear as DUAS causas de zero-linhas (RLS, e
    // irmao apagado por outro admin no meio): acusar so permissao mandava o
    // admin ao lugar errado numa reordenacao que em boa parte foi gravada.
    expect(src, "sumiu a recusa quando parte da reordenacao nao aplicou")
      .toContain("Part of the reorder did not apply");
    expect(src, "a recusa do Move voltou a acusar uma causa so")
      .toContain("no longer exists, or you do not have permission to change categories");
    expect(src, "sumiu a recusa de quem nao tem permissao para ordenar")
      .toContain("Nothing was sorted");
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

describe("Produtos: a lista nao pode mentir sobre o que gravou nem apagar as cascatas em silencio", () => {
  const f = () => semComentario("src/pages/admin/Produtos.tsx");

  it("os dois selects da lista gravam pelo bloqueio otimista, e nao com update cru", () => {
    // TRES defeitos colapsavam aqui:
    // 1. UPDATE barrado por RLS afeta ZERO linhas e devolve `error: null` — o
    //    warehouse mudava status/Active, a tela pintava o valor novo, nada gravou.
    // 2. Sem `admin_rev`, mudar status pela lista e salvar uma ficha ja aberta
    //    DESFAZIA a mudanca da lista, e os dois caminhos diziam "salvo".
    // 3. A ficha usava `gravarComToken` e a lista nao — ter duas garantias
    //    diferentes para a MESMA coluna foi o que produziu (2).
    const src = f();
    expect(src, "a lista voltou a gravar sem o bloqueio otimista")
      .toContain('gravarComToken(supabase, "produtos"');
    // Nenhum `update()` cru sobre `produtos` pode voltar a existir nesta tela.
    expect(src, "voltou um update direto em produtos, fora do gravarComToken")
      .not.toMatch(/from\("produtos"\)[\s\S]{0,60}?\.update\(/);
    // E o `rev` novo tem que voltar para o estado local, senao o SEGUNDO clique na
    // mesma linha bate em token velho e acusa um colega que nao existe.
    expect(src, "o rev novo nao volta para o estado local")
      .toMatch(/admin_rev: r\.rev/);
    // Os quatro desfechos de `gravarComToken` sao distintos de proposito. Tratar
    // so o erro deixava `conflito` cair no caminho de sucesso.
    for (const t of ["conflito", "recusado", "incerto"]) {
      expect(src, `o desfecho \`${t}\` deixou de ser tratado`).toContain(`r.tipo === "${t}"`);
    }
  });

  it("o delete conta as cascatas irrecuperaveis, recusa se nao contar, e confirma a linha", () => {
    // "Delete this product?" escondia DOZE cascatas. Nove delas (galeria,
    // arquivos, descontos, preco por cliente, relacionados, opcoes, regras de
    // status, e as DUAS de privacidade) sao digitadas aqui e o sync do B2BWave
    // nao as devolve.
    const src = f();
    const del = src.match(/const handleDelete = async \(e: React\.MouseEvent[\s\S]{0,4000}?\n  \};/);
    expect(del, "nao achei o handleDelete").toBeTruthy();
    for (const t of [
      "produto_imagens", "produto_descontos", "produto_precos_cliente",
      "produto_acesso", "produto_cliente_acesso", "produto_variantes",
    ]) {
      // `contar("X")`, e nao so `"X"`: os mesmos seis nomes aparecem no TIPO do
      // parametro logo acima, entao procurar a string solta lia a anotacao e nao a
      // chamada. Medido: apagar `contar("produto_precos_cliente")` passava verde.
      expect(del![0], `o delete parou de contar ${t}`).toContain(`contar("${t}")`);
    }
    expect(del![0], "falha ao contar deixou de recusar o delete")
      .toMatch(/if \(erro\) \{[\s\S]{0,200}?return;/);
    // DELETE barrado por RLS tambem afeta zero linhas em silencio — e o
    // `activity_logs` aceita INSERT de warehouse, entao ficava gravada, com o nome
    // real dele, uma delecao que nunca aconteceu.
    expect(del![0], "o delete voltou a nao confirmar a linha").toContain('.select("id")');
    const guarda = del![0].indexOf("if (!apagado)");
    const registro = del![0].indexOf('log("deleted"');
    expect(guarda, "sumiu a guarda de zero linhas apagadas").toBeGreaterThan(-1);
    expect(registro, "nao achei o registro no activity_logs").toBeGreaterThan(-1);
    expect(guarda, "o log de auditoria e escrito antes de confirmar que apagou")
      .toBeLessThan(registro);
    // A guarda tem que ABORTAR: comparar posicao nao mata o mutante que apaga o
    // `return`. Foi exatamente esse mutante que sobreviveu em `Categorias`.
    const bloco = del![0].match(/if \(!apagado\) \{[\s\S]{0,300}?\n    \}/);
    expect(bloco, "nao achei o corpo da guarda").toBeTruthy();
    expect(bloco![0], "a guarda nao interrompe mais o fluxo").toMatch(/return;/);
    // FK e protecao, nao erro para despejar cru na cara do admin.
    expect(del![0], "o erro de FK voltou a ser despejado cru").toContain('"23503"');
  });

  it("a paginacao usa a pagina LIMITADA nos quatro pontos", () => {
    // Apagar/desativar a unica linha da ultima pagina reduzia `totalPages`, a barra
    // inteira desmontava (esta sob `totalPages > 1`) e a fatia virava vazia: "No
    // products found" sem botao de voltar, so F5. `paginaValida` tem teste que
    // EXECUTA em `paginacao.test.ts` — este aqui so cobra que a tela a use.
    const src = f();
    expect(src, "a tela parou de limitar a pagina").toContain("paginaValida(page, totalPages)");
    // Os quatro pontos: a fatia, os botoes de anterior/proximo, a lista de numeros
    // e o realce do botao atual. Deixar UM em `page` reabre o beco pela metade.
    expect(src, "a fatia voltou a usar a pagina nao limitada")
      .toMatch(/filtered\.slice\(\(pageOk - 1\)/);
    expect(src, "os numeros da barra voltaram a usar a pagina nao limitada")
      .toContain("paginasVisiveis(pageOk, totalPages)");
    expect(src, "as setas voltaram a usar a pagina nao limitada")
      .toMatch(/disabled=\{pageOk <= 1\}/);
    expect(src, "as setas voltaram a usar a pagina nao limitada")
      .toMatch(/disabled=\{pageOk >= totalPages\}/);
  });
});
