import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fatiaEntre } from "../../../src/test/fatia";
import { verificarCaptcha } from "../_shared/captcha.ts";

// reCAPTCHA NO AUTO-CADASTRO (T25)
//
// O que prende: a edge so segue (banco, SMS, e-mails) com o Google dizendo `success`;
// secret ausente/errado FECHA (503), nao passa; a tela nao chama signUp sem token e
// manda o token; a CSP deixa o widget carregar.

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const google = (resposta: unknown) => vi.fn(async () => ({ json: async () => resposta }) as unknown as Response);

describe("verificarCaptcha (a regra, exercitada)", () => {
  it("success true -> ok, e manda secret + token form-encoded ao siteverify", async () => {
    const f = google({ success: true });
    expect(await verificarCaptcha("tok", "sec", f)).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.google.com/recaptcha/api/siteverify");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ secret: "sec", response: "tok" });
  });

  it.each([
    [{ success: false, "error-codes": ["invalid-input-response"] }],
    [{ success: false, "error-codes": ["timeout-or-duplicate"] }],
    [{ success: false }],
    [{ success: "true" }],
  ])("recusa do Google %j -> falhou", async (r) => {
    expect(await verificarCaptcha("tok", "sec", google(r))).toBe("falhou");
  });

  it.each(["invalid-input-secret", "missing-input-secret"])("%s -> indisponivel (config nossa, fecha)", async (c) => {
    expect(await verificarCaptcha("tok", "sec", google({ success: false, "error-codes": [c] }))).toBe("indisponivel");
  });

  it("sem secret -> indisponivel, sem chamar o Google", async () => {
    const f = google({ success: true });
    expect(await verificarCaptcha("tok", "", f)).toBe("indisponivel");
    expect(f).not.toHaveBeenCalled();
  });

  it("sem token -> falhou, sem chamar o Google", async () => {
    const f = google({ success: true });
    expect(await verificarCaptcha("", "sec", f)).toBe("falhou");
    expect(f).not.toHaveBeenCalled();
  });

  it("rede caiu ou JSON invalido -> indisponivel (nunca ok)", async () => {
    const rede = vi.fn(async () => { throw new Error("offline"); });
    expect(await verificarCaptcha("tok", "sec", rede as unknown as typeof fetch)).toBe("indisponivel");
    const lixo = vi.fn(async () => ({ json: async () => { throw new SyntaxError("x"); } }) as unknown as Response);
    expect(await verificarCaptcha("tok", "sec", lixo)).toBe("indisponivel");
  });
});

