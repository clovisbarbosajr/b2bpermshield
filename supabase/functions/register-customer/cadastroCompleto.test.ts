import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fatiaEntre } from "../../../src/test/fatia";
import { MAX_LEN as MAX_LEN_TELA, montarFicha, type CadastroForm } from "../../../src/lib/cadastroCliente";
import { lerFicha, CAMPOS_FICHA, MAX_LEN } from "../_shared/fichaCadastro.ts";

// FICHA COMPLETA NO AUTO-CADASTRO (T24)
//
// A edge grava telefone/endereco/etc. na ficha NOVA. O que nao pode mudar:
// o corpo ANTIGO ({email,nome,empresa}, aba aberta antes do deploy) continua
// criando ficha; dado grande demais e recusado SEM tocar no banco; os ramos
// "ja tem ficha"/"vinculou" nao sobrescrevem ninguem; nenhum envio novo nasce daqui.

// CRLF no checkout do Windows: os marcadores abaixo usam "\n".
const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
// Sem comentarios: eles citam `db.`, `await` e "ficha" e dariam falso positivo.
const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const fonte = semComentario(ler("supabase/functions/register-customer/index.ts"));

describe("lerFicha (a regra, exercitada)", () => {
  it("corpo da tela ANTIGA ({email,nome,empresa}) e valido — senao signUp sem ficha e sem aviso ao admin", () => {
    const r = lerFicha({ email: "a@b.com", nome: "Jane", empresa: "Acme" });
    expect(r.invalido).toBe(false);
    for (const k of CAMPOS_FICHA) expect(r.ficha[k]).toBeNull();
  });

  it("trim e vazio -> null", () => {
    const r = lerFicha({ email: "a@b.com", telefone: "  555  ", endereco2: "   ", cidade: undefined });
    expect(r.ficha.telefone).toBe("555");
    expect(r.ficha.endereco2).toBeNull();
    expect(r.ficha.cidade).toBeNull();
  });

  const limites: [string, number][] = [
    ...CAMPOS_FICHA.map((k): [string, number] => [k, (MAX_LEN as Record<string, number>)[k] ?? MAX_LEN.texto]),
    ["nome", MAX_LEN.texto], ["empresa", MAX_LEN.texto],
  ];
  it.each(limites)("limite de %s: N passa, N+1 recusa", (k, n) => {
    expect(lerFicha({ email: "a@b.com", [k]: "x".repeat(n) }).invalido).toBe(false);
    expect(lerFicha({ email: "a@b.com", [k]: "x".repeat(n + 1) }).invalido).toBe(true);
  });

  it("e-mail acima de 254 recusa", () => {
    expect(lerFicha({ email: `${"x".repeat(248)}@b.com` }).invalido).toBe(false);
    expect(lerFicha({ email: `${"x".repeat(249)}@b.com` }).invalido).toBe(true);
  });

  it("limites da edge iguais aos da tela (senao a tela aceita e a edge recusa depois do signUp)", () => {
    expect(MAX_LEN).toEqual(MAX_LEN_TELA);
  });
});

describe("register-customer: fiacao da edge", () => {
  it("400 vem antes de registration_is_open, sem consulta no meio", () => {
    const antes = fatiaEntre(fonte, 'return json({ error: "valid email required" }, 400);', 'db.rpc("registration_is_open")', 60);
    expect(antes).toMatch(/const \{ ficha, invalido \} = lerFicha\(body\);\s*if \(invalido\) return json\(\{ error: "invalid registration data" \}, 400\);/);
    const guarda = 'if (invalido) return json({ error: "invalid registration data" }, 400);';
    expect(fatiaEntre(antes, "valid email required", guarda, 10)).not.toMatch(/\bdb\.|await /);
  });

  it("o insert da ficha nova espalha a ficha lida", () => {
    const insert = fatiaEntre(fonte, 'db.from("clientes").insert({', "}).select(", 8);
    expect(insert).toContain("...ficha,");
    // nome/empresa gravados com trim (o limite de `lerFicha` mede sem as pontas)
    expect(fonte).toContain('const nome = String(body.nome ?? "").trim(), empresa = String(body.empresa ?? "").trim();');
    expect(insert).not.toMatch(/\b(telefone|activity|endereco2?|cidade|estado|pais|cep)\s*:/);
    expect(insert).toContain('status: "pendente"');
  });

  it("ramos byUser/byEmail nao gravam os campos novos", () => {
    const ramos = fatiaEntre(fonte, "const { data: byUser }", 'const { data: created, error } = await db.from("clientes").insert({', 15);
    for (const c of CAMPOS_FICHA) expect(ramos, `ramo de vinculo tocou ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
    expect(ramos).not.toMatch(/\.\.\.ficha\b|\bficha\./);
  });

  it("nenhum envio novo: 3 fetch, como no HEAD anterior", () => {
    expect(fonte.split("fetch(").length - 1).toBe(3);
  });
});

describe("tela: o corpo do register-customer leva a ficha", () => {
  const form: CadastroForm = {
    empresa: "Acme", nome: "Jane", telefone: " 555 ", activity: "", endereco: "1 Main", endereco2: "",
    cidade: "Miami", estado: "Florida", pais: "United States", cep: "33101", email: "a@b.com", password: "x", passwordConfirm: "x",
  };

  it("montarFicha devolve exatamente os campos que a edge le, com trim e vazio -> null", () => {
    const f = montarFicha(form);
    expect(Object.keys(f).sort()).toEqual([...CAMPOS_FICHA].sort());
    expect(f.telefone).toBe("555");
    expect(f.activity).toBeNull();
    expect(lerFicha({ email: form.email, nome: form.nome, empresa: form.empresa, ...f }).ficha).toEqual(f);
  });

  it("Cadastro.tsx manda a ficha no invoke", () => {
    const tela = ler("src/pages/Cadastro.tsx");
    expect(tela).toMatch(/const ficha = montarFicha\(form\);/);
    expect(tela).toMatch(/invoke\("register-customer", \{ body: \{ email, nome, empresa, \.\.\.ficha, captcha \} \}\)/);
  });
});
