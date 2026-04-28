import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const Index = () => {
  const { user, role, loading, isDemo } = useAuth();

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

  // role is null and user is authenticated → pending approval (real users only)
  if (!isDemo) {
    return <Navigate to="/pending-approval" replace />;
  }

  return <Navigate to="/portal" replace />;
};

export default Index;
