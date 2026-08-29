/**
 * Toda coluna que a tela LE tem que estar na lista do `select` — em TODOS os
 * ramos.
 *
 * Trocar `select("*")` por lista explicita fecha vazamento de coluna (RLS filtra
 * LINHA, nao COLUNA — `admin_notes` e `admin_comments` chegavam inteiros ao
 * navegador do cliente). Mas a troca tem um custo: a coluna que ficar de fora
 * vira `undefined` SILENCIOSO. Nao ha erro, nao ha aviso — o campo so some da
 * tela, e o `tsc` nao ve, porque o tipo vem do `select` como string.
 *
 * Ja aconteceu: `endereco2` ficou fora da lista de `portal/Conta.tsx` e o
 * complemento do endereco ("Suite 400") desapareceu do bloco Primary.
 *
 * QUATRO versoes anteriores DESTE TESTE erraram, e vale registrar porque cada uma
 * deixou um defeito real passar:
 *   1. lia so o PRIMEIRO `select` do arquivo — tirar a coluna do outro ramo do
 *      ternario passava (sumia para o cliente real, ficava no "view as");
 *   2. conhecia um alias so por alvo — `cliente.empresa` escapava;
 *   3. PULAVA `select("*")` em vez de reprovar — reverter um ramo para `*`
 *      reabria o vazamento inteiro;
 *   4. contava QUANTOS selects cobriam o leitor, nao QUAIS — bastava um select
 *      irmao cobrir no lugar do certo, e qualquer select novo e legitimo da mesma
 *      tabela reprovava sem motivo.
 *
 * A versao atual nao conta nem adivinha: o alvo DECLARA a lista de colunas
 * esperada, e o teste exige que exatamente `ramos` selects daquela tabela tenham
 * essa lista. Select novo com outro proposito nao interfere; coluna que sai de um
 * ramo so derruba a contagem; coluna lida e ausente da lista derruba direto.
 */
import { describe, it, expect } from "vitest";
import { ast, selects, funcaoQueContem } from "@/test/ast";

type Alvo = {
  arquivo: string;
  tabela: string;
  /** quantos selects tem EXATAMENTE esta lista (os ramos do ternario) */
  ramos: number;
  /** a lista de colunas, na integra */
  colunas: string[];
  /**
   * Trecho que identifica ESTA consulta quando o arquivo tem mais de um select da
   * mesma tabela — `portal/Pedidos.tsx` le `pedidos` para a lista da tela e, 200
   * linhas abaixo, para o CSV. Sem a ancora, um podia assumir a lista de colunas
   * do outro e a conta fechava enquanto a tela perdia uma coluna.
   */
  ancora?: string;
  /** todos os nomes pelos quais o resultado e lido */
  leitores: string[];
  /**
   * Procura os acessos SO dentro da funcao que faz a consulta, em vez do arquivo
   * inteiro. Serve quando duas consultas da mesma tabela leem pelo mesmo nome —
   * em `portal/Pedidos.tsx` a tabela e o CSV usam `p` — e misturar as duas faria
   * uma cobrir os acessos da outra.
   */
  soNaFuncao?: boolean;
  /** nomes acessados nesses leitores que NAO sao coluna */
  ignorar?: string[];
};

const CLIENTE_PEDIDO = [
  "id", "user_id", "nome", "email", "telefone", "empresa", "endereco", "cidade",
  "cep", "estado", "pais", "can_view_full_history", "can_confirm_order", "status", "is_active",
];

const ALVOS: Alvo[] = [
  {
    arquivo: "src/pages/portal/Conta.tsx",
    tabela: "clientes",
    ramos: 2,
    colunas: [...CLIENTE_PEDIDO.slice(0, 7), "endereco2", ...CLIENTE_PEDIDO.slice(7, 11),
              "parent_customer_id", ...CLIENTE_PEDIDO.slice(11)],
    leitores: ["c", "cliente", "nextCliente"],
  },
  {
    arquivo: "src/pages/portal/PedidoDetalhe.tsx",
    tabela: "clientes",
    ramos: 2,
    colunas: CLIENTE_PEDIDO,
    leitores: ["perfil", "cliente"],
  },
  {
    arquivo: "src/pages/portal/PedidoDetalhe.tsx",
    tabela: "pedidos",
    ramos: 1,
    colunas: [
      "id", "numero", "cliente_id", "status", "subtotal", "total", "sales_tax",
      "shipping_costs", "desconto", "po_number", "observacoes", "tracking_number",
      "delivery_date", "created_at", "updated_at", "endereco_entrega_id",
      "shipping_option_id", "payment_option_id",
    ],
    // O resultado e lido DUAS vezes: como `p` logo depois da query (e dai saem
    // `endereco_entrega_id`, `shipping_option_id` e `payment_option_id`, que
    // decidem as tres consultas seguintes) e como `pedido` no render. Declarar so
    // `pedido` deixava essas tres colunas sem conferencia — tira-las do select
    // passava, e o endereco de entrega e as duas opcoes renderizavam em branco.
    leitores: ["pedido", "p"],
    ignorar: ["endereco_entrega_id_ok", "then", "data", "error"],
  },
  {
    arquivo: "src/pages/portal/Pedidos.tsx",
    tabela: "pedidos",
    ramos: 1,
    colunas: ["id", "numero", "status", "total", "quantidade_total", "created_at",
              "updated_at", "delivery_date", "po_number"],
    // A consulta da LISTA e a unica com contagem — o CSV nao pagina.
    ancora: 'count: "exact"',
    leitores: ["p"],
    // `p` tambem e o parametro de `setPage(p => ...)`.
    ignorar: ["length", "map", "filter", "find"],
  },
  {
    // O SELECT DO CSV, que e outra consulta a `pedidos` no mesmo arquivo.
    //
    // Ele ficou sem conferencia de coluna quando a ancora entrou: tirar `numero`
    // daqui deixava a coluna "Order #" em branco em TODAS as linhas do arquivo
    // baixado, com a suite verde.
    //
    // `leitores` vazio de proposito: as duas consultas leem por `p` (a tabela e o
    // `linhas.map((p: any) => ...)` do export), e nao da para separar os acessos
    // pelo nome. O que protege aqui e a lista declarada — tirar uma coluna zera a
    // contagem de selects iguais e reprova.
    arquivo: "src/pages/portal/Pedidos.tsx",
    tabela: "pedidos",
    ramos: 1,
    colunas: ["numero", "created_at", "delivery_date", "total", "quantidade_total", "status"],
    // `p` de novo — mas lido SO dentro do `handleExport`. Com `leitores: []` este
    // alvo so reprovava coluna que SAI do select; acrescentar uma coluna nova ao
    // CSV lendo `p.po_number` sem por `po_number` no select passava, e a coluna
    // "Reference" saia em branco em todas as linhas do arquivo baixado.
    leitores: ["p"],
    soNaFuncao: true,
  },
];

