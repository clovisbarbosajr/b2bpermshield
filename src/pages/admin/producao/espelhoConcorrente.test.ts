import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";
import { fatiaEntre, fatiaAPartirDe } from "@/test/fatia";

// `numero_container` e a CHAVE do `sync-container-eta`. Escrever nele por engano
// nao aparece na tela: a lista ativa do Status nem exibe essa coluna.
//
// O DEFEITO: `espelharContainer` decidia por `r.numero_container`, o valor
// carregado quando a tela ABRIU, e o UPDATE era incondicional. `load()` so roda
// no mount e depois de um save proprio — nao ha realtime nem polling aqui. Entao
// bastavam dois operadores: B preenche o container real pelo editor, A salva um
// tracking de courier com a tela velha, e o numero do courier ia por cima do
// container. A ETA passava a ser buscada por um numero que nao e de container.

const fonte = readFileSync("src/pages/admin/producao/ProducaoStatus.tsx", "utf8");

describe("ProducaoStatus: o espelho de container decide no BANCO", () => {
  it("existe um caminho unico e condicional", () => {
    expect(fonte).toMatch(/const espelhaContainerSeVazio = async/);
    // Delimitador POSTERIOR, e conferido: fatia ancorada em marcador que vem
    // antes ja passou por construcao neste projeto (indexOf -1 -> fatia enorme).
    const i = fonte.indexOf("const espelhaContainerSeVazio");
    const f = fonte.indexOf("const saveTracking", i);
    expect(f, "delimitador de fim nao veio depois do inicio").toBeGreaterThan(i);
    const fn = fonte.slice(i, f);
    expect(fn, "sem `.is(...)` quem decide volta a ser o estado velho da tela")
      .toContain('.is("numero_container", null)');
    expect(fn, "o UPDATE do container tem que ser SO dele").toContain("numero_container: valor");
    // A ASSERCAO QUE FALTAVA, e a mais cara: sem `.eq("id", id)` este UPDATE
    // grava em TODA linha da tabela com container nulo. A mutacao que removia o
    // WHERE passava verde porque o teste so olhava o `.is(...)`.
    expect(fn, "UPDATE sem WHERE id atinge a tabela inteira").toContain('.eq("id", id)');
    // O retorno vem do BANCO, nao do valor que a tela quis gravar — senao o log
    // volta a afirmar um container que outro operador ja tinha posto.
    expect(fn).toContain("return data?.numero_container ?? null;");
    expect(fn, "erro do 2o UPDATE nao pode sumir").toContain("if (error)");
    // E o ramo de erro devolve NULL. Trocar por `return valor` faz o audit log
    // (que usa este retorno, linhas ~252 e ~273) afirmar um container que o
    // UPDATE nao gravou — o D4 de novo, num lugar diferente.
    const ramoErro = fatiaEntre(fn, "if (error) {", "return data?.numero_container", 12);
    expect(ramoErro, "ramo de erro tem que devolver null").toMatch(/return null;/);
    expect(ramoErro.slice(0, 400), "devolver `valor` aqui faz o log mentir")
      .not.toMatch(/return valor;/);
    expect(fn, "e o operador precisa saber: a coluna nem aparece na lista ativa")
      .toContain("the container could not be filled in");
  });

  it("os dois chamadores usam o caminho condicional", () => {
    for (const handler of ["const saveTracking", "const goOnTheWay"]) {
      const i = fonte.indexOf(handler);
      expect(i, `sumiu ${handler}`).toBeGreaterThan(-1);
      const corpo = fonte.slice(i, i + 1400);
      expect(corpo, `${handler} voltou a gravar o container direto`)
        .toContain("espelhaContainerSeVazio(r.id");
    }
  });

  it("nenhum UPDATE grava `numero_container` fora do caminho condicional", () => {
    // O editor completo (`saveEdit`) tem o proprio campo de container, digitado
    // pelo admin — esse e legitimo. O que nao pode voltar e o espelho AUTOMATICO
    // entrar num update junto com tracking/status.
    expect(fonte, "espelho automatico nao pode viajar no mesmo patch do tracking")
      .not.toMatch(/\.\.\.\(espelhoContainer \? \{ numero_container/);
    expect(fonte).not.toMatch(/patch\.numero_container = /);
  });

  it("o log de atividade so registra o container que REALMENTE foi gravado", () => {
    // Antes o log afirmava o espelho mesmo quando outro ja tinha preenchido.
    const i = fonte.indexOf("const saveTracking");
    const corpo = fonte.slice(i, i + 1400);
    expect(corpo).toMatch(/const container = await espelhaContainerSeVazio/);
    expect(corpo).toMatch(/\.\.\.\(container \? \{ container \} : \{\}\)/);
  });
});
