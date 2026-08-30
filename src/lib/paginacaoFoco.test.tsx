/**
 * Por que a chave da lista de paginacao e `key={n}` e nao `key={i}`.
 *
 * Enquanto a janela era FIXA (`1..7` mais as ultimas), indice e numero eram a
 * mesma coisa e a chave por indice servia. Com a janela DESLIZANTE de
 * `paginasVisiveis`, o indice 5 e o botao "6" antes do clique e o botao "7"
 * depois — mesmo tipo de elemento nos dois renders, entao o React NAO remonta:
 * reaproveita o no do DOM e so troca rotulo e `onClick`. O foco fica onde estava,
 * agora num botao que diz outro numero.
 *
 * Quem clicou pelo teclado (Enter/Espaco sempre deixam o foco no botao, em todo
 * navegador) e apertou de novo — a tela busca no servidor e mostra spinner, entao
 * "nao aconteceu nada, aperto de novo" e o reflexo normal — ia parar na pagina
 * ERRADA. Leitor de tela tambem anuncia o rotulo mudando sozinho sob o foco.
 *
 * Este teste roda os DOIS modos: o quebrado documenta o defeito, o certo prova a
 * correcao. Sem exercitar em DOM de verdade nao da para afirmar nenhum dos dois —
 * a diferenca so existe em execucao.
 */
import { describe, it, expect, afterEach } from "vitest";
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
// @ts-expect-error — `tsconfig.app.json` nao inclui os tipos do Node; em execucao
// o modulo existe (vitest roda em Node). Mesmo padrao de `permissoesDoPapel.test.ts`.
import { readFileSync } from "node:fs";
import { paginasVisiveis } from "./paginacao";
import { fatiaEntre } from "@/test/fatia";

// Mesma estrutura JSX de portal/Pedidos.tsx e das tres telas do admin.
function Paginacao({ modo }: { modo: "indice" | "numero" }) {
  const [page, setPage] = useState(1);
  const totalPages = 20;
  return (
    <div>
      {paginasVisiveis(page, totalPages).map((n, i) =>
        n === "..." ? (
          <span key={modo === "indice" ? i : `e${i}`}>...</span>
        ) : (
          <button key={modo === "indice" ? i : n} onClick={() => setPage(Number(n))}>{n}</button>
        ),
      )}
      <output>{page}</output>
    </div>
  );
}

let container: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null; root = null;
});

function monta(modo: "indice" | "numero") {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => { root!.render(<Paginacao modo={modo} />); });
}
const paginaAtual = () => container!.querySelector("output")!.textContent;
const rotuloFocado = () => (document.activeElement as HTMLElement).textContent;

function clicaComFoco(rotulo: string) {
  const btn = [...container!.querySelectorAll("button")].find((b) => b.textContent === rotulo)!;
  btn.focus();                       // e o que Enter/Espaco fazem, em todo navegador
  expect(document.activeElement).toBe(btn);
  act(() => { btn.click(); });
}

describe("foco depois de clicar na pagina 6, de 20", () => {
  it("key={i} — o foco acaba num botao que passou a dizer outro numero", () => {
    monta("indice");
    clicaComFoco("6");
    expect(paginaAtual()).toBe("6");
    expect(rotuloFocado()).toBe("7");                 // <- o defeito
    act(() => { (document.activeElement as HTMLElement).click(); });
    expect(paginaAtual()).toBe("7");                  // <- segundo Enter, pagina errada
  });

  it("key={n} — o foco continua no botao '6', que agora e a pagina atual", () => {
    monta("numero");
    clicaComFoco("6");
    expect(paginaAtual()).toBe("6");
    expect(rotuloFocado()).toBe("6");
    act(() => { (document.activeElement as HTMLElement).click(); });
    expect(paginaAtual()).toBe("6");                  // segundo Enter nao move
  });
});

// O teste acima roda uma COPIA do JSX. Sem isto aqui, alguem podia devolver
// `key={i}` nas telas e a suite continuaria verde.
describe("as quatro telas usam a chave por numero", () => {
  const TELAS = [
    "src/pages/portal/Pedidos.tsx",
    "src/pages/admin/Clientes.tsx",
    "src/pages/admin/Pedidos.tsx",
    "src/pages/admin/Produtos.tsx",
  ];
  it.each(TELAS)("%s", (tela) => {
    const fonte = readFileSync(tela, "utf-8");
    // AS QUATRO TELAS LIMITAM. A versao anterior desta guarda aceitava `page` OU
    // `pageOk`, e com isso deixava passar em silencio as tres telas que ainda nao
    // tinham sido corrigidas — exatamente o oposto do que uma rede de seguranca
    // faz. `paginaValida` mora em `paginacao.ts` e tem teste que EXECUTA; aqui so
    // se cobra que toda tela paginada a use.
    expect(fonte, `${tela} nao limita a pagina — o beco sem saida da ultima pagina volta`)
      .toContain("paginaValida(page, totalPages)");
    expect(fonte, `${tela} nao usa paginasVisiveis com a pagina limitada`)
      .toContain("paginasVisiveis(pageOk, totalPages)");
    // O REALCE E AS SETAS TAMBEM. Medido: com so o `disabled` coberto, tres
    // mutantes passavam verdes — e o do `onClick` e beco de verdade. Com 51
    // registros e o admin na pagina 3, apagar a unica linha deixa `pageOk = 2` e
    // `page = 3`: a seta "anterior" fica habilitada (`pageOk <= 1` e falso), o
    // clique faz `setPage(3 - 1) = 2`, que ja era a pagina exibida — botao morto.
    expect(fonte, `${tela}: o realce do botao atual voltou a comparar com a pagina nao limitada`)
      .not.toMatch(/\bpage === n\b/);
    // Nenhuma seta pode voltar a derivar a pagina nova de `page`.
    expect(fonte, `${tela}: uma seta voltou a calcular a pagina a partir de \`page\``)
      .not.toMatch(/setPage\(\(?p\)? => /);
    // Uma fatia por lista de paginacao (o portal tem duas, topo e rodape). Cortar
    // pelo proprio `.map(` evita o recorte a mao que ja ficou verde e parou de
    // proteger tres vezes neste projeto — ver `src/test/fatia.ts`. O portal chama
    // via `pageNumbers()`, entao o marcador comum e o callback, nao o nome.
    const listas = fonte.split(".map((n, i) =>").slice(1);
    expect(listas.length, `${tela}: nenhuma lista de paginacao encontrada`).toBeGreaterThan(0);

    for (const lista of listas) {
      // 700 caracteres cobrem o corpo do `.map` com folga e param antes do proximo
      // bloco de JSX; um recorte que estourasse casaria com botao de outra coisa.
      const trecho = lista.slice(0, 700);
      // O `<span>` da reticencia usa chave de INDICE de proposito — duas podem
      // aparecer na mesma lista. Quem nao pode e o botao, e o que o distingue e
      // ter `onClick` depois da chave (no admin isso e uma linha so, com varios
      // atributos no meio — dai a folga de 200).
      expect(trecho, `${tela}: botao de paginacao com key={i}`)
        .not.toMatch(/key=\{i\}[\s\S]{0,200}onClick/);
      expect(trecho, `${tela}: falta key={n} no botao de paginacao`)
        .toMatch(/key=\{n\}[\s\S]{0,200}onClick/);
    }
  });
});
