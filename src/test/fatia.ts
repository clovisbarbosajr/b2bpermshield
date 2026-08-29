import { expect } from "vitest";

/**
 * Recorta o trecho de um arquivo-fonte ENTRE dois marcadores, exigindo que os
 * dois existam e que o final venha DEPOIS do inicial.
 *
 * POR QUE ISTO EXISTE. Vários testes deste projeto conferem a FORMA do código
 * lendo o arquivo e recortando um bloco. O recorte ingênuo é
 *
 *     const bloco = fonte.slice(fonte.indexOf(de), fonte.indexOf(ate));
 *
 * e ele já falhou aqui TRÊS vezes, sempre do mesmo jeito: quando um dos
 * marcadores some (um refactor inocente basta), `indexOf` devolve **-1**,
 * `slice(i, -1)` recorta do início até o penúltimo caractere do ARQUIVO — e as
 * asserções passam batendo em qualquer outro trecho.
 *
 * O sintoma é o pior possível num teste: ele fica verde e para de proteger.
 *   - `resendPlacar.test.ts` recortava 1064 linhas e casava com o `handleSave`;
 *   - `warehouseGravacao.test.ts` recortava 79% do arquivo, e com isso a guarda
 *     `return;` do `if (!data)` — corrigida um commit antes — podia ser removida
 *     sem que nenhum dos 384 testes reclamasse.
 *
 * A blindagem tinha sido escrita à mão num arquivo e esquecida nos outros. Agora
 * mora aqui, e `fatiaSemGuarda.test.ts` impede que volte a ser feita à mão.
 *
 * @param fonte  conteúdo do arquivo
 * @param de     marcador inicial (deve existir)
 * @param ate    marcador final (deve existir DEPOIS do inicial)
 * @param maxLinhas teto opcional — um bloco muito maior que o esperado é sinal
 *                  de que o recorte pegou coisa demais, mesmo com os dois
 *                  marcadores presentes.
 */
export function fatiaEntre(
  fonte: string,
  de: string,
  ate: string,
  maxLinhas?: number,
): string {
  const i = fonte.indexOf(de);
  expect(i, `marcador inicial nao encontrado: ${de}`).toBeGreaterThan(-1);
  const f = fonte.indexOf(ate, i + de.length);
  expect(f, `marcador final nao encontrado DEPOIS do inicial: ${ate}`).toBeGreaterThan(i);
  const bloco = fonte.slice(i, f);
  if (maxLinhas !== undefined) {
    expect(bloco.split("\n").length, `o recorte ficou grande demais para ser so o bloco de "${de}"`)
      .toBeLessThanOrEqual(maxLinhas);
  }
  return bloco;
}

/**
 * Do marcador até o fim do arquivo. Use quando o bloco de interesse é o último —
 * aí não há delimitador final e o `slice` aberto é correto, não descuido.
 */
export function fatiaAPartirDe(fonte: string, de: string): string {
  const i = fonte.indexOf(de);
  expect(i, `marcador inicial nao encontrado: ${de}`).toBeGreaterThan(-1);
  return fonte.slice(i);
}
