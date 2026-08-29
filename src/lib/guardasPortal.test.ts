/**
 * As guardas do portal continuam FIADAS.
 *
 * Estas quatro correcoes nao tem como ser exercitadas em teste de execucao sem
 * montar as telas inteiras (`@testing-library/dom` nao esta instalado, e os
 * componentes fazem 4-6 idas ao Supabase na montagem). Um caçador plantou um
 * mutante em cada uma e a suite de 469 testes ficou VERDE nas quatro — cobertura
 * zero. Isto aqui fecha esse buraco.
 *
 * E teste de FIACAO, e sabe disso: protege contra reversao, e so. Nao ve ordem de
 * declaracao, nao ve tipo, nao ve nada que so existe em execucao. Onde a logica
 * pode sair do componente ela sai e ganha teste que roda — `paginacao.ts`,
 * `pricing.ts` e `paginacaoFoco.test.tsx` sao os exemplos desta mesma leva. O que
 * sobra aqui e guarda de tela, que nao sai.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { fatiaEntre } from "@/test/fatia";
import { ast, chamadas, propriedadesDoArgumento, argumentos, inicializador, origemDoIdentificador } from "@/test/ast";

describe("PedidoDetalhe: erro ao ler os itens tira o cliente da tela", () => {
  // So o `return` nao bastava: `setPedido(p)` ja rodou, e o unico guarda do render
  // e `if (!pedido) return null`. A pagina aparecia inteira com a tabela de
  // produtos VAZIA e o rodape mostrando "Total $4.812,00" — e o EXPORT baixava um
  // CSV com cabecalho, zero produtos e a linha de total.
  const bloco = () =>
    fatiaEntre(readFileSync("src/pages/portal/PedidoDetalhe.tsx", "utf-8"),
      "if (itensErr) {", "}", 25);

  it("avisa e navega, em vez de renderizar o pedido sem itens", () => {
    const b = bloco();
    expect(b, "sumiu o toast de erro dos itens").toContain("toast.error");
    expect(b, "sumiu a saida da tela — o pedido volta a renderizar vazio")
      .toContain('navigate("/portal/pedidos")');
  });
});

describe("PedidoDetalhe: ADD TO ORDER nao soma duas vezes", () => {
  // `addItem` SOMA quando a chave ja existe (`CartContext.tsx:220`), e a leva de
  // 29/ago acrescentou 2-3 idas ao banco EM SERIE a este handler — o botao ficou
  // mudo por mais tempo e o duplo clique, mais provavel. A linha de 10 unidades
  // virava 20, calada, com dois `toast.success` normais.
  const fonte = () => readFileSync("src/pages/portal/PedidoDetalhe.tsx", "utf-8");

  it("a trava por item existe e libera no finally", () => {
    const f = fonte();
    expect(f, "sumiu o Set de linhas em voo").toContain("adicionandoRef");
    const entrada = fatiaEntre(f, "const handleAddToOrder", "try {", 8);
    expect(entrada, "a trava tem que barrar ANTES de qualquer ida ao banco")
      .toContain("adicionandoRef.current.has(item.id)");
    // A LIBERACAO TEM QUE ESTAR NO `finally`, e nao so existir no arquivo.
    // Trocar `} finally {` por `} catch (e) {` passava na versao anterior deste
    // teste: no caminho de SUCESSO a chave nunca saia do Set e o botao daquela
    // linha ficava morto ate o F5 — exatamente o que a mensagem aqui promete
    // cobrir.
    const saida = fatiaEntre(f, "} finally {", "}", 6);
    expect(saida, "a liberacao saiu do `finally`")
      .toContain("adicionandoRef.current.delete(item.id)");
  });

  it("o botao reflete a linha certa, e nao a ultima clicada", () => {
    // Com `adicionando` escalar, clicar em A e depois em B apagava o A: o botao de
    // A nunca desabilitava, e a resposta de A reabilitava o de B com B em voo.
    const f = fonte();
    expect(f, "`adicionando` voltou a ser escalar")
      .toContain("useState<string[]>([])");
    expect(f, "o `disabled` do botao nao olha mais a lista")
      .toContain("disabled={adicionando.includes(item.id)}");
    // A FORMA FUNCIONAL nos dois pontos. So o tipo `string[]` nao basta:
    // `setAdicionando([item.id])` mantem o array e reintroduz o bug inteiro —
    // clicar em A e depois em B apaga o A da lista e o botao de A nunca
    // desabilita. Passava na versao anterior deste teste.
    expect(f, "a entrada na lista deixou de ler o estado atual")
      .toContain("setAdicionando((atual) => [...atual, item.id])");
    expect(f, "a saida da lista deixou de ler o estado atual")
      .toContain("setAdicionando((atual) => atual.filter((x) => x !== item.id))");
  });
});

describe("nenhuma tela do portal entrega o id do PAI ao preco", () => {
  // A REGRA VIROU ESTRUTURAL, em vez de policiada por expressao regular.
  //
  // A versao anterior tentava provar isso lendo a declaracao de `clienteId` e os
  // `set*(...)` de cada tela. Um cacador mostrou que nao funcionava dos dois
  // lados: `||` no lugar de `??`, ou uma variavel intermediaria, passavam com a
  // suite verde; e um estado NOVO que guardasse o id da conta por outro motivo —
  // coisa que `Checkout.tsx:195` ja faz de forma legitima — era reprovado sem
  // motivo.
  //
  // O jeito de nao errar e nao ter o dado a mao: nenhuma destas telas seleciona
  // `parent_customer_id`. Quem precisa dele e `pricing.ts`, que o le por conta
  // propria com o id que recebe. `Checkout.tsx` fica fora da lista: ele usa o id
  // da conta para frete e forma de pagamento, e nao para preco.
  const TELAS = [
    "src/pages/portal/PedidoDetalhe.tsx",
    "src/pages/portal/Carrinho.tsx",
    "src/pages/portal/Catalogo.tsx",
    "src/pages/portal/ProdutoDetalhe.tsx",
    "src/pages/portal/Pedidos.tsx",
  ];
  it.each(TELAS)("%s", (tela) => {
    // Comentario de BLOCO tambem sai. So tirar `//` reprovava codigo correto:
    // documentar a regra em `/** ... */` — o estilo dominante do repo, e o que
    // `precoDoItem.ts` usa — quebrava a suite sem uma linha de codigo mudar.
    const codigo = readFileSync(tela, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codigo, `${tela}: le parent_customer_id — o preco do sub-login pode virar o da empresa`)
      .not.toContain("parent_customer_id");
  });
});

describe("as duas entradas do carrinho passam pela decisao de preco", () => {
  // A decisao (cascata, fallback, tri-estado, quando avisar) esta em
  // `lib/precoDoItem.ts` e tem teste que EXECUTA. O que sobra para a fiacao e
  // pouco: a tela chama, e o que ela poe no carrinho e o que voltou de la.
  //
  // TUDO AQUI E LIDO POR AST. Tres versoes anteriores usavam expressao regular e
  // erraram nas DUAS direcoes: deixaram passar `clienteId: clienteId ?? null` sem
  // virgula final e o mesmo ternario quebrado em tres linhas, e REPROVARAM codigo
  // correto com um comentario de bloco entre os argumentos. O parser do
  // TypeScript ja e dependencia do projeto (`tsc` roda no `npm test`).
  const TELAS = [
    "src/pages/portal/Carrinho.tsx",
    "src/pages/portal/PedidoDetalhe.tsx",
  ];
  it.each(TELAS)("%s", (tela) => {
    const sf = ast(tela);
    const f = sf.getFullText();
    expect(f, `${tela}: o aviso de preco incerto sumiu`)
      .toContain("if (incerto) toast.warning(AVISO_PRECO_INCERTO);");

    // TODAS as chamadas, e nao so a primeira. Um segundo handler escrito ABAIXO
    // do bom (um "move all to cart", por exemplo) com `clienteId: null` e
    // `precoBase: item.preco` passava batido — a protecao dependia da ordem
    // textual no arquivo.
    const todasPreco = chamadas(sf, "precoDoItem");
    expect(todasPreco.length, `${tela} deixou de chamar precoDoItem`).toBeGreaterThan(0);
    for (const props of todasPreco.map((c) => propriedadesDoArgumento(c))) {

      // Forma abreviada (`{ clienteId }`, valor `undefined`) ou `clienteId:
      // clienteId`. Qualquer outra coisa — ternario, `??`, literal — achata o "nao
      // sei" em "nao tem" no PONTO DE USO, longe do `clienteDoPortal`, e devolve o
      // defeito original: falha de RLS vira preco de balcao calado, para sempre.
      expect(props.has("clienteId"), `${tela}: precoDoItem sem clienteId`).toBe(true);
      expect(props.get("clienteId") ?? "clienteId", `${tela}: clienteId nao e mais o estado da tela, cru`)
        .toBe("clienteId");

      // `precoBase` tem que ser o preco RELIDO do banco. O do item vem do
      // localStorage ("pode ter meses") ou do pedido antigo.
      expect(props.get("precoBase"), `${tela}: precoBase deixou de vir do produto relido`)
        .toMatch(/^prod\.preco/);
    }

    // Idem para o `addItem`: TODOS. Ele recebe o `preco` que voltou da decisao —
    // apagar essa propriedade devolve o preco congelado do localStorage, que "pode
    // ter meses".
    const todosAdd = chamadas(sf, "addItem");
    expect(todosAdd.length, `${tela} deixou de chamar addItem`).toBeGreaterThan(0);
    for (const doCarrinho of todosAdd.map((c) => propriedadesDoArgumento(c))) {
      expect(doCarrinho.has("preco"), `${tela}: um addItem nao recebe o preco decidido`)
        .toBe(true);
      // O NOME da variavel nao importa — `const { preco: precoOk } = await
      // precoDoItem(...)` e legitimo, e exigir o nome `preco` reprovava
      // justamente a forma que o rastreamento abaixo existe para tratar. O que
      // importa e de onde o valor VEM, conferido logo adiante.
      const usado = doCarrinho.get("preco") ?? "preco";
      expect(usado, `${tela}: o preco do addItem nao e um identificador simples`)
        .toMatch(/^[A-Za-z_$][\w$]*$/);
    }

    // E O VALOR QUE ENTRA NO `addItem` TEM QUE VIR DA DECISAO.
    //
    // Conferir que a propriedade se CHAMA `preco` nao amarra nada: manter o
    // `precoDoItem` e o aviso, e depois fazer `const preco = prod.preco ?? item.preco`,
    // devolve o preco de BALCAO ao carrinho com `tsc` limpo e a suite verde.
    //
    // Duas armadilhas ja pegas aqui: perguntar pelo nome "preco" no ARQUIVO
    // inteiro reprovava um helper legitimo escrito acima, e casar pelo
    // `propertyName` do binding fazia `const { preco: outroNome } = await
    // precoDoItem(...)` seguido de `const preco = prod.preco` PASSAR. Agora a
    // pergunta e a certa: o identificador que o `addItem` de fato recebe, no
    // escopo da funcao daquele `addItem`.
    for (const c of todosAdd) {
      const usado = propriedadesDoArgumento(c).get("preco") ?? "preco";
      const origemPreco = origemDoIdentificador(sf, c, usado);
      expect(origemPreco, `${tela}: nao achei de onde vem o \`${usado}\` do addItem`).toBeTruthy();
      expect(origemPreco, `${tela}: o preco do addItem nao vem mais do precoDoItem`)
        .toContain("precoDoItem(");
    }

    // A ORIGEM do `clienteId`: da ficha ja carregada (PedidoDetalhe) ou de
    // `clienteDoPortal` (Carrinho, que monta o tri-estado — inclusive o valor
    // INICIAL do `useState`, que era um literal solto trocavel por `null`).
    // A PARTIR DE CADA CHAMADA, e nao do arquivo e nao so da primeira.
    //
    // `inicializador` varria o arquivo inteiro: um helper com
    // `const clienteId = cliente?.id` escrito acima fazia `const clienteId = null`
    // logo abaixo passar, e todo "Add to order" mandava `clienteId: null`. Ele
    // chegou a ficar como FALLBACK aqui, o que reabria exatamente esse buraco
    // justamente quando o resolvedor de escopo nao enxergava a forma nova.
    //
    // E `todasPreco[0]` deixava um segundo handler escrito ABAIXO do bom passar
    // batido — a mesma armadilha de ordem textual que os lacos acima ja tinham
    // fechado.
    for (const c of todasPreco) {
      const origem = origemDoIdentificador(sf, c, "clienteId");
      expect(origem, `${tela}: nao achei de onde vem o clienteId`).toBeTruthy();
      expect(origem, `${tela}: clienteId deixou de vir da ficha ou de clienteDoPortal`)
        .toMatch(/cliente\?\.id|clienteDoPortal/);
    }

    // TODA gravacao passa pela funcao, e o resultado NAO pode ser embrulhado:
    // `clienteDoPortal(...) ?? null` contem a chamada e achata o `undefined`.
    for (const arg of argumentos(sf, "setClienteId")) {
      expect(arg, `${tela}: um setClienteId nao passa por clienteDoPortal`)
        .toContain("clienteDoPortal(");
      expect(arg, `${tela}: o resultado de clienteDoPortal esta sendo achatado`)
        .toMatch(/^clienteDoPortal\([\s\S]*\)$/);
    }
  });
});

