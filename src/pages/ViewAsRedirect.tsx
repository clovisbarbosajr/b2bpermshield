import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const VIEW_AS_KEY = "viewAsCustomer";

const ViewAsRedirect = () => {
  const location = useLocation();
  const [erro, setErro] = useState<string | null>(null);
  // O token e de USO UNICO. Em dev/preview o React.StrictMode roda o effect DUAS
  // vezes: a 1a chamada consumia o token e a 2a recebia "Invalid or expired token"
  // -> a aba caia no /login com erro. Este ref garante UMA unica tentativa.
  const jaTentou = useRef(false);

  useEffect(() => {
    if (jaTentou.current) return;
    jaTentou.current = true;

    const resolveViewAs = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");

      if (!token) {
        sessionStorage.removeItem(VIEW_AS_KEY);
        window.location.replace("/login");
        return;
      }

      // A RPC exige a sessao do ADMIN que criou o token (admin_user_id = auth.uid()).
      // Numa aba NOVA o supabase-js ainda esta restaurando a sessao do localStorage
      // quando o effect roda; sem esperar, a chamada sai com a anon key e o banco
      // responde "Invalid or expired token" (o token ja fica marcado como usado).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErro("Your admin session was not found in this browser. Log in as admin and click \"View as\" again.");
        return;
      }

      const { data, error } = await supabase.rpc("consume_view_as_token", {
        _token: token,
      });

      const customer = Array.isArray(data) ? data[0] : null;

      if (error || !customer) {
        // Antes redirecionava calado pro /login — impossivel saber o motivo.
        sessionStorage.removeItem(VIEW_AS_KEY);
        setErro(error?.message ?? "This View as link is no longer valid. Go back to Customers and click \"View as\" again.");
        return;
      }

      // sessionStorage = POR ABA: só ESTA aba vira a visão do cliente; as outras
      // abas do navegador continuam com a sessão staff normal.
      sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(customer));
      window.location.replace("/portal");
    };

    resolveViewAs();
  }, [location.search]);

  if (erro) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="mb-2 font-display text-lg font-semibold">Could not open View as</h1>
          <p className="mb-4 text-sm text-muted-foreground">{erro}</p>
          <a
            href="/admin/customers"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Back to Customers
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
};

export default ViewAsRedirect;
