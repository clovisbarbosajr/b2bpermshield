/**
 * Contas do painel ao vivo do /admin — SEM Supabase, de proposito.
 *
 * Tudo que decide numero mora aqui porque a tela nao tem como ser testada por
 * comportamento: `Dashboard.tsx` importa o cliente do Supabase no topo. Com a
 * regra dentro do componente, trocar `!== "cancelled"` por `=== "cancelled"`
 * passa verde em qualquer suite que confira o TEXTO do arquivo.
 *
 * REGRA CENTRAL: pedido cancelado nao existe para receita, nem para o top de
 * produtos, nem para o top de clientes. A exclusao e feita DENTRO de cada
 * funcao, nunca no chamador — quem chama nao pode "esquecer" de filtrar, e uma
 * tela nova nao repete o filtro do seu jeito.
 */
import { canonicalStatus } from "./orderStatuses";

export type PedidoMetrica = {
  id?: string | null;
  total?: number | string | null;
  status?: string | null;
  cliente_id?: string | null;
  created_at?: string | null;
};

/** `pedidos` vem do embed `pedido_itens.pedidos!inner(created_at,status)`. */
export type ItemMetrica = {
  produto_id?: string | null;
  nome_produto?: string | null;
  quantidade?: number | null;
  subtotal?: number | string | null;
  pedidos?: { status?: string | null } | { status?: string | null }[] | null;
};

export type ProdutoEstoque = {
  ativo?: boolean | null;
  rastrear_estoque?: boolean | null;
  quantidade_minima?: number | null;
  estoque_total?: number | null;
  estoque_reservado?: number | null;
};

const DIA = 86_400_000;

const cancelado = (status?: string | null) => canonicalStatus(status) === "cancelled";

/** `total` e numeric no Postgres e chega como string; `null`/lixo vira 0. */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** O embed pode vir objeto (many-to-one) ou array, dependendo do PostgREST. */
const statusDoItem = (i: ItemMetrica) =>
  (Array.isArray(i.pedidos) ? i.pedidos[0]?.status : i.pedidos?.status) ?? null;

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Mes corrente NO FUSO DO NAVEGADOR, do dia 1 ate HOJE.
 *
 * Termina hoje, nao no ultimo dia do mes: `periodoAnterior` compara janelas do
 * mesmo tamanho, entao um `to` no futuro poria 22 dias de vendas contra 30 e o
 * card anunciaria queda de 27% (no dia 2, queda de 93%) com o negocio estavel.
 */
export function periodoAtual(hoje: Date = new Date()): { from: string; to: string } {
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  return { from: `${y}-${p2(m + 1)}-01`, to: `${y}-${p2(m + 1)}-${p2(hoje.getDate())}` };
}

/**
 * Periodo do MESMO NUMERO DE DIAS imediatamente antes de `from`.
 *
 * Contado em dias, nao em meses: marco (31 dias) compara com os 31 dias antes
 * de 01/mar, que atravessam fevereiro. Comparar "mes anterior" faria marco
 * (31d) contra fevereiro (28d) e inventaria ~10% de alta todo ano.
 *
 * A aritmetica e em UTC so para nao cair em horario de verao: somar/subtrair
 * 24h num fuso com DST pula ou repete uma hora e desloca a data.
 */
/**
 * `YYYY-MM-DD` com ano de 4 digitos. Digitar o ano num `<input type="date">`
 * emite datas completas a cada tecla ("0009-09-22", "92220-09-22"): fora dessa
 * faixa `toISOString()` usa o formato expandido com sinal e o `slice(0,10)`
 * devolveria "-002023-04", que o `Date` aceita e o servidor recebe como filtro.
 */
const dataValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1000;

export function periodoAnterior(from: string, to: string): { from: string; to: string } {
  if (!dataValida(from) || !dataValida(to)) return { from: "", to: "" };
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return { from: "", to: "" };
  const dias = Math.round((b - a) / DIA) + 1;
  const fim = a - DIA;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: ymd(fim - (dias - 1) * DIA), to: ymd(fim) };
}

/**
 * Bordas do periodo como INSTANTES, no fuso do navegador.
 *
 * Mesma convencao de `CustomersPerformance`: o admin digita datas de
 * calendario num `<input type="date">` e espera o dia inteiro do fim incluido.
 * Sem `.999` some o ultimo segundo do dia; com `Z` a janela inteira desliza o
 * offset do fuso e pedidos da noite caem no dia errado.
 *
 * O MESMO par vai para o filtro do servidor e para a divisao atual/anterior em
 * memoria — se as duas pontas discordassem, o card e a lista contariam
 * conjuntos diferentes.
 */
