// PORTAO — nome usado fora do escopo em edge function.
//
// Existe porque em 25/ago/2026 eu movi uma constante de lugar e passei a le-la
// num escopo mais raso do que o da declaracao. Em producao isso e ReferenceError
// na resposta da funcao; aqui nao acusava nada, porque `npm test` so olha `src/`
// e o Deno nao esta instalado nesta maquina.
//
// Roda `tsc` com `--noResolve` (nao tenta baixar os imports remotos do Deno) e
// recusa qualquer TS2304/TS2552 — "nome nao encontrado" — exceto os globais do
// proprio Deno, esperados porque nao temos os tipos aqui.
//
// A PRIMEIRA versao deste portao PASSOU o mutante: o `tsc` nem chegava a rodar,
// o `catch` engolia a falha de spawn, a saida ficava vazia e isso era lido como
// "nenhum erro". Portao que falha em silencio e pior que portao nenhum — da
// confianca sem dar cobertura. Agora a execucao do `tsc` e verificada.
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

// `tsc` sem erro nenhum sai 0 e nao imprime nada. Se saiu != 0 tem que HAVER
// diagnostico — senao alguma coisa deu errado que este portao nao entende, e
// engolir isso e exatamente o defeito que ele tinha.
if (r.status !== 0 && saida.trim() === "") {
  console.error(`\nPORTAO NAO PODE RODAR: tsc saiu com codigo ${r.status} e sem diagnostico.\n`);
  process.exit(1);
}

const erros = saida
  .split("\n")
  .filter((l) => /error TS(2304|2552):/.test(l))
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
