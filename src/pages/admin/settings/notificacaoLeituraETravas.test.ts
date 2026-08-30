import { describe, it, expect } from "vitest";
// Mesma nota de `conteudoErroDeLeitura.test.ts`: `tsconfig.app.json` declara
// `"types": ["vitest/globals"]`, entao os tipos do Node nao entram e o
// `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o modulo existe.
// @ts-expect-error
import { readFileSync } from "node:fs";
import { fatiaEntre, fatiaAPartirDe } from "@/test/fatia";

// TESTE DE FIACAO das telas de notificacao e sync (montar a tela exigiria
// `@testing-library/dom`, que nao esta instalado).
//
// O QUE ELE PROTEGE, depois dos 1.508 SMS de 25/ago:
//  1. leitura que falha nao pode virar afirmacao ("nada foi enviado", "nao ha
//     template salvo", "nao ha pedido", "nenhum bloqueio");
//  2. o motivo de um envio recusado vem do SERVIDOR, nao de um diagnostico
//     colado na tela;
//  3. o botao que PODE disparar notificacao pede confirmacao antes.

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

describe("NotificacoesLog: falha de leitura nao vira 'nada foi enviado'", () => {
  const fonte = ler("./NotificacoesLog.tsx");

  // A tela passou a fazer DUAS leituras (entrega × registro de sistema, que grava
  // `channel = '-'` e nunca foi tentativa de envio) em vez de uma so `.limit(200)`
  // cega. A invariante nao mudou — falha de leitura NAO pode virar "nada foi
  // enviado" — mas o formato do `const { data, error }` deixou de existir, entao o
  // assert antigo passou a procurar uma forma que a correcao removeu.
  it("as duas leituras de notification_log alimentam o erro, e nenhuma e descartada", () => {
    const leituras = fonte.match(/sb\.from\('notification_log'\)/g) ?? [];
    expect(leituras.length, "nao achei as leituras de notification_log").toBe(2);
    // O que importa: o `error` de QUALQUER uma das duas vira banner. Descartar o
    // da segunda deixava a lista de sistema vazia afirmando que nao ha registro.
    expect(fonte, "o error das duas leituras nao alimenta o banner")
      .toMatch(/entregas\.error \?\? diagnostico\.error/);
    expect(fonte, "a falha deixou de virar banner").toMatch(/if \(falha\) \{ setErro\(falha\.message\)/);
    // E TEM QUE ESVAZIAR AS DUAS LISTAS na falha: manter a lista velha na tela sob
    // um banner de erro e a mesma mentira com outra roupa.
    expect(fonte, "a falha nao esvazia as duas listas")
      .toMatch(/setErro\(falha\.message\); setEnvios\(\[\]\); setSistema\(\[\]\);/);
  });

  it("a resposta atrasada nao sobrescreve a mais nova nem apaga o banner de erro", () => {
    // Ha um botao "Atualizar". Dois cliques com rede lenta: a leitura VELHA
    // bem-sucedida chegando depois de uma que falhou apagava o banner e mostrava
    // dados — exatamente a mentira que esta tela existe para impedir.
    expect(fonte, "sumiu a guarda de ordem das cargas").toMatch(/const cargaSeq = useRef\(0\)/);
    expect(fonte, "a carga nao reivindica mais o proprio numero")
      .toMatch(/const minha = \+\+cargaSeq\.current/);
    // A comparacao tem que vir DEPOIS do await e ABORTAR.
    const guarda = fonte.match(/if \(minha !== cargaSeq\.current\) return;/);
    expect(guarda, "a guarda de ordem nao aborta mais a carga velha").toBeTruthy();
    expect(fonte.indexOf("await Promise.all"), "a guarda de ordem esta antes do await — nao guarda nada")
      .toBeLessThan(fonte.indexOf("if (minha !== cargaSeq.current) return;"));
  });

  it("o ramo de erro vem antes do estado vazio", () => {
    const erro = fonte.indexOf(") : erro ? (");
    const vazio = fonte.indexOf("envios.length === 0 ? (");
    expect(erro, "nao achei o ramo de erro").toBeGreaterThan(-1);
    expect(vazio, "nao achei o estado vazio").toBeGreaterThan(-1);
    expect(erro).toBeLessThan(vazio);
  });
});

describe("Notificacoes: leituras que alimentam envio e gravacao", () => {
  const fonte = ler("./Notificacoes.tsx");

  it("email_templates: le o error e o Save falha FECHADO", () => {
    const select = fonte.match(/const \{[^}]*\} = await sb\.from\('email_templates'\)\.select\([^;]*;/);
    expect(select, "nao achei o select de email_templates").toBeTruthy();
    expect(select![0]).toMatch(/error: tplErr/);
    expect(fonte).toMatch(/setTypeTplLoadError\(tplErr \? tplErr\.message : null\)/);
    // O Save sem `id` faz INSERT: com a leitura falhada ele criaria uma segunda
    // linha para o mesmo `tipo`, por cima de um template que existe.
    const save = fatiaAPartirDe(fonte, "async function saveTypeTemplate");
    const guarda = save.indexOf("if (typeTplLoadError)");
    const insert = save.indexOf(".insert(");
    expect(guarda, "saveTypeTemplate perdeu a guarda de leitura falhada").toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(insert);
  });

  it("o badge 'using system default' nao aparece quando a leitura falhou", () => {
    expect(fonte).toMatch(/\{!t\.corpo && !typeTplLoadError &&/);
  });

  it("o preview do email de pedido le o error do select de pedidos", () => {
    const bloco = fatiaAPartirDe(fonte, "async function handleEmailOrderPreview");
    const select = bloco.match(/const \{[^}]*\} = await sb\.from\('pedidos'\)[^;]*;/);
    expect(select, "nao achei o select de pedidos do preview").toBeTruthy();
    expect(select![0]).toMatch(/error: pedErr/);
    // A guarda do erro tem que vir ANTES da mensagem de "nao ha pedido": e
    // exatamente a diferenca entre "falhou a leitura" e "nao ha nada".
    expect(fatiaEntre(bloco, "const {", "No orders found to preview"))
      .toMatch(/if \(pedErr\)/);
  });

  it("sendEventTest so manda o email real depois de ler o cliente sem erro", () => {
    const bloco = fatiaEntre(fonte, "async function sendEventTest", "async function saveEvent");
    const select = bloco.match(/const \{[^}]*\} = await sb\.from\('clientes'\)[^;]*;/);
    expect(select, "nao achei o select de clientes").toBeTruthy();
    expect(select![0]).toMatch(/error: cliErr/);
    const guarda = bloco.indexOf("if (cliErr)");
    const envio = bloco.indexOf("functions.invoke('send-email'");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(envio);
  });

  it("ensureConfigId separa 'nao consegui ler' de 'nao existe'", () => {
    const bloco = fatiaEntre(fonte, "async function ensureConfigId", "// MASTER SWITCH");
    expect(bloco).toMatch(/const \{ data, error \}/);
    expect(bloco).toMatch(/Could not read the configuration/);
    expect(bloco).toMatch(/Configuration not found/);
  });
});

