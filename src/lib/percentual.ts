/**
 * Limita um percentual digitado a 0..100.
 *
 * POR QUE ISTO EXISTE, E POR QUE E COMPARTILHADO: o mesmo defeito estava em duas
 * telas, com a mesma causa e consequencias diferentes.
 *
 * `parseFloat(x) || 0` NAO pega negativo — `-8.25 || 0` e `-8.25`, porque numero
 * negativo e truthy. E `min`/`max` no `<input type="number">` so valida dentro de
 * um `<form>` que faz submit; nenhum dos dois dialogos e `<form>`, entao os
 * atributos sao decorativos ali.
 *
 * Onde doia:
 *
 * - `tax_rates.percentual` (Sales Tax): sem CHECK no banco. O trigger faz
 *   `NEW.sales_tax := round(GREATEST(subtotal - desconto, 0) * _rate/100.0, 2)`,
 *   que fica negativo, e `NEW.total := GREATEST(0, subtotal - desconto +
 *   sales_tax + shipping)` SUBTRAI. Pior: `Checkout.tsx` so imprime a linha
 *   "Sales Tax" quando `salesTax > 0`, entao com aliquota negativa a linha nem
 *   aparece — o cliente ve um total menor sem nenhuma explicacao na tela. E como
 *   tela e banco concordam, a guarda de preco do checkout nao dispara.
 *
 * - `representantes.comissao_percentual`: mesma aritmetica, dano menor.
 *
 * Isencao neste modelo NAO e percentual negativo: e a classe `Non-Taxable` ou
 * taxa 0%, que ja existem. Nao ha caso de negocio legitimo para valor fora da
 * faixa, entao limitar e seguro.
 *
 * O `max` e parametro porque nem todo percentual do sistema tem teto 100 — mas
 * os dois usos de hoje tem, e o teto de 100 do campo de comissao foi conferido
 * no B2BWave real (`min="0" max="100" step="0.1"`), do qual este sistema e clone.
 *
 * Campo vazio devolve 0: o `<input type="number">` manda `""` enquanto o admin
 * apaga para redigitar, e `NaN` no estado quebraria a tela inteira.
 */
export function percentualEmFaixa(v: string | number, max = 100): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, n));
}
