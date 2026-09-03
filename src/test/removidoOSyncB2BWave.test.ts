import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fatiaEntre } from "@/test/fatia";

/**
 * GUARDAS DA REMOCAO DO SYNC DO B2BWAVE (02/set/2026).
 *
 * O cliente decidiu que o sistema nasce com ZERO pedidos e sem integracao com o
 * B2BWave. Ver `docs/DESLIGAR-SYNC-B2BWAVE.md`.
 *
 * Estes testes nao guardam a remocao em si — `tsc` ja pega import quebrado. Eles
 * guardam os DOIS defeitos que a remocao criou e que o caçador/cetico acharam, e
 * que nenhuma ferramenta pega: string de rota, credencial orfa na tela, e uma
 * consulta que resolve pedido ambiguo em silencio.
 */

const ler = (p: string) => readFileSync(p, "utf8");

// Os comentarios destes arquivos CITAM o defeito antigo. Um assert que confunde o
// codigo com a explicacao do conserto nao prova nada.
const soCodigo = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Exige que a varredura tenha PASSADO pelos arquivos que decidem o veredito.
 *
 * Contar arquivos so fecha "corpus vazio". Um mutante que exclua um DIRETORIO
 * (ou aperte a extensao para `/\.tsx$/`) mantem o total alto e escapa — e o caso
 * mais grave e justamente esse: sem `App.tsx`, o teste de rota morta fica cego
 * para o unico arquivo onde uma rota morta importa.
 *
 * Nomear os arquivos e o que fecha a classe. Se um deles for renomeado de
 * proposito, o teste falha e alguem tem de olhar — que e o comportamento certo.
 */
function exigeCorpus(arquivos: string[]) {
  const ESSENCIAIS = [
    "src/App.tsx",                                   // o roteador
    "src/components/layouts/AdminLayout.tsx",         // o menu
    "src/pages/admin/settings/Profile.tsx",           // a tela da API removida
    "src/pages/portal/Checkout.tsx",                  // chama edge function
    // Um `.ts` PURO, e nao so `.tsx`: um mutante que apertasse o filtro de
    // `/\.tsx?$/` para `/\.tsx$/` deixava as quatro telas acima no corpus e
    // passava, cegando a varredura para todo `src/lib` e `src/hooks`.
    "src/lib/classificaLog.ts",
  ];
  const vistos = new Set(arquivos.map((a) => a.replace(/\\/g, "/")));
  const faltando = ESSENCIAIS.filter((e) => !vistos.has(e));
  expect(faltando, "a varredura nao passou por estes arquivos — o veredito abaixo nao vale")
    .toEqual([]);
  expect(arquivos.length, "a varredura de `src/` encolheu demais").toBeGreaterThan(150);
}

describe("o que foi apagado nao volta pela porta dos fundos", () => {
  it("as duas edge functions removidas nao existem mais", () => {
    for (const f of ["supabase/functions/b2bwave-sync", "supabase/functions/api"]) {
      expect(existsSync(f), `${f} voltou`).toBe(false);
    }
  });

  it("nenhum codigo invoca uma edge function que nao existe", () => {
    // `invoke("nome")` e STRING: o `tsc` nao checa, e um nome errado so aparece
    // como 404 em producao. Confere TODOS os nomes invocados contra o disco.
    const existentes = new Set(
      readdirSync("supabase/functions", { withFileTypes: true })
        .filter((d: any) => d.isDirectory() && d.name !== "_shared")
        .map((d: any) => d.name),
    );
    expect(existentes.size, "a varredura nao achou edge function nenhuma").toBeGreaterThan(5);

    const arquivos: string[] = [];
    const anda = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true }) as any[]) {
        if (e.name === "node_modules") continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) anda(p);
        else if (/\.tsx?$/.test(e.name)) arquivos.push(p);
      }
    };
    anda("src");

    const orfas: string[] = [];
    let invocacoes = 0;
    for (const arq of arquivos) {
      for (const m of soCodigo(ler(arq)).matchAll(/\.invoke\(\s*["'`]([\w-]+)["'`]/g)) {
        invocacoes++;
        if (!existentes.has(m[1])) orfas.push(`${arq}: invoke("${m[1]}")`);
      }
    }
    // CORPUS PRIMEIRO — e por ARQUIVO NOMEADO, nao por contagem.
    //
    // Contar so fecha a classe "corpus vazio". Ficou aberta a classe "corpus
    // PARCIALMENTE cego": excluir `src/components` inteiro, ou trocar
    // `/\.tsx?$/` por `/\.tsx$/`, mantinha o total acima do piso e o mutante
    // sobrevivia. Piso alto nao resolve — so adia. Exigir os arquivos que
    // importam, sim.
    exigeCorpus(arquivos);
    expect(invocacoes, "nao achou nenhuma chamada `.invoke(` — o teste ficou sem alvo")
      .toBeGreaterThan(20);
    expect(orfas, "invoke apontando para edge function inexistente — 404 em producao")
      .toEqual([]);
  });

  it("nenhuma navegacao para as rotas removidas", () => {
    // Rota morta nao quebra build: da tela em branco no clique.
    const MORTAS = ["/admin/settings/b2bwave-sync", "/admin/tools/import-orders",
                    "/admin/tools/bulk-update-orders"];
    const arquivos: string[] = [];
    const anda = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true }) as any[]) {
        if (e.name === "node_modules") continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) anda(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) arquivos.push(p);
      }
    };
    anda("src");
    const achados: string[] = [];
    let rotasVistas = 0;
    for (const arq of arquivos) {
      const codigo = soCodigo(ler(arq));
      rotasVistas += (codigo.match(/["'`]\/admin\//g) ?? []).length;
      for (const rota of MORTAS) if (codigo.includes(rota)) achados.push(`${arq}: ${rota}`);
    }
    // CORPUS POR ARQUIVO NOMEADO, pelo mesmo motivo do teste acima. Aqui o caso
    // era pior: `App.tsx` sozinho responde por 74 das 170 rotas `/admin/`, entao
    // excluir JUSTAMENTE o roteador — o unico arquivo onde uma rota morta importa
    // — ainda deixava 96 e passava do piso de 50.
    exigeCorpus(arquivos);
    expect(rotasVistas, "nao achou rota `/admin/` suficiente — o teste ficou sem alvo")
      .toBeGreaterThan(100);
    expect(achados, "rota removida ainda referenciada — clique leva a tela em branco")
      .toEqual([]);
  });
});

