/**
 * As guardas do catalogo — a tela que o cliente mais usa.
 *
 * Cinco defeitos fecharam aqui, e nenhum deles tinha teste. Cada `expect` abaixo
 * nasceu de um mutante que reprova o defeito que ele nomeia.
 *
 * E teste de FIACAO, e sabe disso: protege contra reversao, e so. Onde a logica
 * pode sair do componente ela ja saiu — `lib/precoDoItem.ts` (`clienteDoPortal`,
 * o tri-estado) tem teste que EXECUTA, e este arquivo so garante que o catalogo
 * continua ligado nele.
 */
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { argumentos, ast } from "@/test/ast";
import { fatiaEntre } from "@/test/fatia";

const ARQUIVO = "src/pages/portal/Catalogo.tsx";
const fonte = () => readFileSync(ARQUIVO, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Catalogo: preco do cliente", () => {
  it("o clienteId e tri-estado e sai de clienteDoPortal", () => {
    // Descartar o `error` do lookup fazia `clienteId` virar `null`, o efeito de
    // precos nunca rodava, `getPrice` caia no preco de TABELA — e o banner
    // vermelho de "esse nao e o seu preco" nem aparecia, porque `precoIncerto` so
    // liga dentro da funcao que nao executou. Nada redispara o efeito: um blip no
    // carregamento deixava a sessao inteira com preco de balcao, calada.
    const f = fonte();
    expect(f, "o tri-estado do clienteId sumiu")
      .toContain("useState<string | null | undefined>(undefined)");
    const sf = ast(ARQUIVO);
    const gravacoes = argumentos(sf, "setClienteId");
    expect(gravacoes.length, "nenhum setClienteId").toBeGreaterThan(0);
    for (const arg of gravacoes) {
      expect(arg, "um setClienteId nao passa por clienteDoPortal")
        .toMatch(/^clienteDoPortal\([\s\S]*\)$/);
    }
    // O aviso do caminho "nao sei" e DERIVADO — a guarda dele esta no describe
    // "os dois avisos aparecem de verdade", junto com o motivo de nao ser estado.
  });

  it("o preco vem do proprio cliente, nunca do pai", () => {
    // `pricing.ts` resolve o pai sozinho e a tabela do sub-login vence; entregar o
    // pai ja resolvido faz a linha do sub nunca ser lida.
    expect(fonte(), "o catalogo passou a ler parent_customer_id")
      .not.toContain("parent_customer_id");
  });

  it("mudanca de ESTOQUE nao redispara o recalculo de preco", () => {
    // A subscription de realtime faz `setProdutos(prev => prev.map(...))`, e `map`
    // devolve array NOVO sempre. Com `produtos` na dep, todo UPDATE em `produtos`
    // rerodava o `Promise.all` para o catalogo inteiro (~327 produtos x ~4 idas ao
    // banco), e o gatilho e o fluxo normal: o trigger de reserva faz um UPDATE por
    // ITEM de pedido. Estoque nao e entrada de preco.
    const f = fonte();
    expect(f, "a chave de preco por id+minimo sumiu").toContain("chaveDePreco");
    // O CORPO do memo, e nao so o nome. Acrescentar `estoque_total` a chave faz
    // ela mudar a cada evento de realtime e devolve a tempestade inteira — com a
    // suite verde, porque o nome e as deps continuam iguais.
    const memo = f.match(/const chaveDePreco = useMemo\([\s\S]{0,300}?\);/);
    expect(memo, "nao achei o useMemo da chave de preco").toBeTruthy();
    expect(memo![0], "a chave de preco voltou a depender de estoque")
      // Ancora nos CAMPOS de estoque, e nao na palavra solta: `quantidade` sozinha
      // reprovava uma variavel local `quantidadeDoPreco`, que e o estilo do arquivo.
      // Ancora nos NOMES DOS CAMPOS, sem o prefixo `p.`: preso a `p.`, bastava
      // renomear o parametro do lambda (ou desestruturar) para reintroduzir o
      // estoque na chave e ressuscitar a tempestade, com a suite verde.
      // `estoque_total` e especifico o bastante para nao pegar variavel local
      // inocente — quem se chama assim E estoque.
      .not.toMatch(/estoque_total|estoque_reservado|estoque_disponivel/);
    expect(f, "o efeito de preco voltou a depender do array de produtos")
      .toMatch(/fetchPrices\(\);[\s\S]{0,80}\}, \[clienteId, chaveDePreco\]\)/);
  });
});

