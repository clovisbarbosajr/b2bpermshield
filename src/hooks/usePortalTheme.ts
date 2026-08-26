import { useEffect } from "react";

/**
 * Carrega o tema das telas de entrada (portal, logins, recuperacao de senha) e
 * o desmonta ao sair.
 *
 * POR QUE ESCOPADO, e nao importado no `index.css`:
 * `public/paginas/styles.css` tem seletores GLOBAIS — `:root` com as variaveis,
 * `*{box-sizing}`, `html,body{background;color}`, `a{color:inherit;
 * text-decoration:none}`, `button,input{font:inherit}`. Importar no app inteiro
 * mudaria fundo, cor de link e tipografia de TODAS as telas do admin e do
 * portal, que sao Tailwind. Aqui ele entra ao montar e sai ao desmontar.
 *
 * POR QUE `/paginas/...`, e nao `src/assets`:
 * o proprio CSS referencia `url("assets/flooring-hero.jpg")` por caminho
 * RELATIVO. Servido de `/paginas/styles.css`, isso resolve para
 * `/paginas/assets/flooring-hero.jpg` — certo, sem reescrita de bundler e sem
 * duplicar a imagem de 1,1 MB. As paginas estaticas continuam validas do jeito
 * que estao.
 */

const CSS_TEMA = "/paginas/styles.css";
const CSS_FONTES =
  "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap";

function garantirLink(href: string, marca: string): HTMLLinkElement {
  const existente = document.querySelector<HTMLLinkElement>(`link[data-portal="${marca}"]`);
  if (existente) return existente;
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  el.dataset.portal = marca;
  document.head.appendChild(el);
  return el;
}

/**
 * @param classesBody classes que o `<body>` precisa ter (o CSS e escrito contra
 *                    `body.auth-page`, `body.portal-page`, etc.)
 */
export function usePortalTheme(classesBody: string[]) {
  useEffect(() => {
    const tema = garantirLink(CSS_TEMA, "tema");
    const fontes = garantirLink(CSS_FONTES, "fontes");
    const body = document.body;
    // So remove no fim as classes que ESTA tela acrescentou: outra tela pode ter
    // posto a mesma, e tirar sem conferir deixaria a de tras sem estilo.
    const acrescentadas = classesBody.filter((c) => !body.classList.contains(c));
    acrescentadas.forEach((c) => body.classList.add(c));

    // FUNDO POR ESTILO INLINE, de proposito.
    //
    // O `index.css` do app define `body { background-color: hsl(var(--background)) }`
    // e, medindo no navegador, era essa regra que vencia — o `body` ficava
    // TRANSPARENTE. Passava despercebido porque `html` recebe o fundo escuro
    // pela mesma regra do tema, mas a ordem entre as folhas nao e garantida:
    // o Vite injeta o CSS do app dinamicamente, e no build de producao a
    // ordem pode inverter. Aparencia que depende de sorte de cascata quebra
    // sozinha um dia, e num login isso e tela branca sobre texto branco.
    //
    // Estilo inline vence qualquer folha. O fallback existe para o caso de
    // `styles.css` nao carregar: sem ele, `var(--night)` invalido devolveria
    // transparente e o problema voltaria pela outra porta.
    const fundoAntes = body.style.background;
    body.style.background = "var(--night, #07111b)";

    return () => {
      acrescentadas.forEach((c) => body.classList.remove(c));
      body.style.background = fundoAntes;
      tema.remove();
      fontes.remove();
    };
  }, [classesBody.join(" ")]);
}

/**
 * O brilho que segue o cursor e o leve deslocamento do painel — as duas
 * animacoes de `public/paginas/app.js`, portadas.
 *
 * Respeitam `prefers-reduced-motion`: quem pediu menos movimento no sistema nao
 * recebe nenhum dos dois. O `app.js` original ja fazia isso e nao vou perder.
 */
export function usePortalMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const glow = document.querySelector<HTMLElement>(".cursor-glow");
    const parallax = document.querySelector<HTMLElement>("[data-parallax]");
    if (!glow && !parallax) return;

    const mover = (e: PointerEvent) => {
      glow?.style.setProperty("--x", `${e.clientX}px`);
      glow?.style.setProperty("--y", `${e.clientY}px`);
    };
    const inclinar = (e: PointerEvent) => {
      if (!parallax) return;
      const box = parallax.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      parallax.style.setProperty("--px", `${x * 12}px`);
      parallax.style.setProperty("--py", `${y * 12}px`);
    };
    const soltar = () => {
      parallax?.style.setProperty("--px", "0px");
      parallax?.style.setProperty("--py", "0px");
    };

    if (glow) document.addEventListener("pointermove", mover);
    if (parallax) {
      parallax.addEventListener("pointermove", inclinar);
      parallax.addEventListener("pointerleave", soltar);
    }
    return () => {
      document.removeEventListener("pointermove", mover);
      parallax?.removeEventListener("pointermove", inclinar);
      parallax?.removeEventListener("pointerleave", soltar);
    };
  }, []);
}
