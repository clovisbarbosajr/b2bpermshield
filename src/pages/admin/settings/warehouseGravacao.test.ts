import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";

const fonte = readFileSync("src/pages/admin/settings/WarehouseSettings.tsx", "utf8");

describe("WarehouseSettings: leitura honesta e gravacao sem lost update", () => {
  // O `error` da RPC era descartado: com ela falhando, `data` vinha undefined, o
  // `if (data)` nao entrava e a tela renderizava o ESTADO INICIAL do componente
  // como se fosse o do banco — popup ligado, Monday, 5 e 480 minutos, e a
  // mensagem VAZIA, que nem e o texto padrao. O admin lia numeros inexistentes.
  it("erro da `config_staff` fecha a tela em vez de mostrar os defaults do codigo", () => {
    expect(fonte).toContain("const { data: rows, error } = await (supabase as any).rpc(\"config_staff\")");
    expect(fonte).toMatch(/if \(error\) \{\s*\n\s*setErro\(/);
    expect(fonte, "sem o ramo de erro no render, o form em branco convida a salvar lixo")
      .toContain("Settings could not be loaded — nothing is being shown or saved.");
    expect(fonte, "e tem que haver caminho de volta").toMatch(/onClick=\{\(\) => fetchData\(\)\}/);
  });

  // As cinco colunas iam cegas, com o `form` carregado no mount: A abre e nao
  // toca em nada, B troca o dia do popup e salva, A clica Save e devolve o valor
  // velho. `diffConfig` ja resolve isso em Profile e SetupApp, na MESMA tabela.
  it("o Save manda so o que ESTE admin mudou", () => {
    expect(fonte).toContain('import { diffConfig } from "@/lib/diffConfig"');
    expect(fonte).toMatch(/const payload = diffConfig\(salvo, \{/);
    expect(fonte, "payload vazio nao pode virar UPDATE")
      .toContain('if (Object.keys(payload).length === 0) { toast.info("Nothing to save"); return; }');
    expect(fonte, "o UPDATE tem que usar o payload, nao o form inteiro")
      .toMatch(/\.from\("configuracoes"\)\.update\(payload\)/);
  });

  it("o espelho reflete o que a TELA mostra, nao o cru do banco", () => {
    // Com `?? null` no espelho e o texto padrao no form, o diff acusaria mudanca
    // em campo que o admin nem viu.
    const espelho = fonte.slice(fonte.indexOf("setSalvo({"), fonte.indexOf("setForm({"));
    expect(espelho).toContain("It's Monday!");
  });

  it("depois de gravar, recarrega — senao o segundo Save compara com o estado velho", () => {
    const fim = fonte.slice(fonte.indexOf('toast.success("Warehouse settings saved.")'));
    expect(fim.slice(0, 400)).toContain("fetchData()");
  });

  // Continua valendo o que ja existia: manager passa pela RLS afetando ZERO
  // linhas e o supabase-js volta sem erro.
  it("nao afirma 'saved' quando o UPDATE nao pegou linha nenhuma", () => {
    expect(fonte).toMatch(/if \(!gravado \|\| gravado\.length === 0\)/);
    expect(fonte).toContain("Nothing was saved — only an administrator can change warehouse settings.");
  });
});
