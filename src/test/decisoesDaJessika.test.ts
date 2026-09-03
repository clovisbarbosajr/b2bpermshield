import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

/**
 * GUARDAS DAS DECISOES DA JESSIKA — 02/set/2026.
 *
 * Ver `docs/DECISOES-PENDENTES.md`, secao "RESPOSTAS DA JESSIKA". Cada bloco
 * abaixo prende UMA decisao dela no codigo, e o comentario diz qual foi a
 * pergunta e a resposta — porque daqui a seis meses "por que este botao sumiu?"
 * e a pergunta que faz alguem devolver o defeito.
 */

const ler = (p: string) => readFileSync(p, "utf8");
// Os comentarios CITAM o defeito antigo. Assert que confunde o codigo com a
// explicacao do conserto nao prova nada.
const soCodigo = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("SEG 1 — nenhuma credencial de gateway na tela", () => {
  // "Tirar o campo da tela. Chave secreta de pagamento tem lugar proprio para
  // ficar, e nao e esse."
  //
  // A RLS de `payment_options` e por LINHA e a policy "Read visible
  // payment_options" libera SELECT para todo `authenticated`: o que entrar em
  // `gateway_config` sai pelo console do navegador de qualquer cliente logado.
  const fonte = soCodigo(ler("src/pages/admin/settings/PaymentOptions.tsx"));

  it("nenhum dos sete gateways grava credencial em `gateway_config`", () => {
    // A pergunta dela citava a Secret Key da Stripe. A remocao foi da CLASSE —
    // os sete tinham o mesmo destino.
    for (const chave of [
      "secret_key", "publishable_key",           // Stripe
      "api_password", "api_signature", "api_login", // PayPal
      "access_token", "application_id",           // Square
      "transaction_key", "api_login_id",          // Authorize.Net
      "api_key", "merchant_id",                   // Sola, Paynote
    ]) {
      expect(fonte, `voltou um campo gravando \`${chave}\``)
        .not.toMatch(new RegExp(`updateConfig\\("${chave}"`));
    }
  });

  it("nao sobrou input de senha nem o helper que os construia", () => {
    expect(fonte, "voltou input de senha nesta tela").not.toMatch(/type="password"/);
    expect(fonte, "voltou o helper `secretInput`").not.toMatch(/secretInput/);
  });
});

describe("DADO 1 — apagar cliente/funcionario conta os pedidos antes", () => {
  // "Avisar." — `pedidos.cliente_id` e ON DELETE CASCADE, e o pedido de um
  // sub-login fica com o `cliente_id` DO SUB. Os dois botoes apagavam pedido
  // junto, com um confirm que so falava em "employee AND the login".
  const TELAS = [
    { arq: "src/pages/admin/Clientes.tsx", de: "const handleDelete = async (e: React.MouseEvent", ate: "toast.success(\"Customer deleted\")" },
    { arq: "src/pages/admin/CustomerEdit.tsx", de: "// CONTA OS PEDIDOS ANTES DE PERGUNTAR", ate: "const { error: rowErr } = await supabase.from(\"clientes\").delete()" },
  ];

  for (const { arq, de, ate } of TELAS) {
    it(`${arq.split("/").pop()}: conta, trata falha na contagem, e poe o numero no aviso`, () => {
      const bloco = fatiaEntre(ler(arq), de, ate, 60);

      expect(bloco, "sumiu a contagem de pedidos")
        .toMatch(/from\("pedidos"\)[\s\S]{0,120}count: "exact", head: true/);

      // CONTAGEM BARRADA POR RLS NAO E ERRO — o PostgREST devolve `count: 0` com
      // `error: null`. Guarda que so olha `error` falha ABERTA e o aviso diz
      // "nenhum pedido" para quem tem 40. Por isso tem que tratar o count nulo
      // TAMBEM, e a consequencia tem que ser NAO APAGAR.
      const trata = fatiaEntre(bloco, "if (contErr", "return;", 12);
      expect(trata, "a falha de contagem nao trata `count` nulo — falha ABERTA")
        .toMatch(/nPedidos === null|nPedidos === undefined/);
      expect(trata, "a falha de contagem nao avisa que nada foi apagado")
        .toMatch(/nothing was deleted/i);

      // O numero no texto, e nao so uma frase generica de perigo.
      expect(bloco, "o aviso nao entrega o NUMERO de pedidos que serao apagados")
        .toMatch(/\$\{nPedidos\}/);
      expect(bloco, "o aviso nao diz que e irreversivel").toMatch(/cannot be undone/i);
    });
  }
});