describe("a tela nao emite credencial para uma API que nao existe", () => {
  const profile = soCodigo(ler("src/pages/admin/settings/Profile.tsx"));

  // Quem lia `configuracoes.api_token` era `functions/api`, apagada. O campo
  // deixava o admin gerar um token, copiar e entregar a um parceiro — e toda
  // chamada voltava 404, sem nada na tela explicando.
  it("Profile nao grava mais api_token nem zapier_password", () => {
    expect(profile, "voltou a gravar `api_token`").not.toMatch(/update\("api_token"/);
    expect(profile, "voltou a gravar `zapier_password`").not.toMatch(/update\("zapier_password"/);
  });

  it("Profile nao exibe mais o token nem o botao de rotacionar", () => {
    expect(profile, "voltou o botao que gera token para uma API inexistente")
      .not.toMatch(/Reset Token/);
    expect(profile, "voltou a derivar a senha do Zapier do token morto")
      .not.toMatch(/zapier_password \|\| apiToken/);
  });
});

describe("numero de pedido ambiguo e recusado, nao adivinhado", () => {
  // `pedidos.numero` NAO tem UNIQUE e o gatilho gera com `MAX(numero)+1` sem
  // lock: dois checkouts concorrentes podem nascer com o mesmo numero.
  //
  // Os TRES consumidores que resolvem pedido por numero precisam recusar a
  // ambiguidade. `notify-dispatch` era o unico que nao recusava: usava
  // `.limit(1)`, que garante que o `maybeSingle()` nunca veja duas linhas — e
  // assim resolvia um pedido ARBITRARIO em silencio, numa checagem de DONO.
  // Cada entrada recorta o BLOCO da consulta, e nao o arquivo inteiro.
  //
  // A primeira versao asseria sobre o arquivo todo, e um mutante sobreviveu:
  // `send-email/index.ts` tem QUATRO `count: "exact"` — tres sao contadores de
  // outra coisa (`head: true`, linhas 1386, 1503, 1743) e so o de 1694 e o desta
  // guarda. Tirar justamente esse deixava as outras tres casando a regex, o teste
  // verde, e o ramo "numero de pedido ambiguo" virava codigo morto.
  // `interrompe` e o que PRENDE A CONSEQUENCIA de cada um.
  //
  // A versao anterior so exigia que a palavra "ambiguo"/"ambiguous" aparecesse no
  // bloco. Dois mutantes sobreviveram a isso: trocar o `return` por um
  // `console.warn` com o MESMO texto passava nas quatro assercoes, e o consumidor
  // seguia para `peds[0]` — rodando a checagem de DONO contra um pedido
  // arbitrario, que e exatamente o defeito que este describe existe para impedir.
  //
  // Cada consumidor interrompe de um jeito diferente, entao o padrao e por
  // arquivo: `notify-dispatch` responde HTTP, `dispatch.ts` devolve o motivo da
  // recusa, `send-email` atribui `motivo` (que o `if (motivo)` seguinte usa).
  const CONSUMIDORES: Array<{
    arq: string; de: string; ate: string; max: number; interrompe: RegExp;
  }> = [
    { arq: "supabase/functions/notify-dispatch/index.ts",
      de: 'const ref = String((vars as any)?.order_id', ate: "if (callerUserId)", max: 40,
      // `[^;]*` e nao `[^}]*`: a mensagem e template literal com `${ref}` e
      // `${count ?? peds.length}` dentro, entao proibir `}` para a busca no
      // proprio texto que ela precisa atravessar. O limite certo aqui e o `;` que
      // fecha o `return`.
      interrompe: /return json\([^;]*ambiguous[^;]*409\)/i },
    { arq: "supabase/functions/_shared/dispatch.ts",
      de: "const ehNumero =", ate: "const ped: any = data[0];", max: 40,
      interrompe: /return `[^`]*ambiguo[^`]*`/i },
    { arq: "supabase/functions/send-email/index.ts",
      de: "const sel = adminClient.from(\"pedidos\")", ate: "const ped: any = peds[0];", max: 40,
      interrompe: /motivo = "[^"]*ambiguo[^"]*"/i },
  ];

  for (const { arq, de, ate, max, interrompe } of CONSUMIDORES) {
    it(`${arq.split("/").slice(-2).join("/")}: conta as linhas e RECUSA >1`, () => {
      const bloco = fatiaEntre(soCodigo(ler(arq)), de, ate, max);

      expect(bloco, "a consulta por numero perdeu o `count: \"exact\"`")
        .toMatch(/count:\s*"exact"/);

      // Pedir a contagem sem `head: true` — com `head` o PostgREST devolve so o
      // numero e nenhuma linha, e o `peds[0]` do consumidor viria vazio.
      expect(bloco, "a contagem virou `head: true` e a consulta parou de trazer linha")
        .not.toMatch(/head:\s*true/);

      expect(bloco, "conta as linhas mas nao compara com 1")
        .toMatch(/\(count \?\? [\w.]+\.length\) > 1/);

      // A CONSEQUENCIA, e nao a palavra: o ramo tem que INTERROMPER. Avisar e
      // seguir em frente e pior que nao checar, porque parece protegido.
      expect(bloco, "o ramo de ambiguidade nao interrompe — vira aviso e o codigo segue para peds[0]")
        .toMatch(interrompe);
    });
  }

  it("notify-dispatch nao usa `.limit(1)` na busca por numero", () => {
    // O `.limit(1)` e o que tornava o defeito invisivel: com ele o
    // `maybeSingle()` nunca ve duas linhas e nunca reclama.
    const codigo = soCodigo(ler("supabase/functions/notify-dispatch/index.ts"));
    // `fatiaEntre` e nao `slice(indexOf, indexOf)`: com o marcador ausente o
    // recorte a mao devolve quase o arquivo inteiro e o assert passa batendo em
    // outro trecho. O lint `fatiaSemGuarda.test.ts` pegou esta linha na primeira
    // versao deste arquivo — a guarda funcionando contra quem a escreveu.
    const bloco = fatiaEntre(
      codigo,
      'const ref = String((vars as any)?.order_id',
      "if (callerUserId)",
      40,
    );
    expect(bloco, "o `.limit(1)` voltou e esconde a ambiguidade de novo")
      .not.toMatch(/\.limit\(1\)/);
  });
});

describe("a migration que desliga o cron cobre os cinco jobs", () => {
  // SEM comentario nenhum — as DUAS sintaxes do SQL.
  //
  // Duas rodadas de mutante furaram esta funcao, uma de cada vez:
  //   1a — so lia o arquivo cru: comentar a linha com `--` sobrevivia, porque
  //        `-- COMMENT ON TABLE public.sync_state IS` ainda casa a regex;
  //   2a — passou a tirar `--`, mas nao `/* */`: envolver o `DO $$ ... $$;`
  //        inteiro num bloco `/* */` sobrevivia, e a migration desligava ZERO
  //        cron jobs com os tres testes verdes.
  // Guarda que nao distingue SQL de prosa sobre SQL nao prova que o SQL roda.
  const semComentario = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
  const sql = semComentario(ler("supabase/migrations/20260902120000_desliga_cron_b2bwave.sql"));

  it("o corpo executavel da migration nao esta todo comentado", () => {
    // Sem isto, os testes abaixo passam sobre um arquivo inerte.
    expect(sql, "o bloco `DO $$` sumiu ou virou comentario").toMatch(/DO \$\$/);
    expect(sql, "sumiu o `cron.unschedule` — a migration nao desliga nada")
      .toMatch(/cron\.unschedule/);
    expect(sql.trim().length, "sobrou quase nada de SQL executavel").toBeGreaterThan(400);
  });

  // PROVAR QUE EXECUTA, e nao que o texto esta la.
  //
  // Cinco mutantes passaram pelo teste acima deixando a migration inerte, e
  // nenhum deles precisou comentar coisa alguma:
  //   - `RETURN;` logo depois do `BEGIN` — sai antes dos lacos;
  //   - envolver o `DO $$ ... $$;` num `SELECT $inerte$ ... $inerte$;`;
  //   - `IF false AND EXISTS (...)` e `WHERE ... AND false` nos lacos;
  //   - inverter `IF NOT EXISTS (pg_cron)` para `IF EXISTS` — sai cedo
  //     exatamente no banco que TEM pg_cron, que e o unico onde importa;
  //   - trocar os `PERFORM cron.unschedule(_job)` por `RAISE NOTICE`, mantendo o
  //     texto "cron.unschedule" no arquivo.
  //
  // Enumerar mutante perde a corrida (ver `travaReservadoContrato.test.ts`).
  // Estes asserts prendem a ESTRUTURA de controle, que e o que os cinco quebram.
  it("o fluxo do `DO $$` chega mesmo no `cron.unschedule`", () => {
    const iDo = sql.indexOf("DO $$");
    const iFim = sql.indexOf("$$;", iDo);
    expect(iDo, "o bloco `DO $$` sumiu").toBeGreaterThan(-1);
    expect(iFim, "o bloco `DO $$` nao fecha").toBeGreaterThan(iDo);
    const corpo = sql.slice(iDo, iFim);

    // 1. A polaridade do guard de extensao. Invertida, sai cedo justamente onde
    //    ha pg_cron — e nao desliga nada, calado.
    expect(corpo, "o guard de `pg_cron` inverteu a polaridade — sai cedo onde importa")
      .toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\)/);

    // 2. `RETURN` so pode existir DENTRO desse guard. Um `RETURN;` solto depois do
    //    `BEGIN` pula os dois lacos com o arquivo inteiro intacto.
    const retornos = corpo.match(/\bRETURN\s*;/g) ?? [];
    expect(retornos.length, "ha `RETURN;` a mais no bloco — pode estar pulando os lacos")
      .toBe(1);
    const iGuard = corpo.indexOf("IF NOT EXISTS (SELECT 1 FROM pg_extension");
    const iRet = corpo.indexOf("RETURN;");
    const iForeach = corpo.indexOf("FOREACH");
    expect(iRet, "o `RETURN;` saiu de dentro do guard de pg_cron").toBeGreaterThan(iGuard);
    expect(iRet, "ha `RETURN;` ANTES do laco — os jobs nunca sao desligados")
      .toBeLessThan(iForeach);

    // 3. Os dois lacos precisam CHAMAR o unschedule, nao so mencionar.
    const chamadas = corpo.match(/PERFORM cron\.unschedule\(_job\);/g) ?? [];
    expect(chamadas.length, "o `PERFORM cron.unschedule(_job)` virou aviso ou sumiu de um dos lacos")
      .toBe(2);

    // 4. Nenhuma condicao morta. `IF false AND ...` e `WHERE ... AND false` deixam
    //    tudo no lugar e nao rodam nada.
    expect(corpo, "ha um literal `false` no fluxo — condicao morta").not.toMatch(/\bfalse\b/i);
  });

  it("o `DO $$` nao esta embrulhado em outro dollar-quote", () => {
    // `SELECT $inerte$ ... DO $$ ... $$; ... $inerte$;` vira uma STRING: o SQL
    // inteiro fica intacto no arquivo e nao executa. Tag `$...$` que nao seja o
    // `$$` do proprio bloco nao tem motivo de existir aqui.
    const tags = sql.match(/\$[A-Za-z_][A-Za-z0-9_]*\$/g) ?? [];
    expect(tags, "apareceu dollar-quote nomeado — o bloco pode estar virado string")
      .toEqual([]);
  });

  it("nomeia os cinco, inclusive o `categories` que faltou no inventario", () => {
    for (const job of ["orders", "customers", "products", "pricelists", "categories"]) {
      expect(sql, `o job b2bwave-cron-${job} saiu da migration`)
        .toContain(`b2bwave-cron-${job}`);
    }
  });

  it("tem rede de seguranca para job fora da lista", () => {
    // Ja aconteceu uma vez: `categories` foi criado numa migration separada e
    // nao estava no inventario. A varredura por prefixo pega o proximo.
    expect(sql).toMatch(/jobname LIKE 'b2bwave-%'/);
  });

  it("avisa que `sync_state` NAO e residuo do sync", () => {
    // A tabela foi criada pela migration do cron do B2BWave e parece sobra, mas
    // guarda `envio_pausado` — o kill switch de notificacao criado depois dos
    // 1.508 SMS. Dropar por engano desarma a torneira geral em silencio.
    expect(sql, "sumiu o aviso que impede apagarem o kill switch de notificacao")
      .toMatch(/COMMENT ON TABLE public\.sync_state/);
    expect(sql).toMatch(/envio_pausado/);
  });
});
