import { describe, it, expect } from "vitest";
// Mesma nota de `admin/conteudoErroDeLeitura.test.ts`: `tsconfig.app.json`
// declara `"types": ["vitest/globals"]`, entao os tipos do Node nao entram e o
// `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o modulo existe.
// @ts-expect-error
import { readFileSync } from "node:fs";

// TESTE DE FIACAO das telas de ENTRADA (montar a tela exigiria
// `@testing-library/dom`, que nao esta instalado).
//
// O QUE ELE PROTEGE — tres afirmacoes que o codigo nao sabia sustentar:
//
// 1. PendingApproval: `const { data } = ...` sem `error`. Leitura falhando
//    caia no padrao `pendente` e a tela dizia "vamos aprovar em breve" para
//    quem estava REJEITADO ou SUSPENSO.
// 2. Cadastro: `invoke("register-customer").catch(() => {})` — dois descartes
//    no mesmo await. Falha ali = sem ficha em `clientes` e sem aviso ao admin,
//    com "cadastro recebido" na tela.
// 3. RecuperarSenha: "Email sent" mesmo quando `send-email` devolve
//    `{success:true}` por e-mail inexistente ou por limite de 15 min.

const ler = (arquivo: string) =>
  readFileSync(new URL(arquivo, import.meta.url), "utf8");

describe("telas de entrada: nao afirmar o que o codigo nao sabe", () => {
  it("PendingApproval.tsx: le o error do select de clientes e tem estado proprio", () => {
    const fonte = ler("./PendingApproval.tsx");
    const then = fonte.match(/\.then\(\(\{[^}]*\}\) =>/);
    expect(then, "nao achei o .then do select de clientes").toBeTruthy();
    // Este e o assert que morre se alguem voltar ao `.then(({ data }) =>`.
    expect(then![0]).toMatch(/\{ data, error \}/);
    expect(fonte).toMatch(/if \(error\) \{[\s\S]*?setErroLeitura\(true\);[\s\S]*?return;/);
    // O ramo de erro tem que VENCER o mapa de status, senao volta a mentir.
    expect(fonte).toMatch(/erroLeitura\s*\?\s*config\["desconhecido"\]/);
  });

  it("PendingApproval.tsx: `pendente` vence `is_active`, e `inativo` nao vira 'pendente'", () => {
    const fonte = ler("./PendingApproval.tsx");
    // `cliente_status` = ativo | inativo | pendente.
    // (1) `inativo` sem entrada caia no fallback `config["pendente"]`: conta
    //     desativada era informada de que o cadastro ainda ia ser aprovado.
    // (2) `is_active` testado primeiro fazia o cliente IMPORTADO — que nasce
    //     `pendente` + `is_active:false` — ler "sua conta foi suspensa".
    const mapa = fonte.match(/const st = data\.status[\s\S]*?\);/);
    expect(mapa, "nao achei o mapa de status").toBeTruthy();
    const pendenteAntes = mapa![0].indexOf('st === "pendente"');
    const isActiveDepois = mapa![0].indexOf("data.is_active === false");
    expect(pendenteAntes, "o ramo `pendente` sumiu").toBeGreaterThan(-1);
    expect(isActiveDepois, "o ramo `is_active` sumiu").toBeGreaterThan(-1);
    expect(pendenteAntes).toBeLessThan(isActiveDepois);
    expect(mapa![0]).toMatch(/st === "inativo"/);
  });

  it("PendingApproval.tsx: status lido sem entrada nao vira 'aprovacao pendente'", () => {
    const fonte = ler("./PendingApproval.tsx");
    // Ficha `ativo` que chega aqui foi bloqueada de FORA (empresa suspensa, ou
    // sem linha em user_roles). O fallback antigo era `config["pendente"]` e
    // mandava essa pessoa esperar uma aprovacao que ja aconteceu.
    expect(fonte).toMatch(/config\[clienteStatus\] \?\? config\["sem_acesso"\]/);
    // Ficha ainda NAO lida continua "pendente" — o fallback nao pode engolir isso.
    expect(fonte).toMatch(/clienteStatus === null\s*\?\s*config\["pendente"\]/);
  });

  it("Cadastro.tsx: o erro do register-customer nao e engolido", () => {
    const fonte = ler("./Cadastro.tsx");
    const invoke = fonte.match(/const \{ error: fichaErr \}[\s\S]*?setFichaFalhou\(true\);/);
    expect(invoke, "nao achei o invoke de register-customer com o error lido").toBeTruthy();
    // O catch tem que DEVOLVER o erro, nao engoli-lo: um catch vazio no invoke
    // apagava a falha de rede antes de o `error` sequer ser lido. (Assert no
    // trecho, nao no arquivo: o comentario acima do invoke cita o catch vazio.)
    expect(invoke![0]).toMatch(/\.catch\(\(e: unknown\) => \(\{ error: e \}\)\)/);
    // E a tela precisa CONTAR quando falhou.
    expect(fonte).toMatch(/fichaFalhou && \(/);
  });

  it("RecuperarSenha.tsx: nao afirma que o e-mail foi enviado", () => {
    const fonte = ler("./RecuperarSenha.tsx");
    expect(fonte).not.toMatch(/<CardTitle>Email sent<\/CardTitle>/);
    expect(fonte).toMatch(/If an account exists for that address/);
  });
});
