/**
 * Leitor de CSV, um só para todos os importadores.
 *
 * Nove telas tinham a PRÓPRIA `parseCSV`. Oito delas quebravam a linha com
 * `split(",")` ou com uma expressão regular que não entende aspas:
 *
 *   lines[0].split(",")
 *   line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(",")
 *
 * O estrago não é erro na tela — é DADO ERRADO GRAVADO COMO SE FOSSE CERTO.
 * Um campo com vírgula dentro de aspas (`"Rua A, 100"`, `"Acme, Inc"`) desloca
 * TODAS as colunas seguintes: a quantidade passa a ler o preço, o preço lê o
 * SKU, e o número que entra é plausível. Ninguém percebe.
 *
 * E a segunda expressão tem um furo pior: `[^,]+` não casa campo VAZIO, então
 * `a,,b` devolve dois valores em vez de três — a partir da primeira célula em
 * branco, a linha inteira anda uma coluna para a esquerda.
 *
 * Esta versão é a de `ImportRelatedProducts` (a única correta), promovida a
 * lugar único: entende aspas, aspas duplicadas (`""` dentro de campo), campo
 * vazio, quebra de linha DENTRO de campo, CRLF do Windows e BOM do Excel.
 */
export function parseCSV(text: string): Record<string, string>[] {
  // Excel salva CSV com BOM (U+FEFF) na frente do 1º cabeçalho.
  //
  // HONESTIDADE: esta linha é REDUNDANTE hoje. O `trim()` que roda no cabeçalho
  // lá embaixo já remove U+FEFF — no JavaScript o BOM conta como espaço em
  // branco. Descobri plantando um mutante: tirar esta linha não quebra teste
  // nenhum, e não quebra mesmo, porque o comportamento se mantém.
  //
  // Mantida como cinto extra e porque documenta o problema para quem vier
  // depois: se alguém trocar o `trim()` por algo mais estrito, ela passa a ser
  // a única coisa segurando.
  text = text.replace(/^﻿/, "");

  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroDeAspas = false;

  // Numero da linha NO ARQUIVO de cada linha guardada (1-based). Linha em branco
  // e descartada, entao o indice do array nao serve para dizer ao admin onde
  // corrigir.
  const numeroDaLinha: number[] = [];
  let linhaAtual = 1;
  // Linha em que o registro COMECOU. Um campo entre aspas pode ocupar varias
  // linhas, e o que interessa ao admin e onde a linha do CSV comeca — nao onde
  // ela termina.
  let linhaDoRegistro = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (dentroDeAspas) {
      if (ch === '"') {
        // `""` dentro de campo entre aspas é uma aspa literal.
        if (text[i + 1] === '"') { campo += '"'; i++; }
        else dentroDeAspas = false;
      } else {
        // Inclui `\n` de propósito: quebra de linha DENTRO de aspas faz parte do
        // campo (endereço em duas linhas, observação longa).
        //
        // Mas ela CONTA para o numero de linha do arquivo: sem isto, um endereco
        // em duas linhas (o caso de `ImportAddresses`) desalinhava tudo daquele
        // ponto em diante, e o `__linha` reportado ao admin apontava para a linha
        // errada — o defeito que ele veio consertar, por outra porta.
        if (ch === "\n") linhaAtual++;
        campo += ch;
      }
      continue;
    }

    // ASPAS SO ABREM CAMPO NO INICIO DELE.
    //
    // Antes, qualquer `"` em qualquer posicao ligava o modo aspas — e a partir
    // dali o parser engolia virgulas e QUEBRAS DE LINHA como conteudo. Num
    // distribuidor de pisos, `12"` e `3"` sao o dado normal (o proprio
    // `csv.test.ts` usa `cano de 3" polegadas` como exemplo), e o template que as
    // telas oferecem para download e gerado SEM aspas — o admin preenche a mao.
    //
    // Com numero IMPAR de aspas o estrago era total: em `BulkUpdateOrders`, o
    // arquivo de 3 pedidos virava UM, com as outras duas linhas inteiras dentro
    // do `tracking_number`, e a tela dizia "Updated 1 of 1 orders" em verde. Os
    // outros dois pedidos sumiam sem uma palavra.
    // Com numero PAR era pior de notar: `Tile 12" x 12"` virava `Tile 12 x 12` —
    // as polegadas somem do nome do produto, sem erro nenhum.
    //
    // `campo === ""` e o criterio do RFC 4180: aspas no meio do campo sao dado
    // literal. CSV bem-formado (`"Tile 12"" x 12"""`) continua igual — este
    // ramo nem e alcancado, porque ali a aspa e o primeiro caractere.
    if (ch === '"' && campo === "") { dentroDeAspas = true; continue; }

    if (ch === ",") { linha.push(campo); campo = ""; continue; }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;   // CRLF conta como uma
      linha.push(campo);
      campo = "";
      if (linha.some((c) => c.trim() !== "")) { linhas.push(linha); numeroDaLinha.push(linhaDoRegistro); }
      linhaAtual++;
      linhaDoRegistro = linhaAtual;
      linha = [];
      continue;
    }

    campo += ch;
  }

  linha.push(campo);
  if (linha.some((c) => c.trim() !== "")) { linhas.push(linha); numeroDaLinha.push(linhaDoRegistro); }

  if (linhas.length < 2) return [];

  // CABECALHO REPETIDO E RECUSADO, em vez de a ultima coluna vencer em silencio.
  //
  // `sku,nome,sku` + `A1,Cano,B2` devolvia `{sku:"B2", nome:"Cano"}`: a primeira
  // coluna sumia e o importador gravava o valor da coluna errada, reportando
  // sucesso. Planilha que voltou do Excel com uma coluna colada duas vezes cai
  // exatamente nisso.
  const cabecalhos = linhas[0].map((h) => h.trim().toLowerCase());
  const repetidos = cabecalhos.filter((h, i) => h !== "" && cabecalhos.indexOf(h) !== i);
  if (repetidos.length) {
    throw new Error(
      `The file has repeated column(s): ${[...new Set(repetidos)].join(", ")}. ` +
      `Remove the duplicate column(s) and try again.`,
    );
  }

  return linhas.slice(1).map((valores, idx) => {
    const r: Record<string, string> = {};
    cabecalhos.forEach((h, i) => { r[h] = (valores[i] ?? "").trim(); });
    // `__linha`: o numero REAL da linha no arquivo, para a tela poder apontar
    // onde corrigir. As linhas em branco sao descartadas acima, entao o indice do
    // array parou de corresponder ao arquivo faz tempo — e as telas reportavam
    // `i + 2`, mandando o admin abrir a linha errada num CSV vindo do Excel, que
    // gosta de linha em branco.
    Object.defineProperty(r, "__linha", { value: numeroDaLinha[idx + 1], enumerable: false });
    return r;
  });
}