/**
 * Periodo que pode ir para o servidor: duas datas de calendario bem formadas e
 * na ordem. `limitesDoPeriodo` nao valida nada — sem esta porta, o ano
 * intermediario que o `<input type="date">` emite ao digitar ("0002-09-01")
 * virava `gte(created_at, ...)` sem limite inferior, varrendo o historico
 * inteiro a cada 60 segundos.
 */
export const periodoUsavel = (from: string, to: string) =>
  dataValida(from) && dataValida(to) && from <= to;

export function limitesDoPeriodo(from: string, to: string): { ini: string; fim: string } {
  return {
    ini: new Date(`${from}T00:00:00`).toISOString(),
    fim: new Date(`${to}T23:59:59.999`).toISOString(),
  };
}

export function resumoVendas(pedidos: PedidoMetrica[]): {
  receita: number;
  pedidos: number;
  ticketMedio: number;
} {
  const validos = (pedidos ?? []).filter((p) => !cancelado(p.status));
  const receita = validos.reduce((s, p) => s + num(p.total), 0);
  // Sem pedido nenhum o ticket e 0, nao NaN nem Infinity: `$NaN` na tela.
  return { receita, pedidos: validos.length, ticketMedio: validos.length ? receita / validos.length : 0 };
}

/** Variacao relativa (0.25 = +25%). Base zero nao tem percentual: `null`. */
export function variacao(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

export function topProdutos(
  itens: ItemMetrica[],
  limite = 10,
): { produto_id: string; nome: string; quantidade: number; receita: number }[] {
  const acc = new Map<string, { produto_id: string; nome: string; quantidade: number; receita: number }>();
  for (const i of itens ?? []) {
    if (cancelado(statusDoItem(i))) continue;
    const id = i.produto_id ?? i.nome_produto ?? "";
    if (!id) continue;
    const linha = acc.get(id) ?? { produto_id: i.produto_id ?? "", nome: i.nome_produto ?? "—", quantidade: 0, receita: 0 };
    linha.quantidade += num(i.quantidade);
    linha.receita += num(i.subtotal);
    acc.set(id, linha);
  }
  return [...acc.values()].sort((a, b) => b.receita - a.receita).slice(0, limite);
}

export function topClientes(
  pedidos: PedidoMetrica[],
  limite = 10,
): { cliente_id: string; receita: number; pedidos: number }[] {
  const acc = new Map<string, { cliente_id: string; receita: number; pedidos: number }>();
  for (const p of pedidos ?? []) {
    if (cancelado(p.status)) continue;
    if (!p.cliente_id) continue;
    const linha = acc.get(p.cliente_id) ?? { cliente_id: p.cliente_id, receita: 0, pedidos: 0 };
    linha.receita += num(p.total);
    linha.pedidos += 1;
    acc.set(p.cliente_id, linha);
  }
  return [...acc.values()].sort((a, b) => b.receita - a.receita).slice(0, limite);
}

/**
 * Estoque critico. So conta produto `ativo` E `rastrear_estoque`: produto
 * inativo nao esta a venda e produto sem rastreio nao tem estoque de verdade —
 * contar os dois enche o card de alarme falso e ninguem mais olha.
 *
 * As duas contagens sao DISJUNTAS: disponivel negativo e pre-venda (backorder),
 * nao "abaixo do minimo". Quem esta negativo ja passou do minimo, e aparecer
 * nos dois numeros faria o admin corrigir o mesmo produto duas vezes.
 */
export function estoqueCritico(produtos: ProdutoEstoque[]): {
  abaixoDoMinimo: number;
  preVendaNegativa: number;
} {
  let abaixoDoMinimo = 0;
  let preVendaNegativa = 0;
  for (const p of produtos ?? []) {
    if (p.ativo !== true || p.rastrear_estoque !== true) continue;
    const disponivel = num(p.estoque_total) - num(p.estoque_reservado);
    if (disponivel < 0) preVendaNegativa += 1;
    else if (disponivel < num(p.quantidade_minima)) abaixoDoMinimo += 1;
  }
  return { abaixoDoMinimo, preVendaNegativa };
}
