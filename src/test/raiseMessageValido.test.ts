import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readdirSync, readFileSync } from "node:fs";

// `RAISE EXCEPTION 'X' USING ERRCODE = ..., MESSAGE = '...'` COMPILA, mas em
// execucao o Postgres levanta 42601 "RAISE option already specified: MESSAGE".
// O INSERT continua recusado, so que com texto cru: o CODIGO que o Checkout
// procura em `error.message` some, e a tela nao traduz. Forma valida:
// `RAISE EXCEPTION USING ERRCODE = ..., MESSAGE = 'CODIGO: texto'`.
//
// So o corpo VIVO importa: a ULTIMA definicao de cada funcao, em ordem de nome.

const DIR = "supabase/migrations";
const RAISE_INVALIDO =
  /RAISE\s+(?:(?:EXCEPTION|WARNING|NOTICE|INFO|LOG|DEBUG)\s+)?'[^']*'[^;]*?USING[^;]*?\bMESSAGE\s*:?=/i;
const FUNCAO = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?(\$\w*\$)([\s\S]*?)\2/gi;

function corposVivos(arquivos: { nome: string; sql: string }[]): Map<string, string> {
  const corpos = new Map<string, string>();
  for (const { sql } of [...arquivos].sort((a, b) => a.nome.localeCompare(b.nome))) {
    for (const m of sql.replace(/--.*$/gm, "").matchAll(FUNCAO)) corpos.set(m[1], m[3]);
  }
  return corpos;
}

const invalidas = (corpos: Map<string, string>) =>
  [...corpos].filter(([, corpo]) => RAISE_INVALIDO.test(corpo)).map(([nome]) => nome);

describe("RAISE com MESSAGE so na forma valida", () => {
  it("a varredura acusa a forma errada e aceita a certa", () => {
    const errada = `CREATE OR REPLACE FUNCTION public.f_errada() RETURNS trigger AS $$ BEGIN
      RAISE EXCEPTION 'X'
        USING ERRCODE = 'check_violation', MESSAGE = 'X: texto'; END $$;`;
    const certa = `CREATE FUNCTION public.f_certa() RETURNS trigger AS $fn$ BEGIN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'X: texto';
      RAISE EXCEPTION 'sem message %', 1 USING ERRCODE = 'check_violation'; END $fn$;`;
    // Redefinicao posterior corrigida tem que tirar a funcao da lista.
    const corrige = errada.replace(/RAISE EXCEPTION 'X'\s+USING/, "RAISE EXCEPTION USING");
    expect(invalidas(corposVivos([{ nome: "1.sql", sql: errada }, { nome: "2.sql", sql: certa }]))).toEqual(["f_errada"]);
    expect(invalidas(corposVivos([{ nome: "2.sql", sql: corrige }, { nome: "1.sql", sql: errada }]))).toEqual([]);
  });

  it("nenhuma funcao viva usa `RAISE 'literal' USING ... MESSAGE`", () => {
    const arquivos = readdirSync(DIR)
      .filter((n: string) => n.endsWith(".sql"))
      .map((nome: string) => ({ nome, sql: readFileSync(`${DIR}/${nome}`, "utf8") }));
    const corpos = corposVivos(arquivos);
    // Sem isto, uma regex quebrada passaria vazia.
    for (const f of ["fn_reserve_stock_on_order_item", "fn_pedido_minimo", "fn_pedido_opcoes_validas"]) {
      expect(corpos.has(f), `a varredura nao achou ${f}`).toBe(true);
    }
    expect(invalidas(corpos), "RAISE invalido em execucao (42601): use `RAISE EXCEPTION USING ..., MESSAGE = 'CODIGO: ...'`")
      .toEqual([]);
  });
});
