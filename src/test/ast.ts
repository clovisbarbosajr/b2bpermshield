// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Leitura de codigo por AST, para os testes que conferem a FORMA da fonte.
 *
 * POR QUE ISTO EXISTE. Estes testes vinham sendo escritos com expressao regular,
 * e ao longo de dez rodadas de caca a regex errou nas DUAS direcoes, sempre pelo
 * mesmo motivo — ela nao entende a sintaxe:
 *
 *   - deixou passar `clienteId: clienteId ?? null` sem virgula no fim (o regex
 *     exigia a virgula);
 *   - deixou passar o mesmo ternario quebrado em tres linhas (`[^,\n]+` nao
 *     atravessa quebra de linha);
 *   - REPROVOU codigo correto que tinha um comentario `/* *\/` no meio dos
 *     argumentos;
 *   - deixou passar `select("*")` em UM dos dois ramos de um ternario.
 *
 * Cada um desses foi um defeito real escapando com a suite inteira verde, ou
 * codigo correto sendo reprovado. O compilador do TypeScript ja e dependencia do
 * projeto (`tsc` roda no `npm test`), entao usar o parser dele nao acrescenta
 * nada ao `package.json` e acaba com a classe inteira.
 */

export function ast(caminho: string): ts.SourceFile {
  return ts.createSourceFile(
    caminho,
    readFileSync(caminho, "utf-8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    caminho.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function cada(no: ts.Node, visita: (n: ts.Node) => void) {
  visita(no);
  ts.forEachChild(no, (f) => cada(f, visita));
}

/** Toda chamada de `nome(...)` ou `obj.nome(...)` no arquivo. */
export function chamadas(sf: ts.SourceFile, nome: string): ts.CallExpression[] {
  const achadas: ts.CallExpression[] = [];
  cada(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const alvo = n.expression;
    const texto = ts.isPropertyAccessExpression(alvo) ? alvo.name.text
      : ts.isIdentifier(alvo) ? alvo.text
      : "";
    if (texto === nome) achadas.push(n);
  });
  return achadas;
}

/**
 * As propriedades do objeto passado como argumento `indice`, com o TEXTO do
 * valor — `undefined` para forma abreviada (`{ clienteId }`), que e o caso em que
 * o valor E o proprio identificador.
 */
export function propriedadesDoArgumento(
  chamada: ts.CallExpression,
  indice = 0,
): Map<string, string | undefined> {
  const mapa = new Map<string, string | undefined>();
  const arg = chamada.arguments[indice];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return mapa;
  for (const p of arg.properties) {
    if (ts.isShorthandPropertyAssignment(p)) mapa.set(p.name.text, undefined);
    else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      mapa.set(p.name.text, p.initializer.getText(chamada.getSourceFile()));
    }
  }
  return mapa;
}

/**
 * Texto de cada argumento literal string de `.select(...)` no arquivo, com a
 * tabela do `.from(...)` da mesma cadeia e o TEXTO da cadeia inteira.
 *
 * A cadeia serve para distinguir dois selects da MESMA tabela no mesmo arquivo —
 * a lista da tela e o CSV do export, por exemplo. Sem isso, um deles podia
 * assumir a lista de colunas do outro e o teste continuava fechando a conta,
 * enquanto a tela perdia uma coluna de verdade.
 */
export function selects(sf: ts.SourceFile): { texto: string; from: string | null; cadeia: string; no: ts.Node }[] {
  const saida: { texto: string; from: string | null; cadeia: string; no: ts.Node }[] = [];
  for (const c of chamadas(sf, "select")) {
    const primeiro = c.arguments[0];
    if (!primeiro || !ts.isStringLiteral(primeiro)) {
      // Lista montada por concatenacao (`"a, b" + "c"`) — pega o texto cru, que
      // ja basta para separar os nomes de coluna.
      saida.push({ texto: primeiro?.getText(sf) ?? "", from: fromDaCadeia(c, sf), cadeia: cadeiaDe(c, sf), no: c });
      continue;
    }
    saida.push({ texto: primeiro.text, from: fromDaCadeia(c, sf), cadeia: cadeiaDe(c, sf), no: c });
  }
  return saida;
}

