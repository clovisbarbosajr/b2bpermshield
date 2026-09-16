import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fatiaEntre } from "../../../src/test/fatia";
import { REQUIRED, MAX_LEN } from "../../../src/lib/cadastroCliente";

// FICHA COMPLETA NO AUTO-CADASTRO (T24)
//
// A edge passa a gravar telefone/endereco/etc. na ficha NOVA. Tres coisas nao
// podem mudar: dado invalido e recusado SEM tocar no banco (antes de
// `registration_is_open`, senao a resposta dependeria do estado do e-mail);
// os ramos "ja tem ficha"/"vinculou" nao sobrescrevem a ficha de ninguem; e
// nenhum envio novo nasce daqui.

// CRLF no checkout do Windows: os marcadores abaixo usam "\n".
const fonte = readFileSync("supabase/functions/register-customer/index.ts", "utf8").replace(/\r\n/g, "\n");
const COLUNAS = ["telefone", "activity", "endereco", "endereco2", "cidade", "estado", "pais", "cep"];

describe("register-customer: ficha completa", () => {
  it("400 de dado invalido vem antes de registration_is_open, sem consulta no meio", () => {
    const antes = fatiaEntre(fonte, 'return json({ error: "valid email required" }, 400);', 'db.rpc("registration_is_open")', 40);
    const guarda = 'if (invalido) return json({ error: "invalid registration data" }, 400);';
    expect(antes, "a validacao 400 tem de vir antes de registration_is_open").toContain(guarda);
    expect(fatiaEntre(antes, "const REQUIRED", guarda, 20)).not.toMatch(/\bdb\.|await /);
  });

  it("o insert da ficha nova grava as 8 colunas", () => {
    const insert = fatiaEntre(fonte, 'db.from("clientes").insert({', "}).select(", 8);
    for (const c of COLUNAS) expect(insert, `insert sem ${c}`).toContain(`${c}: ${c} || null`);
    expect(insert).toContain('status: "pendente"');
  });

  it("ramos byUser/byEmail nao gravam os campos novos", () => {
    const ramos = fatiaEntre(fonte, "const { data: byUser }", "// 4) Cria a ficha PENDENTE", 15);
    for (const c of COLUNAS) expect(ramos, `ramo de vinculo tocou ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
  });

  it("nenhum envio novo: 3 fetch, como no HEAD anterior", () => {
    expect(fonte.split("fetch(").length - 1).toBe(3);
  });

  it("REQUIRED/MAX_LEN da edge iguais aos do helper", () => {
    const req = fonte.match(/const REQUIRED = (\[[^\]]*\]);/);
    const max = fonte.match(/const MAX_LEN = (\{[^}]*\});/);
    expect(req && max, "sumiram as constantes da edge").toBeTruthy();
    const lit = (s: string) => Function(`return ${s}`)();
    const semLogin = REQUIRED.filter((k) => !["email", "password", "passwordConfirm"].includes(k));
    expect([...lit(req![1])].sort()).toEqual([...semLogin].sort());
    expect(lit(max![1])).toEqual(MAX_LEN);
  });
});
