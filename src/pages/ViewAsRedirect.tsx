import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const VIEW_AS_KEY = "viewAsCustomer";

const ViewAsRedirect = () => {
  const location = useLocation();

  useEffect(() => {
    const resolveViewAs = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");

      if (!token) {
        localStorage.removeItem(VIEW_AS_KEY);
        window.location.replace("/login");
        return;
      }

      const { data, error } = await supabase.rpc("consume_view_as_token", {
        _token: token,
      });

      const customer = Array.isArray(data) ? data[0] : null;

      if (error || !customer) {
        localStorage.removeItem(VIEW_AS_KEY);
        window.location.replace("/login");
        return;
      }

      localStorage.setItem(VIEW_AS_KEY, JSON.stringify(customer));
      window.location.replace("/portal");
    };

    resolveViewAs();
  }, [location.search]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
};

export default ViewAsRedirect;