describe("DADO 2 — desmarcar Private avisa quantas liberacoes serao apagadas", () => {
  // "Pode apagar e coloca o aviso." — o save reescreve `produto_acesso` e
  // `produto_cliente_acesso` a partir da tela: com Private desmarcado as duas
  // listas viram `[]`. Remarcar depois volta VAZIO.
  const fonte = ler("src/pages/admin/ProductEdit.tsx");

  it("o aviso roda ANTES de gravar qualquer coisa", () => {
    const iAviso = fonte.indexOf("`\"Private\" is unchecked");
    const iGrava = fonte.indexOf('delOrFail("produto_acesso"');
    expect(iAviso, "sumiu o aviso de desmarcar Private").toBeGreaterThan(-1);
    expect(iGrava, "sumiu o delete das liberacoes").toBeGreaterThan(-1);
    expect(iAviso, "o aviso ficou DEPOIS do delete — perguntar depois de apagar nao e perguntar")
      .toBeLessThan(iGrava);
  });

  it("conta grupos E clientes, e desiste quando o admin recusa", () => {
    // O marcador final vai DEPOIS do `return`: cortar em "Save anyway?" deixava
    // o `)) return;` de fora, e o assert da consequencia — a parte que importa —
    // procurava num recorte que nao a continha.
    const bloco = fatiaEntre(fonte, "if (!form.is_private && id) {", "A GRAVACAO ANTERIOR FICOU SEM RESPOSTA", 40);
    expect(bloco, "parou de contar os grupos de acesso").toMatch(/accGroups\.size/);
    expect(bloco, "parou de contar as regras por cliente")
      .toMatch(/accGrant\.length \+ accExclude\.length/);
    // A CONSEQUENCIA: recusar sai da funcao. Sem o `return`, o confirm vira
    // enfeite e o save apaga do mesmo jeito.
    expect(bloco, "o confirm nao interrompe o save").toMatch(/\)\) return;/);
  });
});

describe("ACESSO 2 — botao que nao grava nao aparece", () => {
  // "deixa o acesso e Esconde os botoes que ele nao pode usar."
  //
  // ISTO E APARENCIA, NAO SEGURANCA: quem impede a escrita e o RLS. Esconder o
  // botao evita o trabalho jogado fora, nao substitui a policy — e por isso o
  // teste nao afirma que ha protecao, so que o botao esta atras da permissao.
  const TELAS: Array<[string, string]> = [
    ["src/pages/admin/CustomerEdit.tsx", "edit_customers"],
    ["src/pages/admin/ProductEdit.tsx", "edit_products"],
  ];

  for (const [arq, permissao] of TELAS) {
    it(`${arq.split("/").pop()}: o Save esta atras de \`${permissao}\``, () => {
      const fonte = soCodigo(ler(arq));
      expect(fonte, "a tela parou de ler a permissao")
        .toMatch(new RegExp(`hasPermission\\("${permissao}"\\)`));
      expect(fonte, "a flag `podeEditar` sumiu").toMatch(/const podeEditar =/);
      // O Save tem que estar DENTRO do ramo verdadeiro do `podeEditar`.
      const iFlag = fonte.indexOf("podeEditar ? (");
      const iSave = fonte.indexOf("handleSave(true)");
      expect(iFlag, "o Save deixou de ser condicional").toBeGreaterThan(-1);
      expect(iFlag, "o `handleSave` ficou FORA do ramo de quem pode editar")
        .toBeLessThan(iSave);
    });
  }

  it("quem nao pode editar VE por que, em vez de so achar a tela quebrada", () => {
    // Botao que some sem explicacao vira chamado de suporte.
    for (const [arq] of TELAS) {
      expect(ler(arq), `${arq} esconde o botao sem dizer nada`).toMatch(/Read-only —/);
    }
  });
});

