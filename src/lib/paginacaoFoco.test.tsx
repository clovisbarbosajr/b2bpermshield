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
    // O REALCE E AS SETAS TAMBEM. Com 51 registros e o admin na pagina 3, apagar
    // a unica linha deixa `pageOk = 2` e `page = 3`: a seta "anterior" fica
    // habilitada (`pageOk <= 1` e falso), o clique faz `setPage(3 - 1) = 2`, que
    // ja era a pagina exibida — botao morto.
    expect(fonte, `${tela}: o realce do botao atual voltou a comparar com a pagina nao limitada`)
      .not.toMatch(/\bpage === n\b/);
    // TODA MENCAO A `page` NOS CONTROLES, e nao so a forma funcional. A versao
    // anterior proibia apenas `setPage(p => ...)`, entao a forma-valor NAO
    // limitada (`setPage(page - 1)`) passava — e foram SEIS mutantes vivos, um
    // por controle, nas tres telas que nao sao `Produtos`. `page` so pode aparecer
    // na declaracao do estado, nos `setPage(1)` de filtro, e na linha do proprio
    // `paginaValida`; em qualquer controle de paginacao tem que ser `pageOk`.
    //
    // `exige`: o laco `for (const m of todas)` e VACUAMENTE VERDE quando o regex
    // nao casa nada. Medido: extrair o offset para um `const inicio = (page - 1) *
    // PAGE_SIZE` — refatoracao natural — devolvia o beco inteiro sem uma falha
    // sequer. Onde o controle e obrigatorio, o teste cobra que ele EXISTA.
    const controles = [
      { re: /\.slice\(\((page|pageOk) - 1\) \* PAGE_SIZE/, qual: "a fatia da pagina", exige: false },
      { re: /\.range\(\((page|pageOk) - 1\) \* PAGE_SIZE/, qual: "o range da busca", exige: false },
      { re: /disabled=\{(page|pageOk) <= 1\}/, qual: "a seta anterior (disabled)", exige: false },
      { re: /disabled=\{(page|pageOk) >= totalPages\}/, qual: "a seta proxima (disabled)", exige: false },
      { re: /setPage\((?:Math\.\w+\(1, |Math\.\w+\(totalPages, )?(page|pageOk) [-+] 1\)/, qual: "o alvo das setas", exige: true },
      // Toda tela paginada FATIA ou BUSCA por pagina — uma das duas, sempre. Se as
      // duas sumirem, o offset foi para outro lugar e este teste parou de ver.
      { re: /(?:\.slice|\.range)\(\((page|pageOk) - 1\) \* PAGE_SIZE/, qual: "o corte da pagina (fatia ou range)", exige: true },
    ];
    for (const { re, qual, exige } of controles) {
      // Casa TODAS as ocorrencias: o portal tem duas barras (topo e rodape), e
      // cobrir so a primeira deixava a de baixo com o defeito.
      const todas = [...fonte.matchAll(new RegExp(re.source, "g"))];
      if (exige) {
        expect(todas.length, `${tela}: nao achei ${qual} — o offset saiu para outro lugar e esta guarda parou de ver`)
          .toBeGreaterThan(0);
      }
      for (const m of todas) {
        expect(m[1], `${tela}: ${qual} voltou a usar a pagina nao limitada`).toBe("pageOk");
      }
    }
    // AS SETAS NAO PODEM SAIR DA FAIXA, por um dos DOIS mecanismos validos: as tres
    // telas do admin usam `disabled={pageOk ...}`; o portal usa `<button>` cru com
    // `Math.max(1, ...)` / `Math.min(totalPages, ...)` no proprio `onClick`. Exigir
    // `disabled` de todas reprovaria o portal, que esta correto.
    //
    // Medido: apagar o `disabled` do Next de `Clientes` passava verde — e com
    // `paginaValida` no lugar o botao vira MORTO (clica e nao sai do lugar), ou
    // seja, o controle recem-corrigido some em silencio.
    const travada =
      /disabled=\{pageOk <= 1\}/.test(fonte) && /disabled=\{pageOk >= totalPages\}/.test(fonte);
    const clampada =
      /setPage\(Math\.max\(1, pageOk - 1\)\)/.test(fonte) && /setPage\(Math\.min\(totalPages, pageOk \+ 1\)\)/.test(fonte);
    expect(travada || clampada,
      `${tela}: as setas nao estao presas a faixa — nem por \`disabled\`, nem por \`Math.max\`/\`Math.min\``)
      .toBe(true);

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
