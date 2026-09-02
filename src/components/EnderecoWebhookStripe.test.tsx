/**
 * TESTE QUE RENDERIZA — e nao le o texto do arquivo.
 *
 * A versao anterior conferia a fonte de `Configuracoes.tsx` com regex, e duas
 * mutacoes sobreviviam VERDES fazendo o estrago inteiro: envolver o bloco em
 * `{false && …}` (a expressao continua escrita, some da tela) e
 * `<code className="hidden">`. Assert de fonte nao distingue "esta escrito" de
 * "aparece na tela".
 *
 * `renderToStaticMarkup` e nao `@testing-library/react` pelo motivo ja registrado
 * em `protecaoDeRota.test.tsx`: o peer `@testing-library/dom` nao esta instalado.
 *
 * O ultimo caso liga o componente a tela por AST — o elemento tem que existir e
 * nao pender de condicional, senao `{false && <EnderecoWebhookStripe/>}` faria o
 * bloco sumir com a suite verde.
 *
 * TETO CONHECIDO, registrado de proposito: renderizar `Configuracoes.tsx` inteira
 * nao da — `renderToStaticMarkup` nao roda `useEffect`, entao a pagina para no
 * spinner (`loading` nunca vira false) e a aba Payments nem chega a existir.
 * Logo, um `<div className="hidden">` envolvendo o call site na tela NAO e
 * pego por nenhum teste. Fica anotado como buraco conhecido, nao como coberto.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node.
import { readFileSync } from "node:fs";
import { EnderecoWebhookStripe } from "./EnderecoWebhookStripe";
import { AVISO_WEBHOOK_SEM_HOST } from "@/lib/stripeWebhookEndpoint";
import ts from "typescript";
import { ast } from "@/test/ast";

/**
 * Marcacao lida por DOM DE VERDADE (o ambiente do vitest e jsdom), nao por regex.
 *
 * A versao anterior era um scanner de tags feito a mao e errou nas duas direcoes,
 * como todo parser de HTML por regex: `<code title="use >" class="hidden">` dizia
 * VISIVEL porque o `[^>]*` parava no `>` de dentro do atributo, e um `<br>` cru
 * antes do endereco desalinhava a pilha e dizia ESCONDIDO. Nao ha o que consertar
 * num regex desses — o projeto ja roda em jsdom, entao usa-se o parser real.
 */
const domDe = (html: string): HTMLElement => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return raiz;
};

const conteudoDoCode = (html: string): string => domDe(html).querySelector("code")?.textContent ?? "";

// Classes utilitarias que apagariam o endereco ou o cortariam pela metade — o
// admin copia ESTE texto com a mao. jsdom nao aplica o Tailwind, entao classe so
// da para conferir por nome; estilo inline e atributo, sim, sao lidos de verdade.
const CLASSES_INVISIVEIS = ["hidden", "sr-only", "invisible", "text-transparent", "truncate", "opacity-0"];

const escondido = (el: Element): boolean => {
  if (el.hasAttribute("hidden")) return true;
  const s = (el as HTMLElement).style;
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return true;
  if (s.fontSize === "0" || s.fontSize === "0px" || s.width === "0" || s.width === "0px") return true;
  return [...el.classList].some((c) => CLASSES_INVISIVEIS.includes(c));
};

/** O `<code>` do endereco e TODOS os seus ancestrais precisam estar visiveis. */
const enderecoEscondido = (html: string): boolean => {
  const raiz = domDe(html);
  const code = raiz.querySelector("code");
  if (!code) return true; // sem `<code>`: o endereco nao aparece
  for (let el: Element | null = code; el && el !== raiz; el = el.parentElement) {
    if (escondido(el)) return true;
  }
  return false;
};

describe("EnderecoWebhookStripe", () => {
  it("com host, exibe a URL absoluta da funcao certa", () => {
    const html = renderToStaticMarkup(<EnderecoWebhookStripe supabaseUrl="https://abc.supabase.co" />);
    expect(conteudoDoCode(html)).toBe("https://abc.supabase.co/functions/v1/stripe-checkout");
    expect(html).toContain("Stripe Dashboard");
  });

  it("sem host, exibe o aviso — nunca um endereco vazio ou relativo", () => {
    for (const semHost of [undefined, "", "   ", "abc.supabase.co"]) {
      const html = renderToStaticMarkup(<EnderecoWebhookStripe supabaseUrl={semHost} />);
      const texto = conteudoDoCode(html);
      expect(texto.trim()).not.toBe("");
      expect(texto).toContain(AVISO_WEBHOOK_SEM_HOST.slice(0, 20));
      expect(texto).not.toMatch(/functions\/v1/);
    }
  });

  it("o endereco fica visivel e copiavel inteiro, em qualquer nivel", () => {
    for (const host of ["https://abc.supabase.co", undefined]) {
      expect(enderecoEscondido(renderToStaticMarkup(<EnderecoWebhookStripe supabaseUrl={host} />))).toBe(false);
    }
  });

  it("nunca reescreve o esquema (o bug do `httpss://`)", () => {
    const html = renderToStaticMarkup(<EnderecoWebhookStripe supabaseUrl="https://abc.supabase.co" />);
    expect(html).not.toContain("httpss");
  });

  it("a tela de Settings instancia o componente em ramo VIVO", () => {
    // `toContain` da fonte nao bastava: `{false && <EnderecoWebhookStripe … />}`
    // casava igual, e o bloco sumia da tela — o defeito original de volta pelo
    // call site. Por AST: o elemento tem que existir, receber o host, e nao
    // pender de nenhuma condicional (`&&`, `||`, ternario) que possa ser falsa.
    const sf = ast("src/pages/admin/Configuracoes.tsx");
    const usos: ts.Node[] = [];
    const visita = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "EnderecoWebhookStripe") {
        usos.push(n);
      }
      n.forEachChild(visita);
    };
    sf.forEachChild(visita);

    expect(usos).toHaveLength(1);
    // Espaco normalizado: `supabaseUrl={ import.meta.env.… }` e a quebra de linha
    // do prettier sao a MESMA coisa, e a versao anterior reprovava as duas.
    const texto = usos[0].getText(sf).replace(/\s+/g, "");
    expect(texto).toContain("supabaseUrl={");
    expect(texto).toContain("VITE_SUPABASE_URL");

    // Se este laco um dia reprovar sem defeito, e porque `Configuracoes.tsx`
    // trocou o early return do `loading` por um ternario ENVOLVENDO as abas — ai
    // o ancestral condicional e legitimo e o teste e que precisa afrouxar.
    for (let p: ts.Node | undefined = usos[0].parent; p; p = p.parent) {
      expect(ts.isConditionalExpression(p)).toBe(false);
      expect(ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)).toBe(false);
    }

    const tela = readFileSync("src/pages/admin/Configuracoes.tsx", "utf8");
    expect(tela).not.toContain("window.location.origin");
    expect(tela).not.toContain("/functions/v1/stripe-webhook");
  });
});
