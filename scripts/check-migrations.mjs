// PORTAO — recusa migration com corpo PL/pgSQL fora de bloco.
//
// Existe porque eu errei isso DUAS vezes em 25/ago/2026, e nas duas o erro ia
// chegar no banco do dono:
//
//   1. Uma substituicao de texto trocou a linha `NEW.status := ...` pelo
//      COMENTARIO dela. A funcao compilava e nao fazia o que prometia.
//   2. Outra apagou as 3 linhas de `CREATE OR REPLACE FUNCTION ... AS $$ BEGIN`
//      e deixou o corpo solto. `IF ... THEN` fora de bloco e erro de sintaxe:
//      o gatilho nao seria criado — e o log diria que a trava estava no ar.
//
// Reler o arquivo depois de editar nao pegou nenhum dos dois.
//
// ATENCAO ao que este portao NAO faz: ele pega o defeito (2), que e estrutural.
// O (1) — comentario ocupando o lugar da instrucao — nao da para pegar
// estaticamente, porque exigiria saber o que a funcao DEVERIA fazer. Contra ele
// o que funciona e listar as atribuicoes REAIS da funcao e conferir uma a uma
// contra o que o cabecalho promete, antes de entregar. Provado por mutante:
// apagar o `CREATE FUNCTION ... AS $$ BEGIN` e comentar o `COMMIT;` acendem os
// dois alarmes; o arquivo intacto passa.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const erros = [];

// Varre caractere a caractere e devolve o texto FORA de qualquer corpo
// PL/pgSQL, preservando as quebras de linha para o numero da linha bater.
//
// Entende comentario e string ANTES de dollar-quote: a primeira versao deste
// portao acusou uma migration boa porque havia um `$$` dentro de um comentario
// `--`. Portao que da alarme falso vira portao ignorado.
function foraDosBlocos(sql) {
  let fora = "";
  let i = 0;
  const n = sql.length;
  const branco = (t) => t.replace(/[^\n]/g, " ");

  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {           // comentario de linha
      const f = sql.indexOf("\n", i);
      const ate = f === -1 ? n : f;
      fora += sql.slice(i, ate);                     // o teste ja remove o `--`
      i = ate;
      continue;
    }

    if (c === "/" && sql[i + 1] === "*") {           // bloco, aninhavel no PG
      let prof = 1, k = i + 2;
      while (k < n && prof > 0) {
        if (sql[k] === "/" && sql[k + 1] === "*") { prof++; k += 2; }
        else if (sql[k] === "*" && sql[k + 1] === "/") { prof--; k += 2; }
        else k++;
      }
      fora += branco(sql.slice(i, k));
      i = k;
      continue;
    }

    if (c === "'") {                                  // string, com '' escapado
      let k = i + 1;
      while (k < n) {
        if (sql[k] === "'" && sql[k + 1] === "'") k += 2;
        else if (sql[k] === "'") { k++; break; }
        else k++;
      }
      fora += branco(sql.slice(i, k));
      i = k;
      continue;
    }

    if (c === '"') {                                  // identificador citado
      let k = sql.indexOf('"', i + 1);
      k = k === -1 ? n : k + 1;
      fora += branco(sql.slice(i, k));
      i = k;
      continue;
    }

    if (c === "$") {                                  // dollar-quote
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const f = sql.indexOf(tag, i + tag.length);
        if (f === -1) return { fora, aberto: tag, pos: i };
        fora += branco(sql.slice(i, f + tag.length));
        i = f + tag.length;
        continue;
      }
    }

    fora += c;
    i++;
  }
  return { fora, aberto: null };
}

// Instrucoes que SO existem dentro de um corpo PL/pgSQL.
const SO_DENTRO = [
  [/^\s*RETURN\s+(NEW|OLD|NULL|QUERY)\b/i,  "RETURN"],
  [/^\s*NEW\.[A-Za-z_][A-Za-z0-9_]*\s*:=/,  "atribuicao a NEW."],
  [/^\s*RAISE\s+(EXCEPTION|NOTICE|WARNING)\b/i, "RAISE"],
  [/^\s*IF\b.*\bTHEN\s*$/i,                 "IF ... THEN"],
  [/^\s*ELSIF\b/i,                          "ELSIF"],
  [/^\s*END\s+IF\s*;/i,                     "END IF"],
];

const arquivos = readdirSync(DIR).filter(n => n.endsWith(".sql")).sort();

for (const f of arquivos) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const { fora, aberto, pos } = foraDosBlocos(sql);

  if (aberto) {
    erros.push(`${f}:${sql.slice(0, pos).split("\n").length}  bloco ${aberto} aberto e nunca fechado`);
    continue;
  }

  fora.split("\n").forEach((linha, idx) => {
    const semComentario = linha.replace(/--.*$/, "");
    for (const [re, nome] of SO_DENTRO) {
      if (re.test(semComentario)) {
        erros.push(`${f}:${idx + 1}  \`${nome}\` fora de bloco PL/pgSQL — falta o CREATE FUNCTION ... AS $$ BEGIN?`);
        break;
      }
    }
  });

  const nBegin  = (fora.match(/^[ \t]*BEGIN[ \t]*;/gim)  || []).length;
  const nCommit = (fora.match(/^[ \t]*COMMIT[ \t]*;/gim) || []).length;
  if (nBegin !== nCommit) {
    erros.push(`${f}  BEGIN;=${nBegin} mas COMMIT;=${nCommit} — transacao sem fechar`);
  }
}

if (erros.length) {
  console.error(`\n${erros.length} problema(s) em migration:\n`);
  for (const e of erros) console.error("  " + e);
  console.error("");
  process.exit(1);
}
console.log(`OK — ${arquivos.length} migrations, nenhuma com corpo fora de bloco.`);
