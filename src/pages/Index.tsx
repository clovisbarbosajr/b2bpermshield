import { useAuth } from "@/contexts/AuthContext";
import ErroDeVerificacao from "@/components/ErroDeVerificacao";
import { Navigate } from "react-router-dom";

const Index = () => {
  const { user, role, loading, isDemo, falhaAoLerPapel } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (role === "admin") {
    return <Navigate to="/admin" replace />;
  }

  if (role === "cliente") {
    return <Navigate to="/portal" replace />;
  }

  // Falha ao LER o papel nao e conta pendente.
  //
  // ATENCAO: este componente e CODIGO MORTO — nao aparece em nenhuma `<Route>`
  // do `App.tsx` (quem responde em `/` e o `LoginLanding`). Mantido coerente com
  // os outros dois de proposito: o dia em que alguem religar esta rota, ela nao
  // pode voltar carregando a versao que acusa o cadastro do usuario.
  if (!isDemo && falhaAoLerPapel) {
    return <ErroDeVerificacao />;
  }

  // role is null and user is authenticated → pending approval (real users only)
  if (!isDemo) {
    return <Navigate to="/pending-approval" replace />;
  }

  return <Navigate to="/portal" replace />;
};

export default Index;
