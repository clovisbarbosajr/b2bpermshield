import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, XCircle, ShieldOff } from "lucide-react";

const PendingApproval = () => {
  const { user, signOut } = useAuth();
  const [clienteStatus, setClienteStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("clientes")
      .select("status, is_active")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setClienteStatus(data.is_active === false ? "bloqueado" : (data.status ?? "pendente"));
      });
  }, [user]);

  const config: Record<string, { icon: React.ReactNode; title: string; desc: string }> = {
    pendente: {
      icon: <Clock className="h-12 w-12 text-amber-400 mx-auto mb-4" />,
      title: "Account Pending Approval",
      desc: "Your registration was received. An administrator will review and approve your account shortly.",
    },
    rejeitado: {
      icon: <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />,
      title: "Registration Not Approved",
      desc: "Your registration request was not approved. Please contact support for more information.",
    },
    bloqueado: {
      icon: <ShieldOff className="h-12 w-12 text-destructive mx-auto mb-4" />,
      title: "Account Suspended",
      desc: "Your account has been suspended. Please contact support.",
    },
  };

  const { icon, title, desc } = config[clienteStatus ?? "pendente"] ?? config["pendente"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mt-4">{icon}</div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription className="mt-2">{desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Logged in as <strong>{user?.email}</strong>
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await signOut();
            }}
          >
            Sign Out
          </Button>
          <Link to="/login" className="text-sm text-accent hover:underline">
            Back to login
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};

export default PendingApproval;
