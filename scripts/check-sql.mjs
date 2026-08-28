// PORTAO — recusa SQL que nem chega a parsear.
//
// Existe porque em 27/ago/2026 eu mandei o dono colar um script de teste no
// editor do Lovable e ele voltou com `42601: syntax error at or near "INTO"`. O
// erro era eu ter escrito
//
//     INSERT INTO alvo SELECT ... FROM ( INSERT INTO outra ... RETURNING id ) x;
//
// que o Postgres nao aceita: statement que modifica dado nao vive em subquery do
// FROM, so em CTE (`WITH x AS (INSERT ... RETURNING id) INSERT ...`). Eu tinha
// relido o arquivo e conferido o schema coluna a coluna — e nada disso pega
// sintaxe. Quem paga o preco de SQL nao parseado e o dono, que cola e leva o erro
// na cara.
//
// COMO ELE PEGA: `libpg-query` e o parser REAL do Postgres compilado para Node,
// nao uma heuristica de regex. O que ele recusa aqui, o servidor tambem recusa.
// Provado por mutante: o trecho errado acima devolve exatamente a mesma mensagem
// que o editor devolveu (`syntax error at or near "INTO"`); os 190 arquivos .sql
// do repositorio passam.
//
// O QUE ELE NAO FAZ: nao valida nome de tabela, de coluna, permissao, nem se a
// consulta faz o que promete — parser nao resolve catalogo. Contra isso continua
// valendo conferir o schema em `src/integrations/supabase/types.ts` e rodar o
// bloco de VERIFICACAO que cada migration carrega no rodape.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIRS = ["supabase/migrations", "docs"];

let parse;
try {
  ({ parse } = await import("libpg-query"));
} catch {
  // NAO derruba o `npm test`. O pacote traz binario nativo; numa maquina ou CI
  // onde ele nao instalar, e melhor perder este portao do que perder a suite
  // inteira. O aviso e alto de proposito para nao virar silencio permanente.
  console.warn("AVISO — `libpg-query` indisponivel, SQL NAO foi parseado nesta rodada.");
  process.exit(0);
}

const erros = [];
let total = 0;

for (const dir of DIRS) {
  let arquivos;
  try {
    arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  } catch {
    continue; // diretorio pode nao existir neste checkout
  }
  for (const f of arquivos) {
    const caminho = join(dir, f);
    total++;
    try {
      await parse(readFileSync(caminho, "utf8"));
    } catch (e) {
      erros.push(`${caminho}  ${e.message}`);
    }
  }
}

if (erros.length) {
  console.error(`\n${erros.length} arquivo(s) .sql nao parseiam:\n`);
  for (const e of erros) console.error("  " + e);
  console.error("");
  process.exit(1);
}
console.log(`OK — ${total} arquivos .sql, todos parseiam no grammar do Postgres.`);