describe("EmailSettings: o motivo do envio recusado vem do servidor", () => {
  const fonte = ler("./EmailSettings.tsx");

  it("usa data.reason e nao um diagnostico unico colado na tela", () => {
    const bloco = fatiaEntre(fonte, "} else if (data?.skipped)", "} catch (err: any)");
    expect(bloco).toMatch(/data\.reason/);
    // send-email tambem devolve `skipped` para a torneira geral e para o teto
    // por e-mail — nem todo `skipped` e "desligado nas configuracoes".
    expect(bloco).not.toMatch(/is disabled in notification settings/);
  });
});

describe("B2BWaveSync: o botao que pode notificar avisa antes", () => {
  const fonte = ler("./B2BWaveSync.tsx");

  it("syncAllOrders pede confirmacao ANTES de comecar", () => {
    const bloco = fatiaEntre(fonte, "const syncAllOrders", "const stopOrderSync");
    const pergunta = bloco.indexOf("if (!confirm(");
    const comeco = bloco.indexOf("setOrderSyncing(true)");
    expect(pergunta, "syncAllOrders perdeu a confirmacao").toBeGreaterThan(-1);
    expect(pergunta).toBeLessThan(comeco);
    expect(bloco.slice(pergunta, comeco)).toMatch(/48 HORAS/);
  });

  // O TETO E DE VOLUME DE NOTIFICACAO, e por isso este teste olha o CATCH e nao o
  // bloco inteiro.
  //
  // A primeira versao daqui so exigia que as strings `falhasSeguidas >= 5` e
  // `falhasSeguidas = 0;` existissem em algum lugar da funcao. Apagar o
  // `falhasSeguidas++` do catch mantinha as duas: o contador ficava preso em 0, a
  // condicao nunca disparava, e o `while` voltava a chamar `sync-b2bwave` a cada
  // 2s enquanto a aba ficasse aberta — numa acao que PODE notificar pedido novo.
  // O teste passava. E o mesmo vetor de volume dos 1.508 SMS de 25/ago.
  it("a retentativa tem teto — erro permanente nao vira laco infinito", () => {
    const bloco = fatiaEntre(fonte, "const syncAllOrders", "const stopOrderSync");

    const iCatch = bloco.indexOf("} catch (err");
    expect(iCatch, "syncAllOrders perdeu o catch do laco").toBeGreaterThan(-1);
    const catchBloco = bloco.slice(iCatch);

    // 1) o contador PRECISA andar, e antes da comparacao — senao o teto e enfeite
    const iInc = catchBloco.indexOf("falhasSeguidas++");
    const iTeto = catchBloco.indexOf("falhasSeguidas >= 5");
    expect(iInc, "o catch nao incrementa `falhasSeguidas` — o teto nunca dispara").toBeGreaterThan(-1);
    expect(iTeto, "o catch nao compara com o teto").toBeGreaterThan(-1);
    expect(iInc, "`falhasSeguidas++` tem que vir ANTES da comparacao").toBeLessThan(iTeto);

    // 2) bater no teto tem que SAIR do laco, nao so avisar
    expect(catchBloco.slice(iTeto, iTeto + 400), "bater no teto nao interrompe o laco").toMatch(/break;/);

    // 3) o reset fica no caminho de SUCESSO. Se estivesse no catch, cada falha
    //    zeraria o contador e o teto nunca seria alcancado.
    expect(bloco.slice(0, iCatch), "o reset de `falhasSeguidas` sumiu do caminho de sucesso").toMatch(/falhasSeguidas = 0;/);
  });

  it("le o error do sync_log — sem ele o aviso BLOQUEIO_ some calado", () => {
    const bloco = fatiaEntre(fonte, "const fetchLastRuns", "useEffect(() => { fetchLastRuns()");
    expect(bloco).toMatch(/find\(\(r: any\) => r\?\.error\)/);
    expect(bloco).toMatch(/setLastRunsErro\(erro \? erro\.message : null\)/);
    expect(fonte).toMatch(/N[aã]o consegui ler o hist[oó]rico de sincroniza[cç][aã]o/);
  });

  it("o painel busca cada acao conhecida, nao so as 50 linhas mais novas", () => {
    // O cron de `orders` grava a cada 15 min; sem a consulta por acao, a ultima
    // rodada de `products` sai da janela de 50 e some do painel calada.
    const bloco = fatiaEntre(fonte, "const fetchLastRuns", "useEffect(() => { fetchLastRuns()");
    for (const acao of ["orders", "products", "customers", "sync_orders_backfill"]) {
      expect(bloco, `a acao ${acao} saiu da busca por acao`).toContain(`"${acao}"`);
    }
    expect(bloco).toMatch(/\.eq\("action", a\)\.limit\(1\)/);
  });

  it("nao mostra contador que ninguem alimenta", () => {
    expect(fonte).not.toMatch(/orderTotalItems/);
  });
});