/** A tabela do `.from("x")` no MESMO encadeamento de um `.select(...)`. */
function fromDaCadeia(c: ts.CallExpression, sf: ts.SourceFile): string | null {
  let no: ts.Node = c.expression;
  while (no) {
    if (ts.isPropertyAccessExpression(no)) {
      const alvo = no.expression;
      if (ts.isCallExpression(alvo)) {
        if (ts.isPropertyAccessExpression(alvo.expression) && alvo.expression.name.text === "from") {
          const a = alvo.arguments[0];
          return a && ts.isStringLiteral(a) ? a.text : null;
        }
        no = alvo.expression;
        continue;
      }
      no = alvo;
      continue;
    }
    if (ts.isCallExpression(no)) { no = no.expression; continue; }
    break;
  }
  void sf;
  return null;
}

/**
 * Toda expressao passada como argumento `indice` para `nome(...)`, em texto.
 * Serve para exigir que o valor seja o identificador PELADO — sem `??`, sem
 * ternario, sem literal — quando achatar o valor reintroduz um defeito.
 */
export function argumentos(sf: ts.SourceFile, nome: string, indice = 0): string[] {
  return chamadas(sf, nome)
    .map((c) => c.arguments[indice]?.getText(sf) ?? "")
    .filter((x) => x !== "");
}

/**
 * O texto do inicializador da variavel `nome`, seja ela declarada direto
 * (`const clienteId = ...`) ou por desestruturacao (`const [clienteId, set...] =
 * useState(...)`). Um regex nao dava conta das duas formas: no Carrinho ele nunca
 * casava, o `if` que o usava ficava falso, e a assercao inteira nao rodava.
 */
export function inicializador(sf: ts.SourceFile, nome: string): string | null {
  let achado: string | null = null;
  cada(sf, (n) => {
    if (achado || !ts.isVariableDeclaration(n) || !n.initializer) return;
    const alvo = n.name;
    // As tres formas que este repo usa: `const x = ...`, `const [x, setX] =
    // useState(...)` e `const { x, y } = await f(...)`. Cobrir so as duas
    // primeiras deixava o `const { preco, incerto } = await precoDoItem(...)` sem
    // origem — e a assercao que dependia dela nao rodava.
    // SO o nome LOCAL. Casar tambem pelo `propertyName` fazia
    // `const { preco: outroNome } = await f()` responder por "preco", enquanto o
    // resto do codigo usava `outroNome` — falso negativo.
    const nomeia = (e: ts.BindingElement) => ts.isIdentifier(e.name) && e.name.text === nome;
    const bate = ts.isIdentifier(alvo)
      ? alvo.text === nome
      : (ts.isArrayBindingPattern(alvo) || ts.isObjectBindingPattern(alvo)) &&
        alvo.elements.some((e) => ts.isBindingElement(e) && nomeia(e));
    if (bate) achado = n.initializer.getText(sf);
  });
  return achado;
}

/** O texto da cadeia inteira de que este `.select(...)` faz parte. */
function cadeiaDe(c: ts.CallExpression, sf: ts.SourceFile): string {
  let no: ts.Node = c;
  while (
    no.parent &&
    (ts.isPropertyAccessExpression(no.parent) || ts.isCallExpression(no.parent) || ts.isAwaitExpression(no.parent))
  ) {
    no = no.parent;
  }
  return no.getText(sf);
}

/** A funcao (ou arrow) que contem este no. */
export function funcaoQueContem(no: ts.Node): ts.Node | null {
  let atual: ts.Node | undefined = no.parent;
  while (atual) {
    if (
      ts.isFunctionDeclaration(atual) || ts.isFunctionExpression(atual) ||
      ts.isArrowFunction(atual) || ts.isMethodDeclaration(atual)
    ) return atual;
    atual = atual.parent;
  }
  return null;
}

