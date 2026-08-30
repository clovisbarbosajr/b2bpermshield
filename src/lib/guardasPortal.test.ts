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

describe("Checkout: a tela nao pode afirmar um total que o cartao vai desmentir", () => {
  const fonte = () => readFileSync("src/pages/portal/Checkout.tsx", "utf-8");

  it("frete e pagamento falham FECHADO", () => {
    // Os dois `error` eram descartados e o `?? []` transformava falha de leitura em
    // "esta loja nao tem frete": os dois blocos somem do JSX (estao sob
    // `.length > 0`). O cliente fechava o pedido sem escolher frete,
    // `shipping_option_id` ia null, e o banco gravava `shipping_costs := 0`.
    // Frete gratis que ninguem autorizou, sem mensagem em lugar nenhum, a partir
    // de um 500 momentaneo no mount — busca unica, sem retry.
    const src = fonte();
    expect(src, "os dois error voltaram a ser descartados na desestruturacao")
      .not.toMatch(/const \[\{ data: ship \}, \{ data: pay \}\]/);
    // A MENSAGEM TEM QUE VIR DO ERRO. Medido: trocar `!.message` por um campo que
    // nao existe (`.details`) deixava a suite inteira verde e o `tsc` limpo — o
    // banner aparecia com `undefined` no lugar do motivo. Assert de prefixo de
    // linha nao ve isso; o da expressao inteira, ve.
    expect(src, "a falha de frete/pagamento deixou de virar erro de tela")
      .toContain("(ship.error ?? pay.error)!.message");
    // E AS DUAS LEITURAS DE ATRIBUICAO TAMBEM. Elas ficam 35 linhas acima e
    // descartavam o `error`: com os dois `Set` vazios, `canSee` derruba toda opcao
    // `privado` que a RLS ja tinha liberado, `loadError` fica null, o botao fica
    // habilitado — o pedido de frete gratis inteiro, pela porta ao lado.
    expect(src, "as leituras de cliente_shipping_options/payment_options voltaram a descartar o error")
      .toContain("(cpo.error ?? cso.error)!.message");
    expect(src, "o erro de atribuicao nao alimenta mais o loadError")
      .toContain("setLoadError(erroAtribuicao ??");
    // A CONDICAO, E NAO SO O VALOR DO RAMO. Medido: derrubar metade da condicao
    // (`cpo.error ?` em vez de `cpo.error || cso.error ?`) deixava a falha de
    // leitura de UMA das duas voltar a ser silenciosa, com a suite inteira verde —
    // porque os asserts acima olham so o que o ternario DEVOLVE. Mesma classe de
    // guarda frouxa que a rodada anterior encontrou, reintroduzida na guarda que a
    // substituiu.
    expect(src, "a condicao do erro de atribuicao voltou a olhar so uma das duas leituras")
      .toContain("erroAtribuicao = cpo.error || cso.error ?");
    expect(src, "a condicao do erro de frete/pagamento voltou a olhar so uma das duas")
      .toContain("(ship.error || pay.error ?");
    // E A TERCEIRA LEITURA DO MESMO EFEITO. Ela ficava 70 linhas acima e tambem
    // descartava o `error`: numa RE-EXECUCAO (troca de impersonacao, ou o refresh
    // de token trocando o OBJETO `user`), `cliente` fica null, os dois `Set` ficam
    // vazios, e `clienteId` ainda guarda o cliente ANTERIOR — entao o `!clienteId`
    // do submit nao barra e o pedido sai sem frete.
    expect(src, "a leitura do cliente voltou a descartar o error")
      .toContain("const { data: cliente, error: clienteErr } = await clienteQuery;");
    expect(src, "o erro da leitura do cliente nao vira erro de tela")
      .toMatch(/if \(clienteErr\) \{[\s\S]{0,120}?return;/);
    // NENHUM `return` ENTRE A MARCACAO DO ERRO E O BLOCO DE IMPOSTO. A versao
    // anterior deste assert era um regex que exigia `.message);` colado ao
    // `return` — e a linha real termina em `: null));`. Ou seja: ele NUNCA pôde
    // falhar, e um `return` acrescentado na linha seguinte (a forma mais natural de
    // alguem reintroduzir o defeito) passava com a suite inteira verde.
    //
    // Sair ali pula o calculo do imposto: `taxRate` fica 0 e `taxLookupOk` fica
    // TRUE, entao a tela imprime o total como definitivo com o imposto nunca
    // consultado — o cenario que a guarda irmã existe para impedir.
    const ateOImposto = fatiaEntre(src, "setLoadError(erroAtribuicao ??", "// Compute tax using rules", 12);
    expect(ateOImposto, "voltou um `return` entre a marcacao do erro e o calculo do imposto")
      .not.toContain("return");
    // E TEM QUE APARECER NO RENDER. Estado de erro que ninguem desenha e igual a
    // erro engolido — foi assim que `Brands.tsx` passou meses quebrada.
    expect(src, "o loadError do checkout nao e renderizado")
      .toMatch(/\{loadError && \(/);
    // AVISAR NAO BASTA. Sem opcao de frete na tela `shippingId` fica "",
    // `handleSubmit` nao exige frete, e o banco grava `shipping_costs := 0`: o
    // cliente ignorava o card vermelho, clicava SEND ORDER, e o pedido saia com
    // frete gratis — o defeito que esta guarda dizia ter fechado.
    expect(src, "o botao de enviar voltou a aceitar pedido com a leitura de frete falhada")
      .toContain("disabled={loading || !!loadError ||");
  });

  it("imposto por ler nao vira total definitivo nem cobranca no cartao", () => {
    // `taxLookupOk` era usado num lugar SO: para desligar a guarda de preco. A tela
    // nao mudava em nada — com a leitura falhada `taxRate` fica 0, `salesTax` fica
    // 0, a linha "Sales Tax" SUMIA (estava sob `salesTax > 0`), o total era
    // impresso como definitivo e o botao dizia `PAY $X`. Enquanto isso o banco
    // resolve a mesma consulta com `LIMIT 1` e cobra a aliquota de verdade.
    //
    // Alcancavel sem falha de rede: `tax_rules` nao tem UNIQUE em
    // `(tax_class_id, tax_customer_group_id)`, e duas regras para o mesmo par
    // fazem o `.maybeSingle()` errar.
    const src = fonte();
    expect(src, "a linha de imposto voltou a depender so de `salesTax > 0`")
      .toMatch(/\{!taxLookupOk \? \(/);
    expect(src, "o gross total voltou a ser impresso como definitivo")
      .toMatch(/taxLookupOk \? `\$\$\{grossTotal\.toFixed\(2\)\}` : "—"/);
    // O BOTAO E O QUE COBRA. Sem isto o resto e so decoracao: a tela mostrava `—`
    // e o cartao seguia sendo debitado em `finalTotal`.
    expect(src, "o cartao voltou a poder cobrar com o imposto por ler")
      .toMatch(/payByCard && \(!stripeReady \|\| !taxLookupOk\)/);
  });

  it("total que subiu reprecifica a tela e pede reconfirmacao ANTES de criar o pedido", () => {
    // `PAY $X` usa `grossTotal` (precos gravados no carrinho quando o item entrou;
    // nada nunca os atualiza). A cobranca usa `finalTotal`, do banco. A guarda
    // existente compara `finalTotal` com `recalcGrossTotal` — nunca com o que a
    // tela mostrou.
    //
    // REPRECIFICAR e parte da correcao, nao enfeite: so endurecer a guarda
    // prenderia o cliente num laco, porque o carrinho nao reprecifica sozinho e
    // ele veria a mesma recusa para sempre.
    const src = fonte();
    const bloco = src.match(/if \(recalcGrossTotal - grossTotal > 0\.03\) \{[\s\S]{0,1400}?\n    \}/);
    expect(bloco, "sumiu a comparacao com o total que a TELA mostrou").toBeTruthy();
    // OS TRES ASSERTS ABAIXO NASCERAM DE MUTANTES QUE SOBREVIVERAM. Um
    // `.toContain("updatePrice(")` solto nao ve argumento nenhum, e cada um dos
    // tres produz o laco infinito que o comentario da correcao afirma ter evitado.
    //
    // 1. TODOS os itens, e nao so um: reprecificar `recalculated[0]` deixa o resto
    //    do carrinho com preco velho e o segundo clique cai na mesma recusa.
    expect(bloco![0], "a tela nao e mais reprecificada — o cliente fica preso no laco")
      .toContain("for (const i of recalculated) updatePrice(");
    // 2. A quantidade tem que ser a do proprio item. `updatePrice` DESCARTA a
    //    atualizacao quando `quantidadeEsperada` nao bate — um valor impossivel ali
    //    faz o reprice virar no-op silencioso, e o cliente nunca sai da recusa.
    expect(bloco![0], "a quantidade passada ao updatePrice nao e a do item — o reprice vira no-op")
      .toContain("i.preco, i.quantidade)");
    // 3. O DESCONTO tambem. Sem isto o toast anuncia um total e o painel de Totais
    //    imprime outro, e o cliente reconfirma contra um numero que nao sera cobrado.
    expect(bloco![0], "o desconto nao e recalculado — o toast e o painel discordam")
      .toContain("setDiscount(recalcDiscount)");
    expect(bloco![0], "a guarda nao interrompe mais o submit").toMatch(/return;/);
    // 4. E TEM QUE DESTRAVAR O BOTAO. Sem `setLoading(false)`, `loading` fica true,
    //    o botao fica `disabled` para sempre e o cliente literalmente nao consegue
    //    reconfirmar — o pior dos tres sobreviventes.
    expect(bloco![0], "o botao nunca destrava — o cliente nao consegue reconfirmar")
      .toContain("setLoading(false)");
    // ANTES do INSERT do pedido. Depois nao adianta: o cupom ja foi consumido
    // atomicamente no BEFORE INSERT e o estoque ja foi reservado.
    const guarda = src.indexOf("if (recalcGrossTotal - grossTotal > 0.03)");
    const insert = src.indexOf('.from("pedidos")');
    expect(insert, "nao achei o insert do pedido").toBeGreaterThan(-1);
    expect(guarda, "a reconfirmacao passou a acontecer DEPOIS de criar o pedido")
      .toBeLessThan(insert);
  });
});

describe("CartContext: o estoque fossil do localStorage nao decide mais quantidade", () => {
  const fonte = () => readFileSync("src/contexts/CartContext.tsx", "utf-8");

  it("o ramo de linha existente do addItem nao clampa pelo fossil", () => {
    // `i.estoque_disponivel` e gravado quando o item ENTRA e nunca e atualizado —
    // nem pelo watcher de 10s, nem por re-adicionar (`{...i, quantidade}` mantem o
    // valor velho). Cliente poe 2 com estoque 2, deposito repoe 500, ele digita 50
    // na ficha que exibe "500 available": `Math.min(52, 2)` deixava a linha em 2, e
    // o toast dizia "added to order" assim mesmo.
    //
    // Mesmo defeito que `updateQuantity` ja tinha removido, com 10 linhas de
    // comentario explicando — o `addItem` tinha ficado para tras.
    // `fatiaEntre` e nao `slice` a mao: recorte manual com marcador ausente
    // devolve -1 e pega quase o arquivo inteiro — o `estoque_disponivel` do ramo
    // de PRIMEIRA insercao (que e legitimo) entraria na fatia e o assert passaria
    // a reprovar codigo correto. `fatiaSemGuarda.test.ts` reprova o recorte manual.
    //
    // SEM COMENTARIO: o proprio comentario que explica a correcao contem a
    // palavra `estoque_disponivel`, e sem descontar isso o assert reprovava a
    // correcao por causa do texto que a documenta.
    const semComentario = fonte().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const ramo = fatiaEntre(semComentario, "const existing = prev.find", "});", 40);
    expect(ramo, "voltou o clamp pelo estoque fossil da linha do carrinho")
      .not.toContain("estoque_disponivel");
    expect(ramo, "a soma da quantidade sumiu").toContain("i.quantidade + pedido");
    // O RAMO DE PRIMEIRA INSERCAO TAMBEM. Deixar so um dos dois clampando fazia o
    // MESMO botao dar dois resultados: produto com estoque 2 e o cliente digitando
    // 50 entrava com 2 no carrinho vazio ("added to order") e ia a 52 no segundo
    // clique, com o mesmo toast. E o clamp silencioso com toast de sucesso e o
    // defeito que o outro ramo acabou de perder.
    //
    // O RAMO INTEIRO, e nao a linha do `capped`: manter `const capped = pedido;`
    // e clampar na linha SEGUINTE (no `qtd`) passava verde com o defeito de volta.
    // Assert de prefixo de linha nao ve logica empurrada uma linha abaixo.
    const semCom = fonte().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const primeira = fatiaEntre(semCom, "const capped = pedido;", "return [...prev,", 8);
    expect(primeira, "o clamp pelo estoque voltou no ramo de primeira insercao")
      .not.toContain("estoque_disponivel");
    // `Math.max` e legitimo (piso da quantidade minima); `Math.min` so serve para
    // teto, e teto por estoque e exatamente o que saiu daqui.
    expect(primeira, "voltou um teto por estoque no ramo de primeira insercao")
      .not.toContain("Math.min");
    expect(semCom, "o ramo de primeira insercao nao usa mais a quantidade pedida")
      .toContain("const capped = pedido;");
  });
});