const colunasDe = (texto: string) =>
  texto
    .replace(/["'`+\n]/g, " ")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[a-z_][a-z_0-9]*$/.test(x));

describe("colunas explicitas cobrem tudo que a tela le", () => {
  it.each(ALVOS.map((a) => [`${a.arquivo} :: ${a.tabela}`, a] as const))(
    "%s",
    (_nome, alvo) => {
      const sf = ast(alvo.arquivo);
      const todosDaTabela = selects(sf).filter((s) => s.from === alvo.tabela);

      // `select("*")` E REPROVADO, e a checagem vale para TODOS os selects da
      // tabela — ANTES da ancora.
      //
      // Quando a ancora foi introduzida (para distinguir a consulta da tela da do
      // CSV), ela passou a filtrar tambem esta checagem, e o select do CSV ficou
      // sem nenhum assert: trocar o do export por `select("*")` devolvia o
      // `admin_notes` (campo que o admin preenche sob "Not shown to the customer")
      // ao navegador do cliente a cada Export CSV, com a suite verde.
      expect(
        todosDaTabela.filter((s) => s.texto.trim().startsWith("*")).map((s) => s.cadeia.slice(0, 90)),
        `${alvo.arquivo}: select("*") em ${alvo.tabela} — RLS filtra linha, nao coluna`,
      ).toEqual([]);

      const daTabela = todosDaTabela
        .filter((s) => !alvo.ancora || s.cadeia.includes(alvo.ancora));
      expect(daTabela.length, `${alvo.arquivo}: nenhum select de ${alvo.tabela}`)
        .toBeGreaterThan(0);

      // EXATAMENTE `ramos` selects com a lista declarada. Contar quantos "cobrem"
      // deixava um select irmao cobrir no lugar do certo.
      const esperada = alvo.colunas.join("|");
      const iguais = daTabela.filter((s) => colunasDe(s.texto).join("|") === esperada);
      expect(
        iguais.length,
        `${alvo.arquivo} (${alvo.tabela}): esperava ${alvo.ramos} select(s) com a lista declarada; ` +
          `achei ${iguais.length}. Listas presentes: ${JSON.stringify(daTabela.map((s) => colunasDe(s.texto)))}`,
      ).toBe(alvo.ramos);

      // E tudo que a tela LE tem que estar na lista declarada. `soNaFuncao`
      // restringe a busca a funcao que faz a consulta.
      const escopo = alvo.soNaFuncao
        ? funcaoQueContem(iguais[0].no)?.getText(sf) ?? ""
        : sf.getFullText();
      const codigo = escopo
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/\(\s*([A-Za-z_$][\w$]*)\s+as\s+any\s*\)/g, "$1");
      const lidos = new Set<string>();
      for (const leitor of alvo.leitores) {
        const re = new RegExp(String.raw`\b` + leitor + String.raw`\??\.([a-z_][a-z_0-9]*)`, "g");
        for (const m of codigo.matchAll(re)) lidos.add(m[1]);
      }
      expect(lidos.size, `${alvo.arquivo}: nenhum acesso a ${alvo.leitores}`).toBeGreaterThan(0);

      const ignorar = new Set(alvo.ignorar ?? []);
      const set = new Set(alvo.colunas);
      const faltando = [...lidos].filter((x) => !set.has(x) && !ignorar.has(x));
      expect(
        faltando,
        `${alvo.arquivo} (${alvo.tabela}): ${alvo.leitores} le ${faltando.join(", ")}, ` +
          `que nao esta(o) na lista — vira undefined calado`,
      ).toEqual([]);
    },
  );
});
