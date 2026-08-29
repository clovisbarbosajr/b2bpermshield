import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import ErroDeVerificacao from "@/components/ErroDeVerificacao";

const STAFF_ROLES = ["admin", "manager", "warehouse"];

interface Props {
  children: React.ReactNode;
  requiredRole?: "admin" | "cliente" | "admin-or-warehouse" | "staff";
  requiredPermission?: string;
}

const ProtectedRoute = ({ children, requiredRole, requiredPermission }: Props) => {
  const { user, role, loading, isDemo, hasPermission, contaAprovada, falhaAoLerPapel } = useAuth();

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

  // Falha ao LER o papel nao e conta pendente — ver `ErroDeVerificacao`.
  if (!isDemo && falhaAoLerPapel) {
    return <ErroDeVerificacao />;
  }

  // Real user with no role → pending approval (customers only)
  if (!isDemo && !role) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Cliente com ficha PENDENTE/INATIVA → aprovação.
  //
  // Sem isto, `/pending-approval` era código morto: `handle_new_user` dá o papel
  // `cliente` a todo `signUp`, então `role` nunca é nulo e o teste acima nunca
  // dispara. Qualquer pessoa se cadastrava e caía direto no catálogo.
  //
  // Isto é a TELA. O portão real é o banco (`cliente_conta_liberada`), que faz a
  // conta pendente enxergar catálogo vazio mesmo chamando a API direto — a chave
  // anon está no bundle, então guarda de rota sozinha não protege nada.
  //
  // O "View As" já está coberto por `!isDemo`: `applyViewAsSession` liga `isDemo`
  // junto com a impersonação. Eu tinha somado um `!impersonatedCustomer` aqui —
  // cláusula que nunca decidia nada, escondida atrás de uma condição que já era
  // suficiente. Removida.
  if (!isDemo && role === "cliente" && !contaAprovada) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Role-based access
  if (requiredRole === "admin") {
    if (role !== "admin") return <Navigate to="/" replace />;
  } else if (requiredRole === "admin-or-warehouse") {
    // Legacy — kept for compatibility; now "staff" is preferred
    if (!STAFF_ROLES.includes(role ?? "")) return <Navigate to="/" replace />;
  } else if (requiredRole === "staff") {
    // Any internal staff role: admin, manager, warehouse
    if (!STAFF_ROLES.includes(role ?? "")) return <Navigate to="/" replace />;
  } else if (requiredRole === "cliente") {
    if (role !== "cliente") return <Navigate to="/" replace />;
  } else if (requiredRole) {
    if (role !== requiredRole) return <Navigate to="/" replace />;
  }

  // Permission-based access (after role check passes)
  //
  // EXPLICA, e nao redireciona. Mandar para `/admin` tinha dois problemas, e o
  // segundo so apareceu quando mais rotas passaram a exigir permissao:
  //
  //  1. o operador era jogado para outra tela sem uma palavra — parecia bug;
  //  2. `/admin` TAMBEM exige `view_dashboard`. Com essa caixa desmarcada, a
  //     negacao mandava para uma rota que negava de novo: o `Navigate` monta uma
  //     vez, nao ha laco, e o resultado e pior de diagnosticar — sidebar na tela
  //     e area de conteudo em branco PARA SEMPRE, sem mensagem. E `/admin` e
  //     para onde todo login de staff vai (`AdminLogin`), entao seria em todo
  //     login.
  //
  // A sidebar continua montada (este componente e filho do shell), entao o
  // operador ve o que PODE abrir e clica.
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="font-semibold">You do not have access to this screen.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask an administrator to enable it for your user, or pick another item in the menu.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