describe("Catalogo: estoque e status", () => {
  it("o clamp do item ja no carrinho usa o estoque FRESCO", () => {
    // `jaNoCarrinho.estoque_disponivel` e gravado quando o item ENTRA no carrinho
    // e nada nunca o atualiza — o `CartContext.updateQuantity` foi corrigido para
    // PARAR de clampar por ele, e o catalogo reintroduzia o clamp no chamador: a
    // linha exibia "Available: 502" e o toast dizia "only 2 available".
    const f = fonte();
    expect(f, "o clamp voltou a usar o estoque congelado do carrinho")
      .not.toMatch(/clampQty\([^)]*jaNoCarrinho\.estoque_disponivel/);
    expect(f, "o clamp do item existente nao usa mais `disponivel(p)`")
      .toMatch(/clampQty\(alvo,[\s\S]{0,80}disponivel\(p\)\)/);
  });

  it("status ilegivel nao vira pilula verde `Available`", () => {
    // Com `sMap` vazio por falha de leitura, a pilula caia em "Available", em
    // VERDE, para produto `descontinuado` com saldo. O `permite_comprar: true` do
    // default FICA (e a mesma regra conservadora do banco, e travar compra por
    // falha de leitura derruba venda legitima) — muda so o ROTULO.
    const f = fonte();
    // O SETTER, alimentado pelo `error`. Exigir so a string `statusRes.error`
    // deixava apagar o `setStatusIlegivel(...)` e manter o `console.error`: o
    // estado ficava `false` para sempre e a pilula voltava a afirmar "Available",
    // com a suite inteira verde.
    expect(f, "o erro de `product_statuses` nao alimenta mais o estado")
      .toMatch(/setStatusIlegivel\(\s*!!\s*statusRes\.error\s*\)/);
    expect(f, "a pilula afirma `Available` mesmo sem ter lido o status")
      .toMatch(/statusIlegivel\)\s*return \{ label: getStatusLabel\(p\)/);
    // A GRADE TAMBEM. A primeira versao so corrigiu a visao em lista, e as duas
    // se contradiziam: o mesmo produto dizia `descontinuado` numa e "In stock" na
    // outra, dependendo do botao List/Photos.
    expect(f, "a visao em grade continua afirmando `In stock` sem ter lido o status")
      .toMatch(/statusIlegivel \? \([\s\S]{0,200}getStatusLabel\(p\)/);
  });
});

describe("Catalogo: erro de categorias nao vira afirmacao", () => {
  it("falha ao ler categorias liga o banner de erro", () => {
    // Exigir so `setErroCarga(` dentro do bloco nao bastava: o `else` logo abaixo
    // tem `setErroCarga(null)`, e a expressao alcancava ele. Tem que ser o banner
    // LIGADO, com mensagem.
    expect(fonte(), "o erro de categorias voltou a ser invisivel")
      .toMatch(/if \(catRes\.error\) \{[\s\S]{0,200}setErroCarga\(\s*["'`][^"'`]+["'`]\s*\)/);
  });

  it("nao afirma `categoria nao existe mais` quando a leitura falhou", () => {
    // Sem isto, uma URL `?category=` com falha de rede imprimia "This category is
    // no longer available." e zerava a vitrine com "No products found." — duas
    // afirmacoes falsas sobre o negocio.
    expect(fonte(), "`categoriaInvalida` voltou a ignorar o erro de carga")
      .toMatch(/categoriaInvalida = [^;]*!erroCarga/);
  });
});

describe("Catalogo: as guardas de leitura que ja existiam", () => {
  // Estas quatro nao foram escritas nesta leva — mas nao tinham cobertura
  // nenhuma, e um cacador derrubou as quatro com a suite de 540 verde. Guarda sem
  // teste e guarda que volta a sumir na proxima edicao do arquivo.
  const f = () => fonte();

  it("falha ao ler produtos nao vira catalogo vazio", () => {
    // Sem a guarda, `prodRes.error` era ignorado e a tela dizia "No products
    // found" com o banco cheio — o cliente vai embora achando que a loja acabou.
    expect(f(), "o erro da leitura de produtos voltou a ser ignorado")
      .toMatch(/if \(prodRes\.error\)[\s\S]{0,400}setErroCarga\(/);
  });

  it("falha ao ler variantes nao deixa o produto ir ao carrinho sem opcao", () => {
    // Produto com variante iria ao carrinho sem tamanho/cor e com o preco do pai.
    expect(f(), "o erro da leitura de variantes voltou a ser ignorado")
      .toMatch(/if \(erroVariantes\)[\s\S]{0,400}setErroCarga\(/);
  });

  it("falha ao ler categorias nao esconde produto", () => {
    // `filtraPorCategoria` sem o `!catRes.error` fazia o filtro descartar TODO
    // produto que tem categoria: "No products found" numa loja cheia.
    expect(f(), "o filtro por categoria voltou a confiar numa leitura que falhou")
      .toMatch(/filtraPorCategoria = !catRes\.error/);
  });

  it("a leitura de produtos e paginada", () => {
    // PostgREST corta em 1000 linhas com `error: null`. Sem `fetchAllRows`, o
    // catalogo termina na milesima e ninguem fica sabendo.
    expect(f(), "a leitura de produtos voltou a ser crua")
      .toMatch(/fetchAllRows[\s\S]{0,200}from\("produtos"\)/);
  });
});

describe("Catalogo: os dois avisos aparecem de verdade", () => {
  it("o aviso de preco desconhecido e DERIVADO, e nao estado de mao unica", () => {
    // A primeira versao ligava `precoIncerto` num efeito e nada desligava: staff
    // no portal fora do "view as" (o caso "preco base E o certo, nada a avisar")
    // ficava com o banner vermelho a sessao inteira, e toda visita normal
    // piscava o banner no carregamento.
    const f = fonte();
    expect(f, "o aviso voltou a ser estado de mao unica")
      .not.toMatch(/clienteId === undefined\)\s*setPrecoIncerto\(true\)/);
    expect(f, "sumiu o derivado do tri-estado")
      .toMatch(/precoDesconhecido = clienteId === undefined && !loading/);
    expect(f, "o banner nao olha mais o derivado")
      .toMatch(/precoIncerto \|\| precoDesconhecido/);
  });

  it("o erro de carga usa `produtos`, e nao a lista JA FILTRADA", () => {
    // `sorted` passou pelo filtro de busca. Com a leitura de `categorias`
    // falhando e os produtos na tela, uma busca sem resultado trocava a lista por
    // "This is a loading problem, not an empty catalog" — mentira sobre a busca.
    // Os dois pontos que mostram `erroCarga` tem que decidir por `produtos`.
    const f = fonte();
    expect(f, "o ramo vazio voltou a decidir o erro pela lista filtrada")
      .toMatch(/erroCarga && produtos\.length === 0 \?/);
    expect(f, "o banner inline voltou a decidir pela lista filtrada")
      .toMatch(/\{erroCarga && produtos\.length > 0 &&/);
  });

  it("o erro de carga aparece TAMBEM com a lista cheia", () => {
    // O unico ponto que mostrava `erroCarga` estava dentro de
    // `sorted.length === 0`. Com categorias falhando e produtos carregados, o
    // estado ficava setado e a tela nao mostrava nada: todo link de categoria
    // exibia a loja inteira, sem filtro e sem aviso, ate o fim da sessao.
    const bloco = fatiaEntre(fonte(), "{erroCarga && produtos.length > 0 && (", ")}", 40);
    // O BOTAO, e nao so o texto. Apagar o "Try again" deixava o bloco no lugar e
    // a assercao de forma passava — mas ele e a UNICA parte funcional: sem ele
    // nada redispara a carga, e o cliente fica com a loja inteira sem filtro ate
    // o fim da sessao. Foi um mutante que sobreviveu.
    expect(bloco, "o banner de erro perdeu o botao que redispara a carga")
      .toMatch(/setTentativa\(/);
    expect(bloco, "o banner de erro nao limpa o estado antes de tentar de novo")
      .toMatch(/setErroCarga\(null\)/);
  });
});

describe("admin de conteudo: `updated` so depois de confirmar", () => {
  // RLS `FOR ALL USING (has_role(...,'admin'))`: UPDATE que nao casa linha volta
  // 204 com `error: null`. E o `AuthContext` cacheia o `role` e nunca rele
  // `user_roles` na sessao — um admin rebaixado para manager segue com a tela
  // aberta ate fechar a aba, o banco recusando toda escrita e a tela confirmando
  // cada uma.
  const TELAS: [string, string][] = [
    ["src/pages/admin/Banners.tsx", "banners"],
    ["src/pages/admin/Noticias.tsx", "noticias"],
    ["src/pages/admin/Paginas.tsx", "paginas"],
    ["src/pages/admin/Brands.tsx", "brands"],
    ["src/pages/admin/Representantes.tsx", "representantes"],
  ];
  it.each(TELAS)("%s", (arquivo, tabela) => {
    const f = readFileSync(arquivo, "utf-8").replace(/\/\/.*$/gm, "");
    // O recorte vai do `from(...)` ate o `toast.success`, num casamento SO — sem
    // `indexOf` a mao, que e o que `fatiaSemGuarda.test.ts` reprova (e com razao:
    // marcador ausente devolve -1 e o slice pega quase o arquivo inteiro).
    // TODO `.update(` daquela tabela, e a conferencia numa janela FIXA depois
    // dele — sem depender do `toast.success` como marcador de fim.
    //
    // A versao anterior recortava ate o `toast.success` com teto de 600 chars. Um
    // update legitimo mais distante (um "so um banner ativo por vez", com o bloco
    // de comentario no meio consumindo o orcamento) simplesmente nao era casado —
    // e escapava inteiro da conferencia, sem `.select()` e sem guarda.
    const updates = [...f.matchAll(
      new RegExp(`from\\("${tabela}"\\)[\\s\\S]{0,200}?\\.update\\(`, "g"),
    )];
    expect(updates.length, `${arquivo}: nao achei o update de ${tabela}`).toBeGreaterThan(0);
    for (const m of updates) {
      const trecho = f.slice(m.index!, m.index! + 500);
      expect(trecho, `${arquivo}: update sem .select() de confirmacao — "updated" vira chute`)
        .toMatch(/\.select\(/);
      // DUAS formas corretas de tratar zero linhas, e as duas existem no repo:
      // `.single()` LANCA (PGRST116) e cai no `if (error)`; ou `.maybeSingle()`
      // devolve `null` e um `if (!x)` explicito trata.
      const trataZero = /\.single\(\)/.test(trecho) || /if \(!\w+\) \{/.test(trecho);
      expect(trataZero, `${arquivo}: um update nao trata ZERO linhas afetadas`).toBe(true);
    }
  });
});