describe("VENDA 2 — pre-order entra no pedido ja marcado como backorder", () => {
  // "Pre-order sera aceita se o produto estiver liberado no status para
  // 'pre order'. A quantidade do produto fica negativa, e mostra como backorder
  // na ordem. Se o produto tiver como 'Sold Out' nao pode ser adicionado no
  // carrinho."
  const checkout = ler("src/pages/portal/Checkout.tsx");
  const stock = soCodigo(ler("src/lib/stock.ts"));

  it("o carrinho aceita pre-order sem piso de estoque", () => {
    expect(stock, "o carrinho voltou a exigir estoque de pre-order")
      .toMatch(/if \(isPreOrder\) continue;/);
  });

  it("o carrinho recusa quem o status nao deixa comprar", () => {
    // "Sold Out" tem `permite_comprar = false`; a decisao vem da tabela, nao de
    // uma lista de nomes escrita a mao.
    const bloco = fatiaEntre(stock, "const canBuy = statusMap.get", "if (isPreOrder) continue;", 14);
    expect(bloco, "parou de bloquear o status que nao permite comprar")
      .toMatch(/if \(!canBuy\) \{[\s\S]{0,80}blocked\.set/);
  });

  it("o item nasce com `backorder` quando o status e pre-order", () => {
    const bloco = fatiaEntre(checkout, "const statusPorProduto = new Map(", "sku: i.sku", 40);
    // O status tem que vir da leitura FRESCA do servidor, nao do carrinho: o
    // carrinho vive no localStorage e pode estar velho.
    expect(bloco, "o status voltou a sair do carrinho em vez do servidor")
      .toMatch(/freshProducts/);
    expect(bloco, "o item parou de nascer marcado como backorder")
      .toMatch(/backorder: statusPorProduto\.get\(i\.produto_id\) === "pre-order"/);
  });
});

describe("ACESSO 1 — a divergencia tela-vs-banco esta registrada, nao escondida", () => {
  // "Sim, pode fazer os dois" (mudar status E desativar produto).
  //
  // O comentario anterior afirmava que "o banco impoe o mesmo" que o mapa da
  // tela, e era FALSO: a policy `FOR UPDATE` nao restringe coluna. Um comentario
  // errado sobre permissao e pior que nenhum — ele encerra a investigacao.
  const fonte = ler("src/lib/permissions.ts");

  it("nao afirma mais que o banco impoe o mesmo que a tela", () => {
    // O arquivo CITA a frase antiga de proposito ("O comentario que estava aqui
    // dizia ... e era FALSO"), entao proibir a frase no arquivo inteiro
    // reprovaria justamente o registro do conserto.
    //
    // Recortar so o bloco `warehouse` tambem nao serve, e um mutante mostrou:
    // recolocar a afirmacao no cabecalho do arquivo, ACIMA do bloco, sobrevivia.
    //
    // O criterio certo nao e ONDE a frase aparece, e se ela e AFIRMADA ou
    // CITADA: toda linha que a contenha tem que estar marcada como historico.
    const linhas = fonte.split("\n").filter((l) => /imp[oõ]e o mesmo/i.test(l));
    expect(linhas.length, "sumiu ate o registro de que a afirmacao era falsa")
      .toBeGreaterThan(0);
    for (const l of linhas) {
      expect(l, `esta linha AFIRMA que o banco espelha a tela, em vez de citar o erro antigo:\n${l}`)
        .toMatch(/era FALSO/i);
    }
  });

  it("diz que este mapa nao e a fronteira de seguranca", () => {
    expect(fonte).toMatch(/N[AÃ]O [EÉ] A FRONTEIRA DE SEGURAN[CÇ]A/i);
  });
});
