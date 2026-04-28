import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const STAFF_ROLES = ["admin", "manager", "warehouse"];

interface Props {
  children: React.ReactNode;
  requiredRole?: "admin" | "cliente" | "admin-or-warehouse" | "staff";
  requiredPermission?: string;
}

const ProtectedRoute = ({ children, requiredRole, requiredPermission }: Props) => {
  const { user, role, loading, isDemo, hasPermission } = useAuth();

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

  // Real user with no role → pending approval (customers only)
  if (!isDemo && !role) {
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
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