describe("Carrinho: o efeito do cliente nao reroda a cada volta para a aba", () => {
  it("as deps sao os IDs, e nao os objetos do AuthContext", () => {
    // `supabase-js` reemite `SIGNED_IN` em todo hidden->visible da aba
    // (`GoTrueClient._onVisibilityChanged` -> `_recoverAndRefresh`), e o
    // `AuthContext` faz `setUser(nextSession.user)`: objeto NOVO, mesmo id. Com os
    // objetos nas deps, trocar de aba e voltar rerodava o efeito e apagava o
    // `clienteId` ja resolvido — e um clique em MOVE TO CART na janela do
    // round-trip levava o produto pelo preco de balcao. Medido em React/jsdom:
    // `undefined -> cli-7 -> cli-7 -> undefined`.
    const f = readFileSync("src/pages/portal/Carrinho.tsx", "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const efeito = fatiaEntre(f, "const contexto = {", "]);", 40);
    expect(efeito, "as deps do efeito do cliente voltaram a ser os objetos")
      // Sem o `]` final: `fatiaEntre` corta ANTES do marcador.
      .toContain("}, [user?.id, impersonatedCustomer?.id");
  });
});

describe("ProdutoDetalhe: o marcador da opcao concorda com a disponibilidade", () => {
  it("o seletor de variante desconta `estoque_reservado`, como o resto da tela", () => {
    // Ate 29/ago os dois liam `quantidade` cru e concordavam. Fazer so
    // `effectiveDisponivel` descontar o reservado criou o beco: a opcao aparece
    // sem `(out of stock)`, o cliente clica, e o botao fica desabilitado.
    const f = readFileSync("src/pages/portal/ProdutoDetalhe.tsx", "utf-8");
    const bloco = fatiaEntre(f, "const out =", ";", 3);
    expect(bloco, "o marcador da opcao voltou a ignorar o reservado")
      .toContain("estoque_reservado");
  });
});

describe("ProdutoDetalhe: status ilegivel nao vira afirmacao", () => {
  it("no erro de `product_statuses`, mostra o nome cru do produto", () => {
    // Duas tentativas erraram por motivos opostos: `{ nome: "" }` e truthy e
    // apagava a linha de status da ficha; `null` caia no fallback do ESTOQUE e um
    // produto `descontinuado` com 50 em estoque anunciava "Available" em verde.
    const b = fatiaEntre(readFileSync("src/pages/portal/ProdutoDetalhe.tsx", "utf-8"),
      "if (statusesRes.error) {", "} else {", 30);
    expect(b, "o ramo de erro voltou a inventar ou a apagar o status")
      .toContain("setStatusInfo({ permite_comprar: true, nome: statusName })");
  });
});