describe("register-customer: captcha tranca os avisos, nao a ficha", () => {
  const fonte = semComentario(ler("supabase/functions/register-customer/index.ts"));

  it("verificado antes de qualquer consulta, e sem `return` que pule a criacao da ficha", () => {
    const trecho = fatiaEntre(fonte, 'if (invalido) return json({ error: "invalid registration data" }, 400);', 'db.rpc("registration_is_open")', 40);
    expect(trecho).toContain('const cap = await verificarCaptcha(String(body.captcha ?? ""), Deno.env.get("registercustomer") ?? "", fetch);');
    expect(trecho).not.toMatch(/\bdb\./);
    // recusar aqui = login ja criado pelo signUp, sem ficha e sem aviso
    expect(fatiaEntre(trecho, "verificarCaptcha(", "const opaco", 30)).not.toMatch(/\breturn\b/);
  });

  it("a edge nao envia nada sozinha: zero `fetch(`, zero `throw`, UMA chamada aos avisos", () => {
    // todo envio passa por `enviarAvisosCadastro` (exercitado em avisosCadastro.test.ts)
    expect(fonte).not.toMatch(/\bfetch\s*\(/);
    // `throw` sai pelo catch externo com status proprio: caminho fora do `opaco()`
    expect(fonte).not.toMatch(/\bthrow\b/);
    const chamadas = [...fonte.matchAll(/enviarAvisosCadastro\(([^,]*),/g)].map((m) => m[1].trim());
    expect(chamadas).toEqual(['cap === "ok" && dentroDoLimite']);
    // o que a edge PASSA ao helper (cronSecret vazio = SMS some em silencio)
    const args = fatiaEntre(fonte, 'await enviarAvisosCadastro(cap === "ok" && dentroDoLimite, {', "}, fetch);", 10)
      .split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
    expect(args).toEqual([
      'sbUrl: Deno.env.get("SUPABASE_URL") ?? "",',
      'service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",',
      'anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",',
      'cronSecret: Deno.env.get("CRON_SECRET") ?? "",',
      "emailLc, nome, empresa,",
    ]);
    expect(fonte).toContain('.eq("recipient", emailLc)');
    expect(fonte).toContain('.gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());');
  });

  it("limite por hora: so desliga, nunca liga; valor 3", () => {
    const atribuicoes = [...fonte.matchAll(/\bdentroDoLimite\s*[|&?+\-*/]{0,3}=(?!=)[^;]*;/g)].map((m) => m[0].replace(/\s+/g, " "));
    expect(atribuicoes).toEqual(["dentroDoLimite = true;", "dentroDoLimite = false;"]);
    expect(fonte).toMatch(/let dentroDoLimite = true;/);
    expect(fonte).toContain("if ((count ?? 0) >= LIMITE_AVISOS_HORA) {");
  });

  it("`cap` nao decide fluxo: so log, resposta e avisos (nenhum `if (cap...) return`)", () => {
    const usos = fonte.split("\n").filter((l) => /\bcap\b/.test(l)).map((l) => l.trim());
    expect(usos).toEqual([
      'const cap = await verificarCaptcha(String(body.captcha ?? ""), Deno.env.get("registercustomer") ?? "", fetch);',
      'if (cap !== "ok") console.error(`[register-customer] captcha ${cap} (${emailLc}): ficha segue, avisos nao`);',
      'const opaco = () => cap === "ok" ? json({ ok: true })',
      ': cap === "falhou" ? json({ error: "captcha failed" }, 400)',
      'await enviarAvisosCadastro(cap === "ok" && dentroDoLimite, {',
    ]);
  });

  it("todo caminho depois do captcha responde por `opaco()` (senao a resposta vira oraculo do e-mail)", () => {
    const depois = fatiaEntre(fonte, "const cap = await verificarCaptcha(", "} catch (err: any) {", 200);
    const retornos = [...depois.matchAll(/\breturn\b[^;]*;/g)].map((m) => m[0]);
    expect(retornos.length).toBeGreaterThanOrEqual(7);
    for (const r of retornos) expect(r).toBe("return opaco();");
  });

  it("resposta depende so do captcha: ok -> 200, falhou -> 400, indisponivel -> 503", () => {
    expect(fonte).toMatch(/const opaco = \(\) => cap === "ok" \? json\(\{ ok: true \}\)\s*: cap === "falhou" \? json\(\{ error: "captcha failed" \}, 400\)\s*: json\(\{ error: "captcha unavailable" \}, 503\);/);
  });
});

describe("tela e CSP", () => {
  const tela = semComentario(ler("src/pages/Cadastro.tsx"));

  it("sem token nao chama signUp; token vai no corpo", () => {
    const antes = fatiaEntre(tela, "const handleSignup", "supabase.auth.signUp(", 40);
    expect(antes).toMatch(/if \(!captcha\) \{\s*toast\.error\(captchaErro \? CAPTCHA_NAO_CARREGOU : "Please confirm you are not a robot"\);\s*return;\s*\}/);
    expect(tela).toContain("{ body: { email, nome, empresa, ...ficha, captcha } }");
    expect(tela).toMatch(/callback: \(t: string\) => setCaptcha\(t\)/);
    expect(tela).toMatch(/"expired-callback": \(\) => setCaptcha\(""\)/);
    expect(tela).toContain("<div ref={captchaDiv} />");
    // script bloqueado: aviso visivel e o toast nao manda marcar checkbox que nao existe
    expect(tela).toContain("s.onerror = () => { s.remove(); w.__recaptchaCadastroErro(); };");
    // setter da montagem ATUAL (closure antiga nao faz nada apos desmontar)
    // os DOIS globais apontam para a montagem atual, antes (e fora) do `if` que cria o script
    const antesDoScript = fatiaEntre(tela, "useEffect(() => {\n    const w = window as any;", 'if (!document.getElementById("recaptcha-api"))', 30);
    const globais = antesDoScript.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("w.__recaptcha"));
    expect(globais).toEqual(["w.__recaptchaCadastro = montar;", "w.__recaptchaCadastroErro = () => setCaptchaErro(true);"]);
    expect(tela).toContain("{captchaErro && <p");
    expect(tela).toContain("toast.error(captchaErro ? CAPTCHA_NAO_CARREGOU : ");
  });

  it("CSP libera o reCAPTCHA (script, frame, connect)", () => {
    const csp: string = JSON.parse(ler("vercel.json")).headers[0].headers
      .find((h: { key: string }) => h.key === "Content-Security-Policy").value;
    const dir = (n: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${n} `)) ?? "";
    expect(dir("script-src")).toContain("https://www.google.com/recaptcha/");
    expect(dir("script-src")).toContain("https://www.gstatic.com/recaptcha/");
    expect(dir("frame-src")).toContain("https://www.google.com/recaptcha/");
    expect(dir("frame-src")).toContain("https://recaptcha.google.com/recaptcha/");
    expect(dir("connect-src")).toContain("https://www.google.com/recaptcha/");
  });
});
