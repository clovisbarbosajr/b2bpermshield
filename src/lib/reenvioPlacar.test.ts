import { describe, it, expect } from "vitest";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node).
import { readFileSync, readdirSync } from "node:fs";
import { fatiaAPartirDe } from "@/test/fatia";
import {
  bloqueado, falhou, incerto, classificaReenvio, adminResolve,
  montaMensagem, textoDoLog, motivoHttp, motivoDaEdge, resultadoDoEnvio,
} from "./reenvioPlacar";

// Testes que EXECUTAM. Os de fonte (regex sobre o texto) protegiam a fiacao mas
// nao podiam ver o erro que quase foi para producao: `quemIncerto` declarado
// acima do `incerto` que ele chama, com o `const` em temporal dead zone. `tsc`
// nao pega (a chamada esta dentro de callback), eslint do projeto nao pega, e
// regex nao ve ordem. Em execucao, TODO reenvio lancava ReferenceError DEPOIS de
// os e-mails terem saido — sem toast, sem log, botao travado ate F5.
//
// Qualquer chamada dessas funcoes aqui embaixo teria falhado com aquele bug.

const ok = () => ({ status: "fulfilled", value: { data: { success: true }, error: null } });
const recusado = (reason: string) =>
  ({ status: "fulfilled", value: { data: { skipped: true, reason }, error: null } });
