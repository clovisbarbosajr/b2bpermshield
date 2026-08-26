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
        campo += ch;
      }
      continue;
    }

    if (ch === '"') { dentroDeAspas = true; continue; }

    if (ch === ",") { linha.push(campo); campo = ""; continue; }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;   // CRLF conta como uma
      linha.push(campo);
      campo = "";
      if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
      linha = [];
      continue;
    }

    campo += ch;
  }

  linha.push(campo);
  if (linha.some((c) => c.trim() !== "")) linhas.push(linha);

  if (linhas.length < 2) return [];

  const cabecalhos = linhas[0].map((h) => h.trim().toLowerCase());
  return linhas.slice(1).map((valores) => {
    const r: Record<string, string> = {};
    cabecalhos.forEach((h, i) => { r[h] = (valores[i] ?? "").trim(); });
    return r;
  });
}