/**
 * De onde vem o identificador `nome` VISTO DO PONTO `uso` — resolvendo escopo de
 * verdade, e nao por travessia textual.
 *
 * As duas versoes anteriores erravam nas duas direcoes, e as duas foram pegas com
 * mutante:
 *
 *   - `inicializador` varria o ARQUIVO inteiro e pegava a primeira declaracao.
 *     Um helper qualquer com `const clienteId = cliente?.id` escrito acima fazia
 *     `const clienteId = null` logo abaixo PASSAR — todo "Add to order" mandava
 *     `clienteId: null` e o cliente com tabela de preco levava o produto pelo
 *     preco de balcao, calado.
 *   - a tentativa seguinte parou na fronteira da FUNCAO, mas nao na do BLOCO. Com
 *     `if (...) { addItem({ preco }) } else { const preco = prod.preco;
 *     addItem({ preco }) }`, os dois `addItem` resolviam para o `preco` bom do
 *     ramo de cima. E um `preco` de arrow aninhada, sem relacao nenhuma com o
 *     carrinho, reprovava codigo correto.
 *
 * Aqui a busca sobe do PONTO DE USO pelos blocos que o contem, olhando so as
 * declaracoes daquele nivel — que e o que o JavaScript faz para `const`/`let`.
 */
export function origemDoIdentificador(sf: ts.SourceFile, uso: ts.Node, nome: string): string | null {
  const declaraAqui = (statements: readonly ts.Statement[]): string | null => {
    for (const st of statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!d.initializer) continue;
        const alvo = d.name;
        const bate = ts.isIdentifier(alvo)
          ? alvo.text === nome
          : (ts.isObjectBindingPattern(alvo) || ts.isArrayBindingPattern(alvo)) &&
            alvo.elements.some((e) => ts.isBindingElement(e) && ts.isIdentifier(e.name) && e.name.text === nome);
        if (bate) return d.initializer.getText(sf);
      }
    }
    return null;
  };

  // Nomes ligados por PARAMETRO ou por cabecalho de `for`/`catch` — que nao sao
  // `VariableStatement` e por isso eram invisiveis. Ignora-los nao era neutro: a
  // busca ATRAVESSAVA a sombra e devolvia a declaracao boa de fora. Um `addItem`
  // extraido para `const enviar = (preco: number) => addItem({ ..., preco })`,
  // chamado com o preco de BALCAO, resolvia para o `const { preco } = await
  // precoDoItem(...)` do bloco de cima e passava com a suite inteira verde.
  //
  // Aqui a sombra INTERROMPE a busca e devolve o marcador. A guarda de fiacao nao
  // tem como seguir um valor que entra por parametro, entao ela tem que dizer
  // isso alto em vez de resolver para outra coisa.
  const sombreiaPorLigacao = (n: ts.Node): boolean => {
    const nomeia = (nome_: ts.BindingName): boolean =>
      ts.isIdentifier(nome_)
        ? nome_.text === nome
        : nome_.elements.some((e) => ts.isBindingElement(e) && nomeia(e.name));
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
      return n.parameters.some((param) => nomeia(param.name));
    }
    if (ts.isCatchClause(n)) return n.variableDeclaration !== undefined && nomeia(n.variableDeclaration.name);
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      const init = ts.isForStatement(n) ? n.initializer : n.initializer;
      return init !== undefined && ts.isVariableDeclarationList(init) &&
        init.declarations.some((d) => nomeia(d.name));
    }
    return false;
  };

  let atual: ts.Node | undefined = uso;
  while (atual) {
    if (sombreiaPorLigacao(atual)) return LIGADO_POR_PARAMETRO;
    const corpo: readonly ts.Statement[] | null =
      ts.isBlock(atual) || ts.isSourceFile(atual) ? atual.statements
      : ts.isCaseClause(atual) || ts.isDefaultClause(atual) ? atual.statements
      : null;
    if (corpo) {
      const achado = declaraAqui(corpo);
      if (achado) return achado;
    }
    atual = atual.parent;
  }
  return null;
}

/**
 * O valor entra por parametro (ou cabecalho de `for`/`catch`), entao a fiacao nao
 * consegue dizer de onde ele vem. Nunca casa com o que as guardas exigem — de
 * proposito: e para reprovar alto, e nao para resolver para outra coisa.
 */
export const LIGADO_POR_PARAMETRO = "<<ligado por parametro>>";