const erroHttp = (corpo: any) => ({
  status: "fulfilled",
  value: {
    data: null,
    error: {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: respostaFalsa(corpo),
    },
  },
});
const redeCaiu = () => ({
  status: "fulfilled",
  value: { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request", context: new TypeError("fetch failed") } },
});

// Um Response de mentira que sabe ser lido UMA vez, como o de verdade.
function respostaFalsa(corpo: any) {
  let lido = false;
  return {
    get bodyUsed() { return lido; },
    json: async () => {
      if (lido) throw new TypeError("Body is unusable: Body has already been read");
      lido = true;
      if (typeof corpo === "string") throw new SyntaxError("Unexpected token < in JSON");
      return corpo;
    },
  };
}

describe("classificaReenvio", () => {
  it("tudo certo: ninguem falhou", () => {
    const p = classificaReenvio([ok(), ok()], ["customer", "admin"]);
    expect(p).toMatchObject({ total: 2, foram: 2, quemFalhou: [], quemIncerto: [] });
  });

  it("recusado (HTTP 200 + skipped) conta como falha", () => {
    const p = classificaReenvio([recusado("hourly cap"), ok()], ["customer", "admin"]);
    expect(p.foram).toBe(1);
    expect(p.quemFalhou).toEqual(["customer"]);
    expect(p.quemIncerto, "recusa do servidor NAO e incerteza").toEqual([]);
  });

  it("rede caida entra em falhou E em incerto", () => {
    const p = classificaReenvio([redeCaiu()], ["customer"]);
    expect(p.quemFalhou).toEqual(["customer"]);
    expect(p.quemIncerto).toEqual(["customer"]);
  });

  // O caso que o cacador levantou: recusa definitiva de um + incerteza de outro.
  it("separa quem foi recusado de quem ficou incerto", () => {
    const p = classificaReenvio(
      [recusado("hourly email cap reached"), redeCaiu()],
      ["customer", "admin"],
    );
    expect(p.quemFalhou).toEqual(["customer", "admin"]);
    expect(p.quemIncerto, "o cliente foi RECUSADO, nao ficou incerto").toEqual(["admin"]);
  });

  it("os rotulos seguem a ordem de `quem`", () => {
    const p = classificaReenvio([ok(), redeCaiu(), recusado("x")], ["customer", "admin", "z@x.com"]);
    expect(p.quemFalhou).toEqual(["admin", "z@x.com"]);
    expect(p.quemIncerto).toEqual(["admin"]);
  });

  it("lista vazia nao inventa sucesso", () => {
    const p = classificaReenvio([], []);
    expect(p).toMatchObject({ total: 0, foram: 0, naoForam: [] });
  });
});

describe("montaMensagem", () => {
  const base = { msg: "boom", pedirAdmin: false };

  it("nada saiu e nada ficou incerto: diz que nada foi enviado", () => {
    const p = classificaReenvio([recusado("channel off")], ["customer"]);
    expect(montaMensagem({ ...p, ...base })).toBe("Nothing was sent. boom");
  });

  // A mentira que este modulo existe para evitar.
  it("nada confirmado mas houve incerto: NAO diz 'nothing was sent'", () => {
    const p = classificaReenvio([redeCaiu()], ["customer"]);
    const texto = montaMensagem({ ...p, ...base });
    expect(texto).not.toContain("Nothing was sent");
    expect(texto).toContain("Could not confirm customer");
    expect(texto).toContain("Check the notification log before re-sending");
  });

  it("a frase 'could not confirm' nomeia SO o incerto", () => {
    const p = classificaReenvio([recusado("hourly cap"), redeCaiu()], ["customer", "admin"]);
    const texto = montaMensagem({ ...p, msg: "hourly cap", pedirAdmin: false });
    expect(texto).toContain("Could not confirm admin");
    expect(texto, "o cliente foi recusado — dizer que 'pode ter saido' o deixa sem e-mail")
      .not.toContain("Could not confirm customer, admin");
  });

  it("envio parcial mostra o placar e quem falhou", () => {
    const p = classificaReenvio([ok(), ok(), recusado("cap")], ["customer", "admin", "z@x.com"]);
    expect(montaMensagem({ ...p, msg: "cap", pedirAdmin: false }))
      .toBe("Sent 2 of 3 — failed: z@x.com. cap");
  });

  it("so sugere o admin quando o admin resolve", () => {
    const p = classificaReenvio([recusado("master switch is off")], ["customer"]);
    expect(montaMensagem({ ...p, msg: "master switch is off", pedirAdmin: true }))
      .toContain("ask an admin to turn the channel on.");
  });
});

describe("adminResolve", () => {
  it("interruptor mestre: o admin resolve", () => {
    expect(adminResolve("master switch is off", "master switch is off")).toBe(true);
    expect(adminResolve("notifications disabled", "notifications disabled")).toBe(true);
  });
  it("teto por hora e idade do pedido: o admin NAO resolve", () => {
    expect(adminResolve("hourly email cap reached", "hourly email cap reached")).toBe(false);
    expect(adminResolve("order older than 7 days", "order older than 7 days")).toBe(false);
  });
  it("erro que nao e bloqueio nunca sugere admin", () => {
    expect(adminResolve(null, "master switch is off")).toBe(false);
  });
});

describe("textoDoLog", () => {
  it("afirma reenvio so quando tudo saiu", () => {
    const p = classificaReenvio([ok(), ok()], ["customer", "admin"]);
    expect(textoDoLog("1042", p)).toBe("Resent order #1042 confirmation");
  });
  it("com falha, grava o placar e os nomes", () => {
    const p = classificaReenvio([ok(), recusado("cap")], ["customer", "admin"]);
    expect(textoDoLog("1042", p)).toBe("Resend order #1042: 1 of 2 sent, failed: admin");
  });
});

describe("motivoHttp", () => {
  it("le o motivo real do corpo", async () => {
    const r: any = erroHttp({ error: "Not authorized: recipient must be your own account" });
    expect(await motivoHttp(r.value.error)).toBe("Not authorized: recipient must be your own account");
  });

  it("502 de gateway (HTML, nao JSON) nao estoura", async () => {
    const r: any = erroHttp("<html>502 Bad Gateway</html>");
    expect(await motivoHttp(r.value.error)).toBeNull();
  });

  it("corpo JSON sem campo `error` nao inventa mensagem", async () => {
    const r: any = erroHttp({ ok: false });
    expect(await motivoHttp(r.value.error)).toBeNull();
  });

  // Sem o teste de tipo, `msg` na tela recebe o objeto, o `||` para de cair no
  // fallback do `error.message` e o toast imprime `[object Object]` no lugar do
  // motivo. Hoje o `send-email` so responde `error` string, entao isto e uma
  // trava contra o dia em que alguem devolver um objeto de validacao.
  it("`error` que nao e string NAO vira mensagem", async () => {
    for (const corpo of [
      { error: { code: "42501", detail: "permission denied" } },
      { error: ["a", "b"] },
      { error: 500 },
      { error: true },
      { error: null },
    ]) {
      const r: any = erroHttp(corpo);
      expect(await motivoHttp(r.value.error), JSON.stringify(corpo)).toBeNull();
    }
  });

  it("erro sem `context` nenhum nao estoura", async () => {
    expect(await motivoHttp({ message: "x" })).toBeNull();
    expect(await motivoHttp(null)).toBeNull();
    expect(await motivoHttp(undefined)).toBeNull();
  });

  it("FunctionsFetchError: `context` e um TypeError, nao um Response", async () => {
    expect(await motivoHttp(redeCaiu().value.error)).toBeNull();
  });

  it("segunda leitura do mesmo corpo nao estoura", async () => {
    const r: any = erroHttp({ error: "primeiro" });
    expect(await motivoHttp(r.value.error)).toBe("primeiro");
    // `value.response` e o MESMO objeto e o corpo so pode ser lido uma vez: a
    // segunda chamada rejeita dentro do `catch` e devolve `null`, sem derrubar o
    // reenvio. Uma guarda de `bodyUsed` existiu aqui e uma mutacao mostrou que
    // era redundante com o `catch`.
    expect(await motivoHttp(r.value.error)).toBeNull();
  });

  it("erro sem `context` nao estoura", async () => {
    expect(await motivoHttp({ message: "x" })).toBeNull();
    expect(await motivoHttp(undefined)).toBeNull();
  });
});

describe("resultadoDoEnvio", () => {
  it("torneira fechada: NAO e sucesso, diz que nada saiu e aponta a tela", async () => {
    const r = await resultadoDoEnvio(recusado("envio pausado manualmente").value.data, null, "fb");
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("Nothing was sent");
    expect(r.motivo).toContain("envio pausado manualmente");
    expect(r.motivo).toContain("Settings");
  });
  it("teto por hora: nada saiu, motivo do servidor, sem ponteiro de pausa", async () => {
    const r = await resultadoDoEnvio(recusado("teto de 25 auth/hora atingido").value.data, null, "fb");
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("teto de 25 auth/hora atingido");
    expect(r.motivo).not.toContain("Settings");
  });
  it("`skipped` exige === true, como `bloqueado`", async () => {
    expect((await resultadoDoEnvio({ skipped: "sim" }, null, "fb")).ok).toBe(true);
  });
  it("non-2xx: motivo do corpo, nao a frase fixa", async () => {
    const e: any = erroHttp({ error: "Not authorized: recipient must be your own account" });
    const r = await resultadoDoEnvio(e.value.data, e.value.error, "fb");
    expect(r).toEqual({ ok: false, motivo: "Not authorized: recipient must be your own account" });
  });
  it("200 com `error` no corpo tambem e falha; sucesso limpo e ok", async () => {
    expect(await resultadoDoEnvio({ error: "x" }, null, "fb")).toEqual({ ok: false, motivo: "x" });
    expect(await resultadoDoEnvio({ success: true }, null, "fb")).toEqual({ ok: true, motivo: "" });
  });
});

describe("as telas que chamam send-email nao afirmam envio sem olhar `skipped`", () => {
  const MARCA = 'invoke("send-email"';
  const norm = (s: string) => s.replace(/invoke\(\s*'send-email'/g, MARCA);
  const arquivos = (readdirSync("src", { recursive: true }) as string[])
    .filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))
    .map((n) => `src/${n.replace(/\\/g, "/")}`)
    .filter((a) => norm(readFileSync(a, "utf8")).includes(MARCA))
    .sort();

  it("a lista de telas que chamam send-email e a esperada (chamador novo nao passa calado)", () => {
    expect(arquivos).toEqual([
      "src/components/login/ForgotPasswordModal.tsx",
      "src/components/login/MagicLinkModal.tsx",
      "src/pages/RecuperarSenha.tsx",
      "src/pages/admin/Clientes.tsx",
      "src/pages/admin/Configuracoes.tsx",
      "src/pages/admin/CustomerEdit.tsx",
      "src/pages/admin/OrderDetail.tsx",
      "src/pages/admin/settings/EmailSettings.tsx",
      "src/pages/admin/settings/Notificacoes.tsx",
    ]);
  });

  for (const arq of arquivos) {
    it(`${arq.split("/").pop()}: toda janela com toast de sucesso decide por resultadoDoEnvio/skipped`, () => {
      let resto = norm(readFileSync(arq, "utf8"));
      let vistos = 0;
      while (resto.includes(MARCA)) {
        const daqui = fatiaAPartirDe(resto, MARCA);
        const janela = daqui.split("\n").slice(0, 18).join("\n");
        vistos++;
        // So conta toast que AFIRMA envio (sent/email/link/invite) ou o estado
        // "check your inbox"; toast de pedido depois de um fire-and-forget nao.
        const afirma = /toast\.success\([^;]*?\b(sent|e-?mail|link|invite)/i.test(janela)
          || /setSent\(true\)|setEnviado\(true\)/.test(janela);
        if (afirma) {
          expect(janela, `chamada #${vistos} em ${arq} afirma envio sem olhar a recusa`)
            .toMatch(/resultadoDoEnvio\(|data\?\.skipped|\.skipped\b|handleResp\(/);
        }
        resto = daqui.slice(MARCA.length);
      }
      expect(vistos).toBeGreaterThan(0);
    });
  }
});

describe("motivoDaEdge", () => {
  it("non-2xx: le o motivo do corpo, nao a frase fixa do functions-js", async () => {
    const r: any = erroHttp({ error: "A user with this email address has already been registered" });
    expect(await motivoDaEdge(null, r.value.error, "Error creating user"))
      .toBe("A user with this email address has already been registered");
  });

  it("200 com `error` no corpo (delete_user): `data.error` vem primeiro", async () => {
    expect(await motivoDaEdge({ error: "x" }, null, "fallback")).toBe("x");
    // E ganha mesmo de um `error` presente: a resposta e a fonte, nao o transporte.
    const r: any = erroHttp({ error: "do corpo" });
    expect(await motivoDaEdge({ error: "x" }, r.value.error, "fallback")).toBe("x");
  });

  it("FunctionsFetchError (sem Response no `context`) cai em `error.message`", async () => {
    expect(await motivoDaEdge(null, redeCaiu().value.error, "fallback")).toBe("Failed to send a request");
    expect(await motivoDaEdge(null, { message: "sem context" }, "fallback")).toBe("sem context");
  });

  it("corpo HTML/vazio e `message` vazia: fallback, nunca string vazia", async () => {
    const html: any = erroHttp("<html>502</html>");
    html.value.error.message = "";
    expect(await motivoDaEdge(null, html.value.error, "Error creating user")).toBe("Error creating user");
    expect(await motivoDaEdge(null, null, "Error creating user")).toBe("Error creating user");
    expect(await motivoDaEdge({ error: "" }, { message: "" }, "Error creating user")).toBe("Error creating user");
  });

  it("`data.error` objeto NAO vira [object Object]", async () => {
    const texto = await motivoDaEdge({ error: { code: "42501" } }, null, "fallback");
    expect(texto).toBe("fallback");
    expect(texto).not.toContain("[object Object]");
    // ...e nem esconde o motivo real do corpo HTTP quando ele existe.
    const r: any = erroHttp({ error: "do corpo" });
    expect(await motivoDaEdge({ error: { code: 1 } }, r.value.error, "fallback")).toBe("do corpo");
  });

  it("le o corpo UMA vez por erro", async () => {
    const r: any = erroHttp({ error: "primeiro" });
    expect(await motivoDaEdge(null, r.value.error, "fallback")).toBe("primeiro");
    expect(r.value.error.context.bodyUsed).toBe(true);
  });
});

// GUARDA DE FONTE: todo `invoke("admin-create-user")` das duas telas passa o
// resultado por `motivoDaEdge`. Sem isto, qualquer 4xx/5xx volta a virar a
// frase fixa "Edge Function returned a non-2xx status code" no toast.
describe("as telas de admin-create-user usam motivoDaEdge", () => {
  const TELAS: [string, number][] = [
    ["src/pages/admin/CustomerEdit.tsx", 4],
    ["src/pages/admin/settings/UsersManagement.tsx", 3],
    // O oitavo: o delete da lista de clientes descartava o `error` do invoke e
    // dizia "Customer deleted" com o login vivo. Uma lista fixa de telas e o que
    // deixou ele passar — grep abaixo prende que nenhuma outra tela chama a edge.
    ["src/pages/admin/Clientes.tsx", 1],
  ];
  it("nenhuma outra tela chama admin-create-user fora das listadas", () => {
    // Varredura em Node puro: `execSync("git grep ...")` com aspas simples quebra
    // no cmd.exe do Windows. Este proprio arquivo contem o marcador; testes nao
    // chamam a edge, entao ficam de fora.
    const arquivos = (readdirSync("src", { recursive: true }) as string[])
      .filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))
      .map((n) => `src/${n.replace(/\\/g, "/")}`)
      .filter((a) => normalizaAspas(readFileSync(a, "utf8")).includes(MARCADOR))
      .sort();
    expect(arquivos).toEqual(TELAS.map(([a]) => a).sort());
  });
  const MARCADOR = 'invoke("admin-create-user"';
  // O repo escreve `invoke('...')` com aspas simples em Notificacoes/Checkout e
  // nao ha regra de eslint para aspas: um chamador novo com aspas simples
  // passava calado pela varredura (mutante do Cacador). Normaliza antes.
  const normalizaAspas = (s: string) =>
    s.replace(/invoke\(\s*'admin-create-user'/g, 'invoke("admin-create-user"');

  for (const [arq, esperados] of TELAS) {
    it(`${arq.split("/").pop()}: ${esperados} chamadas, todas com motivoDaEdge`, () => {
      const fonte = normalizaAspas(readFileSync(arq, "utf8"));
      expect(fonte).toMatch(/import \{[^}]*\bmotivoDaEdge\b[^}]*\} from "@\/lib\/reenvioPlacar"/);
      let resto = fonte;
      let vistos = 0;
      while (resto.includes(MARCADOR)) {
        // `fatiaAPartirDe` exige o marcador; `slice(MARCADOR.length)` avanca sem
        // busca, entao o lint de recorte a mao nao tem o que acusar.
        const daqui = fatiaAPartirDe(resto, MARCADOR);
        const janela = daqui.split("\n").slice(0, 15).join("\n");
        vistos++;
        expect(janela, `chamada #${vistos} em ${arq} sem motivoDaEdge`).toMatch(/await motivoDaEdge\(/);
        expect(janela, `chamada #${vistos} em ${arq} ainda usa error.message solto`)
          .not.toMatch(/\b(fnError|fnErr|error|pwErr|staffErr|delErr)\?\.message/);
        resto = daqui.slice(MARCADOR.length);
      }
      // Contagem fixa: uma chamada removida ou renomeada nao pode passar calada.
      expect(vistos).toBe(esperados);
    });
  }
});

describe("predicados", () => {
  it("`bloqueado` exige skipped === true, nao truthy", () => {
    expect(bloqueado({ status: "fulfilled", value: { data: { skipped: "sim" } } })).toBe(false);
    expect(bloqueado(recusado("x"))).toBe(true);
  });
  it("`falhou` cobre rejected, error, data.error e bloqueado", () => {
    expect(falhou({ status: "rejected", reason: new Error("x") })).toBe(true);
    expect(falhou({ status: "fulfilled", value: { data: { error: "nope" } } })).toBe(true);
    expect(falhou(ok())).toBe(false);
  });
  it("`incerto` so para FunctionsFetchError", () => {
    expect(incerto(redeCaiu())).toBe(true);
    expect(incerto(erroHttp({ error: "x" }))).toBe(false);
    expect(incerto(ok())).toBe(false);
  });
});
