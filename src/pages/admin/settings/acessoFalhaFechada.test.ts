import { describe, it, expect } from "vitest";
// `tsconfig.app.json` declara `"types": ["vitest/globals"]`, entao os tipos do Node
// nao entram e o `tsc --noEmit` do `npm test` nao acha `node:fs`. Em execucao o
// modulo existe (vitest roda em Node).
// @ts-expect-error
import { readFileSync } from "node:fs";

// TESTE DE FIACAO, no formato de `tools/importadoresGravacaoReal.test.ts`: as
// guardas moram DENTRO de componentes de pagina, e importar o modulo arrastaria
// layout, router, contexto de auth e o cliente Supabase. O que da para afirmar
// sem montar a tela e a FORMA da leitura e da gravacao — que e exatamente o que
// uma reversao apaga.
//
// O QUE ELE PROTEGE:
//
//  1. `UsersManagement.openEdit` lia `user_locations` descartando o `error`.
//     Leitura falhada virava Set vazio, e o Save chamava
//     `set_user_locations(user, [])`. Lista vazia NAO e "sem acesso": a policy
//     de `categorias` (20260619220000) libera TUDO quando o usuario nao tem
//     linha em `user_locations`. Um erro de rede promovia o funcionario
//     restrito a ver todas as localizacoes, com "User updated" na tela.
//  2. A mesma funcao abria o dialogo com dados que podiam ser de OUTRO usuario:
//     clicar Edit em A, clicar em B, e a resposta de A chegar por ultimo. O
//     Save gravava os locais de A na conta de B.
//  3. `PrivacyGroups.handleDelete` apagava o grupo perguntando so "Delete this
//     privacy group?". As tres FKs que apontam para `privacy_groups`
//     (cliente_privacy_groups, categoria_acesso, produto_acesso) sao ON DELETE
//     CASCADE: iam junto, sem volta, todos os vinculos de cliente e todas as
//     liberacoes de categoria/produto.

const ler = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), "utf8");

/** Sem as linhas de comentario — senao o proprio comentario que EXPLICA o defeito
 *  antigo faz o teste achar que o defeito continua la. */
const soCodigo = (fonte: string) =>
  fonte.split("\n").filter((l: string) => !l.trim().startsWith("//")).join("\n");

describe("telas de acesso falham fechado", () => {
  it("UsersManagement le user_locations checando o erro e so entao abre o dialogo", () => {
    const fonte = soCodigo(ler("./UsersManagement.tsx"));

    // O `error` da leitura tem que ser capturado...
    expect(fonte).toMatch(
      /const\s*{\s*data:\s*locs,\s*error:\s*locErr\s*}\s*=\s*await\s+supabase\s*\n?\s*\.from\("user_locations"\)/,
    );
    // ...e barrar a abertura do editor. Sem `return`, o Set vazio ainda chega ao Save.
    expect(fonte).toMatch(/if\s*\(locErr\)\s*{[\s\S]{0,300}?return;/);

    // Guarda de corrida: so o clique mais recente escreve no dialogo.
    expect(fonte).toMatch(/const\s+req\s*=\s*\+\+editReq\.current/);
    expect(fonte).toMatch(/if\s*\(req\s*!==\s*editReq\.current\)\s*return;/);

    // E nada de setState antes das duas guardas: `setEditOpen(true)` so pode
    // aparecer DEPOIS delas no corpo da funcao.
    const abre = fonte.indexOf("setEditOpen(true)");
    const guarda = fonte.indexOf("if (req !== editReq.current) return;");
    expect(guarda).toBeGreaterThan(-1);
    expect(abre).toBeGreaterThan(guarda);
  });

  it("UsersManagement nao pinta lista vazia quando a leitura de papeis falha", () => {
    const fonte = soCodigo(ler("./UsersManagement.tsx"));
    expect(fonte).toMatch(/const\s*{\s*data:\s*roles,\s*error:\s*rolesErr\s*}/);
    expect(fonte).toMatch(/if\s*\(rolesErr\)\s*{[\s\S]{0,300}?return;/);
  });

  it("PrivacyGroups conta o que cascateia antes de apagar, e recusa se nao conseguiu contar", () => {
    const fonte = soCodigo(ler("./PrivacyGroups.tsx"));

    // As tres tabelas com ON DELETE CASCADE precisam ser contadas.
    for (const t of ["cliente_privacy_groups", "categoria_acesso", "produto_acesso"]) {
      expect(fonte).toContain(`"${t}"`);
    }
    expect(fonte).toMatch(/count:\s*"exact",\s*head:\s*true/);

    // Contagem falhou => nao apaga.
    expect(fonte).toMatch(/if\s*\(contagemErr\)\s*{[\s\S]{0,300}?return;/);

    // E o DELETE vem depois do confirm, nao antes.
    const confirma = fonte.indexOf("if (!confirm(");
    const apaga = fonte.indexOf('.from("privacy_groups").delete()');
    expect(confirma).toBeGreaterThan(-1);
    expect(apaga).toBeGreaterThan(confirma);
  });

  it("PrivacyGroups nao reativa grupo desativado ao salvar edicao", () => {
    const fonte = soCodigo(ler("./PrivacyGroups.tsx"));
    // `ativo` so pode aparecer no INSERT. Se voltar para o payload comum, o
    // UPDATE devolve aos seletores (`.eq("ativo", true)`) um grupo aposentado.
    expect(fonte).not.toMatch(/const\s+payload\s*=\s*{[^}]*ativo/);
    expect(fonte).toMatch(/\.insert\(\{\s*\.\.\.payload,\s*ativo:\s*true\s*\}\)/);
  });
});
