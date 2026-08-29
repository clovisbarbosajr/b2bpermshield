import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync } from "node:fs";

// A tela de pedido e aberta por admin, manager E warehouse: `App.tsx` a protege
// com `requiredRole="staff"` e `ProtectedRoute` trata os tres como staff. O botao
// Resend nunca teve checagem de papel — mas o `send-email` tem:
//
//   * `toOverride` exige `isPrivilegedCaller`, que so e verdadeiro para role
//     'admin' (`user_roles`), entao "To email" dava 403 para os outros dois;
//   * o gate anti-relay recusa qualquer envio CUSTOMER_FACING cujo destinatario
//     nao seja um e-mail do proprio solicitante — o do cliente nao e — entao "To
//     customer" tambem dava 403.
//
// Duas das tres opcoes eram caminho MORTO para manager e warehouse. Ficam
// desabilitadas com o motivo a vista, e nao escondidas: nao se perde capacidade
// nenhuma (ela ja nao existia) e o operador precisa saber a quem pedir.
//
// Se um dia o dono decidir que manager pode reenviar, a mudanca e no `send-email`
// PRIMEIRO — soltar so esta trava devolve o 403 silencioso.

const fonte = readFileSync("src/pages/admin/OrderDetail.tsx", "utf8");

describe("Resend: as opcoes que exigem admin", () => {
  it("`ehAdmin` sai do papel do usuario", () => {
    expect(fonte).toMatch(/const ehAdmin = role === "admin"/);
  });

  it("'To customer' e 'To email' so para admin", () => {
    const modal = fonte.slice(fonte.indexOf("<DialogTitle>Resend order</DialogTitle>"));
    const corpo = modal.slice(0, modal.indexOf("</Dialog>"));
    expect(corpo, "sem isto o manager marca, envia e leva 403")
      .toMatch(/checked=\{resend\.customer\} disabled=\{!cliente\?\.email \|\| !ehAdmin\}/);
    expect(corpo).toMatch(/checked=\{resend\.other\} disabled=\{!ehAdmin\}/);
    // O campo de e-mail junto: deixar o input ativo com a caixa travada e convite
    // a digitar um endereco que nunca vai receber nada.
    expect(corpo).toMatch(/placeholder="name@company\.com" disabled=\{!ehAdmin\}/);
    expect(corpo, "o operador precisa saber por que esta travado")
      .toMatch(/admin only/);
  });

  it("'To admin' NAO e travado — e a unica que funciona para staff", () => {
    const modal = fonte.slice(fonte.indexOf("<DialogTitle>Resend order</DialogTitle>"));
    const corpo = modal.slice(0, modal.indexOf("</Dialog>"));
    const linhaAdmin = corpo.slice(corpo.indexOf("checked={resend.admin}"));
    expect(linhaAdmin.slice(0, 200)).not.toMatch(/disabled=\{!ehAdmin\}/);
  });
});
