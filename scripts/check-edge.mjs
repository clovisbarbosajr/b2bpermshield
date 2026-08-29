// PORTAO — nome usado fora do escopo em edge function.
//
// Existe porque em 25/ago/2026 eu movi uma constante de lugar e passei a le-la
// num escopo mais raso do que o da declaracao. Em producao isso e ReferenceError
// na resposta da funcao; aqui nao acusava nada, porque `npm test` so olha `src/`
// e o Deno nao esta instalado nesta maquina.
//
// Roda `tsc` com `--noResolve` (nao tenta baixar os imports remotos do Deno) e
// recusa "nome nao encontrado" (TS2304/TS2552) e tambem uso ANTES da declaracao
// (TS2448/TS2454) — que e ReferenceError em producao pela mesma razao, e estava
// de fora na primeira versao. Os globais do proprio Deno sao esperados, porque
// nao temos os tipos aqui.
//
// Este portao ja falhou em silencio DUAS vezes, e as duas viraram conserto aqui:
//   1. o `tsc` nem chegava a rodar (spawn de `.cmd` recusado pelo Node), o
//      `catch` engolia e a saida vazia era lida como "nenhum erro";
//   2. um erro de FLAG fazia o `tsc` recusar rodar, nenhuma linha casava o
//      filtro, e ele imprimia "OK" sem ter olhado nada.
// Por isso agora ele verifica a execucao E exige que todo codigo de erro visto
// seja conhecido. Portao que falha em silencio da confianca sem dar cobertura.
//
// NAO substitui `deno check`: nao valida tipos dos imports remotos nem a API do
// Deno. Pega a classe de erro que eu cometi, e so.

import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DIR = "supabase/functions";

// Globais do runtime Deno, para os quais nao temos tipos aqui.
const GLOBAIS_ESPERADOS = new Set(["Deno", "EdgeRuntime"]);

if (!existsSync(DIR)) {
  console.log("OK — sem edge functions.");
  process.exit(0);
}

const alvos = [];
for (const nome of readdirSync(DIR)) {
  const dir = join(DIR, nome);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    // Arquivo de TESTE nao vai para o Deno — ele roda no vitest, que resolve os
    // imports de verdade. Aqui o `tsc` roda com `--noResolve` (de proposito, para
    // nao baixar os imports remotos do Deno), entao qualquer `import` local dele
    // vira "nome nao encontrado" e este portao acusaria um erro que nao existe em
    // producao. O `tsc -p tsconfig.app.json` do `npm test` ja typecheca esses
    // arquivos com resolucao completa.
    if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
    if (f.endsWith(".ts")) alvos.push(join(dir, f));
  }
}

if (alvos.length === 0) {
  console.log("OK — sem edge functions.");
  process.exit(0);
}

// Chama o JS do tsc com o proprio Node, e nao o atalho `.bin/tsc.cmd`: no
// Windows o Node 24 recusa spawnar `.cmd` sem shell (EINVAL), e usar shell
// reintroduz a concatenacao sem escape dos caminhos. Assim roda nos dois
// sistemas e nao passa por interpretador nenhum.
const tsc = join("node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) {
  console.error(`\nPORTAO NAO PODE RODAR: nao achei o tsc em ${tsc}. Rode \`npm install\`.\n`);
  process.exit(1);
}

// `spawnSync` em vez de `execFileSync`: aqui eu preciso INSPECIONAR o resultado,
// nao so reagir a excecao. `execFileSync` so levanta quando o processo sai com
// codigo != 0 — e uma falha de spawn (binario ausente, permissao) chegava no
// mesmo `catch`, indistinguivel de "tsc rodou e nao achou nada".
//
// Sem `shell: true` de proposito: com shell o Node concatena os argumentos sem
// escapar, e um caminho com espaco ou aspas viraria comando. O portao nao pode
// ser o elo fraco.
const r = spawnSync(process.execPath, [
  tsc,
  "--noEmit", "--noResolve", "--skipLibCheck",
  "--target", "esnext", "--module", "esnext", "--moduleResolution", "bundler",
  ...alvos,
], { encoding: "utf8" });

if (r.error) {
  console.error(`\nPORTAO NAO PODE RODAR: falha ao executar o tsc — ${r.error.message}\n`);
  process.exit(1);
}
if (r.status === null) {
  console.error(`\nPORTAO NAO PODE RODAR: o tsc foi encerrado por sinal (${r.signal}).\n`);
  process.exit(1);
}

const saida = (r.stdout ?? "") + (r.stderr ?? "");

// DIAGNOSTICO DESCONHECIDO = PORTAO NAO PODE RODAR.
//
// A guarda anterior era `status != 0 && saida vazia` — e nunca disparava: com
// `--noResolve` todo import remoto vira TS2307, entao o `tsc` SEMPRE sai != 0
// com saida cheia. Resultado: um erro de FLAG (`--targett` em vez de `--target`,
// TS5025) fazia o tsc recusar rodar, nenhuma linha casava o filtro, e o portao
// imprimia "OK". Passar sem ter olhado nada e o defeito que este arquivo existe
// para nao ter.
//
// Agora: todo codigo de erro que aparecer tem que ser CONHECIDO. Os que o portao
// espera sao TS2307 (import remoto que `--noResolve` nao resolve, normal aqui) e
// os que ele procura. Qualquer outro significa que o tsc esta falando de algo que
// este portao nao entende — e isso e motivo para parar, nao para seguir.
const CODIGOS_PROCURADOS = new Set(["2304", "2448", "2454", "2552"]);
// TS2307: import remoto que `--noResolve` nao resolve — normal aqui.
// TS5097: import terminando em `.ts`, que e o estilo do Deno e o `tsc` so aceita
//         com `allowImportingTsExtensions`. Tambem normal neste projeto.
const CODIGOS_ESPERADOS = new Set(["2307", "5097"]);

const codigosVistos = new Set(
  [...saida.matchAll(/error TS(\d+):/g)].map((m) => m[1]),
);
const desconhecidos = [...codigosVistos].filter(
  (c) => !CODIGOS_PROCURADOS.has(c) && !CODIGOS_ESPERADOS.has(c),
);
if (desconhecidos.length > 0) {
  console.error(`\nPORTAO NAO PODE RODAR: o tsc devolveu diagnostico que este portao nao conhece (TS${desconhecidos.join(", TS")}).`);
  console.error("Saida do tsc:\n" + saida.trim().split("\n").slice(0, 12).map((l) => "  " + l).join("\n") + "\n");
  process.exit(1);
}

// E se saiu != 0 sem diagnostico nenhum, tambem para.
if (r.status !== 0 && codigosVistos.size === 0) {
  console.error(`\nPORTAO NAO PODE RODAR: tsc saiu com codigo ${r.status} e sem diagnostico.\n`);
  process.exit(1);
}

const erros = saida
  .split("\n")
  .filter((l) => /error TS(2304|2448|2454|2552):/.test(l))
  .filter((l) => {
    const m = l.match(/Cannot find name '([^']+)'/);
    return !(m && GLOBAIS_ESPERADOS.has(m[1]));
  });

if (erros.length) {
  console.error(`\n${erros.length} nome(s) fora de escopo em edge function:\n`);
  for (const e of erros) console.error("  " + e.trim());
  console.error("");
  process.exit(1);
}
console.log(`OK — ${alvos.length} arquivos de edge function, nenhum nome fora de escopo.`);
