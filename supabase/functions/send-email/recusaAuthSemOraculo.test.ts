import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fatiaEntre } from "../../../src/test/fatia";

// ORACULO DE E-MAIL PELA RECUSA (T15)
//
// `password_reset`/`request_magic_link` sao anonimos. E-mail inexistente devolve
// `{success:true}`; e-mail de cliente ativo recusado (cooldown, teto, provedor)
// devolvia `{skipped,blocked,reason}` ou 502 — o formato dizia quem e cliente.
// Para anonimo a recusa agora e a resposta generica; so equipe ve o motivo.
// NADA aqui decide envio: o `if` so troca o objeto de um `return` que ja existia.

// CRLF no checkout do Windows: os marcadores abaixo usam "\n".
const fonte = readFileSync("supabase/functions/send-email/index.ts", "utf8").replace(/\r\n/g, "\n");
const DECL = "const respostaGenericaAuth = () => new Response(JSON.stringify({ success: true }), {";
const GUARDA = "if (AUTENTICACAO.has(type) && !verMotivoDaRecusa) return respostaGenericaAuth();";

describe("send-email: recusa de autenticacao nao vira oraculo", () => {
  it("resposta generica declarada uma vez, antes do primeiro uso, sem copia inline", () => {
    const iDecl = fonte.indexOf(DECL);
    expect(iDecl, "sumiu a declaracao de `respostaGenericaAuth`").toBeGreaterThan(-1);
    expect(fonte.indexOf("respostaGenericaAuth"), "usada antes de declarada").toBe(iDecl + "const ".length);
    expect(fonte.split('JSON.stringify({ success: true })').length - 1, "sobrou `{success:true}` inline").toBe(1);
  });

  it("so equipe ve o motivo (admin/manager/warehouse ou privilegiado)", () => {
    expect(fonte).toContain("const verMotivoDaRecusa = isPrivilegedCaller || isStaffCaller;");
    const consulta = fatiaEntre(fonte, "const { data: staffRow }", "isStaffCaller = !!staffRow;", 4);
    expect(consulta).toContain('"manager"');
    expect(consulta).toContain('"warehouse"');
  });

  const antesDoRetorno = (bloco: string, retorno: string) => {
    const g = bloco.indexOf(GUARDA);
    expect(g, "sumiu a guarda de resposta generica").toBeGreaterThan(-1);
    expect(bloco.indexOf(retorno, g), "a guarda precisa vir ANTES do retorno detalhado").toBeGreaterThan(g);
  };

  it("cooldown por destinatario", () => {
    antesDoRetorno(fatiaEntre(fonte, "if ((count ?? 0) >= 3) {\n          // 200 com `skipped`", "let bloqueio", 12), "skipped: true");
  });

  it("torneira/teto: log gravado, depois guarda, depois retorno; e o bloco ainda retorna", () => {
    const bloco = fatiaEntre(fonte, "if (bloqueio) {", "sendEmailResilient(", 25);
    antesDoRetorno(bloco, "skipped: true");
    const iLog = bloco.indexOf('from("notification_log").insert(');
    expect(iLog, "sumiu o registro do bloqueio").toBeGreaterThan(-1);
    expect(iLog, "o log do bloqueio tem de ser gravado antes da guarda").toBeLessThan(bloco.indexOf(GUARDA));
    expect(bloco.lastIndexOf("return new Response("), "o bloqueio deixou de retornar").toBeGreaterThan(bloco.indexOf(GUARDA));
  });

  it("provedor falhou", () => {
    antesDoRetorno(fatiaEntre(fonte, "if (!result.ok) {\n      console.error", "console.log(`[send-email] Enviado", 8), "status: 502");
  });
});
