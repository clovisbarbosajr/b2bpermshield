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
    for (const arq of arquivos) {
      for (const m of soCodigo(ler(arq)).matchAll(/\.invoke\(\s*["'`]([\w-]+)["'`]/g)) {
        if (!existentes.has(m[1])) orfas.push(`${arq}: invoke("${m[1]}")`);
      }
    }
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
    for (const arq of arquivos) {
      const codigo = soCodigo(ler(arq));
      for (const rota of MORTAS) if (codigo.includes(rota)) achados.push(`${arq}: ${rota}`);
    }
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
  const CONSUMIDORES = [
    "supabase/functions/notify-dispatch/index.ts",
    "supabase/functions/_shared/dispatch.ts",
    "supabase/functions/send-email/index.ts",
  ];

  for (const arq of CONSUMIDORES) {
    it(`${arq.split("/").slice(-2).join("/")}: conta as linhas e recusa >1`, () => {
      const codigo = soCodigo(ler(arq));
      const iNumero = codigo.indexOf('.eq("numero"');
      expect(iNumero, "parou de resolver pedido por numero — o teste ficou sem alvo")
        .toBeGreaterThan(-1);

      // Pede a contagem ao PostgREST. Sem isto nao ha como saber que havia duas.
      expect(codigo, "a consulta por numero perdeu o `count: \"exact\"`")
        .toMatch(/count:\s*"exact"/);

      // E a consequencia: recusar. Contar e nao recusar e pior que nao contar,
      // porque parece protegido.
      expect(codigo, "conta as linhas mas nao recusa quando ha mais de uma")
        .toMatch(/(ambiguo|ambiguous)/i);
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
  // SEM os comentarios de `--`. A primeira versao lia o arquivo cru, e um mutante
  // que apenas COMENTAVA o `COMMENT ON TABLE` sobreviveu: a linha
  // `-- COMMENT ON TABLE public.sync_state IS` ainda casa a regex. Guarda que nao
  // distingue SQL de prosa sobre SQL nao prova que o SQL roda.
  const semComentario = (t: string) => t.replace(/^\s*--.*$/gm, "");
  const sql = semComentario(ler("supabase/migrations/20260902120000_desliga_cron_b2bwave.sql"));

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
