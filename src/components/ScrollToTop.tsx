import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// SPA client-side navigation não reseta o scroll (o browser só faz isso em full page load).
// Sem isto, navegar pra uma página nova mantém a posição de scroll da anterior.
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
